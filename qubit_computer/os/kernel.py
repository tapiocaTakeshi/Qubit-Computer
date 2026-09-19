"""QubitOS kernel.

Responsibilities, in classic-OS terms:

* **Hardware abstraction** -- a ``QubitComputer`` backend (APQB state
  vectors) is the only device driver.
* **Memory management** -- physical qubits are a finite pool; ``alloc``
  hands out *segments* (independent APQB registers) and ``free`` returns
  them.  Each segment is a live ``StateVector`` the user can drive gate by
  gate through syscalls.
* **Processes & scheduling** -- programs (circuits or Python jobs) are
  spawned as processes with a PID and run by the *APQB scheduler*: the
  kernel keeps one system APQB whose uncertainty amplitude eta (paper
  Eq. 8/31) is mapped to the scheduler's exploration rate (Eq. 11/32):

      eps = p_min + (p_max - p_min) * eta

  With probability ``eps`` a random ready process is picked (exploration),
  otherwise the highest-priority one (exploitation).  ``sysctl
  apqb.theta`` therefore tunes the OS between deterministic and
  stochastic scheduling, exactly the r <-> eta trade-off of the paper.
* **System calls** -- every operation the shell exposes goes through
  ``Kernel.syscall(name, ...)`` so it can be logged and scripted.
* **Filesystem** -- ``QubitFS`` (see fs.py).
* **Logging** -- ``dmesg`` ring buffer.
"""

from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Sequence

from .. import backend as backend_mod
from .. import gates as G
from ..apqb import APQB, theta_from_r
from ..backend import BackendInfo
from ..circuit import Circuit
from ..computer import QubitComputer, Result
from ..hardware import APQBPersonalComputer
from ..state import APQBReadout, StateVector, concurrence, three_tangle
from .fs import FSError, QubitFS
from .programs import PROGRAMS, Program, parse_args

__all__ = ["Kernel", "KernelError", "Process", "ProcState", "Segment", "OS_NAME", "OS_VERSION"]

OS_NAME = "QubitOS"
OS_VERSION = "0.1.0"


class KernelError(Exception):
    pass


class ProcState(str, Enum):
    NEW = "new"
    READY = "ready"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    KILLED = "killed"


@dataclass
class Segment:
    """An allocated APQB register (a block of physical qubits)."""

    sid: int
    name: str
    qubits: List[int]
    state: StateVector
    owner: Optional[int] = None
    created: float = field(default_factory=time.time)
    history: List[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.qubits)


@dataclass
class Process:
    pid: int
    name: str
    argv: List[str]
    program: Program
    priority: int = 5
    state: ProcState = ProcState.NEW
    created: float = field(default_factory=time.time)
    started: Optional[float] = None
    finished: Optional[float] = None
    result: Any = None
    error: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    shots: int = 1024
    seed: Optional[int] = None
    circuit: Optional[Circuit] = None

    def log(self, line: str) -> None:
        self.logs.append(line)

    @property
    def elapsed(self) -> Optional[float]:
        if self.started is None:
            return None
        return (self.finished or time.time()) - self.started

    def row(self) -> str:
        el = f"{self.elapsed:.3f}s" if self.elapsed is not None else "-"
        return f"{self.pid:>4}  {self.state.value:<8} {self.priority:>3}  {el:>8}  {self.name} {' '.join(self.argv)}"


class Kernel:
    def __init__(self, num_qubits: int = 16, fs_path: Optional[str] = None,
                 seed: Optional[int] = None, theta: float = 0.2, backend: str = "cpu"):
        self.boot_time = time.time()
        self._dmesg: List[str] = []
        self.backend_info: BackendInfo = backend_mod.resolve(backend, on_warning=self.log)
        self.hw = QubitComputer(max_qubits=num_qubits, backend=self.backend_info.name)
        self.pc = APQBPersonalComputer(apqb_qubits=num_qubits, ram_qubits=num_qubits)
        self.num_qubits = num_qubits
        self.fs = QubitFS(fs_path)
        self.rng = random.Random(seed)
        self.seed = seed
        self.sysctl: Dict[str, Any] = {
            "apqb.theta": theta,          # system APQB angle -> scheduler exploration
            "sched.p_min": 0.0,
            "sched.p_max": 0.5,
            "hw.num_qubits": num_qubits,
            "run.shots": 1024,
            "hardware.backend": self.backend_info.name.value,   # cpu | gpu | qnpu (see backend.py)
        }
        self.free_qubits: List[int] = list(range(num_qubits))
        self.segments: Dict[int, Segment] = {}
        self.processes: Dict[int, Process] = {}
        self._next_sid = 1
        self._next_pid = 1
        self.last_result: Optional[Result] = None
        self.programs: Dict[str, Program] = dict(PROGRAMS)
        self.syscalls: Dict[str, Callable[..., Any]] = {
            "alloc": self.sys_alloc, "free": self.sys_free, "mem": self.sys_mem,
            "apply": self.sys_apply, "measure": self.sys_measure, "readout": self.sys_readout,
            "reset": self.sys_reset, "entangle": self.sys_entanglement,
            "spawn": self.sys_spawn, "schedule": self.sys_schedule, "kill": self.sys_kill,
            "ps": self.sys_ps, "run": self.sys_run, "exec_circuit": self.sys_exec_circuit,
            "sysctl": self.sys_sysctl, "dmesg": self.sys_dmesg, "uname": self.sys_uname,
            "backend": self.sys_backend,
            "hardware": self.sys_hardware,
        }
        self.log(f"{OS_NAME} {OS_VERSION} booting on APQB hardware: {num_qubits} physical qubits")
        self.log(f"hardware backend: {self.backend_info.name.value} (engine={self.backend_info.engine}) "
                 f"- {self.backend_info.detail}")
        self.log(f"system APQB theta={theta:.3f} -> r={math.cos(2 * theta):+.3f} "
                 f"eta={abs(math.sin(2 * theta)):.3f} (scheduler exploration eps={self.exploration_rate():.3f})")
        self.log(f"fs: {'persistent ' + fs_path if fs_path else 'in-memory'}; {len(self.programs)} programs in /bin")
        self._refresh_bin()
        self.pc.attach_kernel(self)

    # ------------------------------------------------------------ logging
    def log(self, line: str) -> None:
        t = time.time() - self.boot_time
        self._dmesg.append(f"[{t:9.4f}] {line}")

    def sys_dmesg(self, n: int = 50) -> List[str]:
        return self._dmesg[-n:]

    def sys_uname(self) -> Dict[str, Any]:
        return {"os": OS_NAME, "version": OS_VERSION, "hardware": "APQB state-vector",
                "backend": self.backend_info.name.value, "num_qubits": self.num_qubits,
                "uptime": time.time() - self.boot_time, "programs": sorted(self.programs)}

    def sys_hardware(self) -> Dict[str, Any]:
        """Return the assembled APQB-PC component report."""
        self.pc.backend = self.backend_info
        return self.pc.report()

    # ------------------------------------------------------------ backend
    def sys_backend(self, name: Optional[str] = None) -> Any:
        """``backend`` (no arg): report; ``backend <cpu|gpu|qnpu>``: switch."""
        if name is None:
            return {
                "current": self.backend_info.name.value,
                "engine": self.backend_info.engine,
                "detail": self.backend_info.detail,
                "available": [
                    {"name": info.name.value, "available": info.available,
                     "engine": info.engine, "detail": info.detail}
                    for info in backend_mod.available_backends()
                ],
            }
        return self.sys_sysctl("hardware.backend", name)

    # ----------------------------------------------------------- syscalls
    def syscall(self, name: str, *args: Any, **kwargs: Any) -> Any:
        if name not in self.syscalls:
            raise KernelError(f"unknown syscall '{name}'")
        return self.syscalls[name](*args, **kwargs)

    # ------------------------------------------------------- sysctl/APQB
    def system_apqb(self) -> APQB:
        return APQB(float(self.sysctl["apqb.theta"]))

    def exploration_rate(self) -> float:
        """eps = p_min + (p_max - p_min) * eta  (paper Eq. 11 / 32)."""
        eta = self.system_apqb().T
        lo, hi = float(self.sysctl["sched.p_min"]), float(self.sysctl["sched.p_max"])
        return lo + (hi - lo) * eta

    def sys_sysctl(self, key: Optional[str] = None, value: Optional[str] = None) -> Any:
        if key is None:
            return dict(self.sysctl)
        if key not in self.sysctl:
            raise KernelError(f"unknown sysctl key '{key}'")
        if value is None:
            return self.sysctl[key]
        old = self.sysctl[key]
        new: Any
        if key == "apqb.r":  # pragma: no cover - convenience alias
            new = theta_from_r(float(value))
            key = "apqb.theta"
        elif key == "hardware.backend":
            info = backend_mod.resolve(value, on_warning=self.log)
            self.backend_info = info
            self.hw.set_backend(info.name)
            new = info.name.value
            self.sysctl[key] = new
            self.log(f"sysctl {key}: {old} -> {new} (engine={info.engine})")
            return new
        elif isinstance(old, bool):
            new = value.lower() in ("1", "true", "yes", "on")
        elif isinstance(old, int) and not isinstance(old, bool):
            new = int(value)
        elif isinstance(old, float):
            text = str(value).strip()
            new = float(text[:-2] or "1") * math.pi if text.endswith("pi") else float(text)
        else:
            new = value
        if key == "apqb.theta" and not 0.0 <= float(new) <= math.pi / 2:
            raise KernelError("apqb.theta must lie in [0, pi/2]")
        self.sysctl[key] = new
        self.log(f"sysctl {key}: {old} -> {new}")
        return new

    # ------------------------------------------------------------ memory
    def sys_alloc(self, size: int, name: str = "", apqbs: Optional[Sequence[APQB]] = None,
                  owner: Optional[int] = None) -> Segment:
        if not isinstance(size, int) or isinstance(size, bool) or size < 1:
            raise KernelError("segment size must be an integer >= 1")
        if size > len(self.free_qubits):
            raise KernelError(f"out of qubits: requested {size}, free {len(self.free_qubits)}")
        if apqbs is not None and len(apqbs) != size:
            raise KernelError(f"expected {size} initial APQBs, got {len(apqbs)}")
        state = self._new_statevector(size, apqbs)
        qubits = self.free_qubits[:size]
        del self.free_qubits[:size]
        sid = self._next_sid
        self._next_sid += 1
        seg = Segment(sid, name or f"seg{sid}", qubits, state, owner)
        self.segments[sid] = seg
        self.log(f"alloc sid={sid} '{seg.name}' qubits={qubits}")
        return seg

    def sys_free(self, sid: int) -> None:
        seg = self._segment(sid)
        self.free_qubits.extend(seg.qubits)
        self.free_qubits.sort()
        del self.segments[sid]
        self.log(f"free sid={sid} '{seg.name}' -> {len(self.free_qubits)} free qubits")

    def sys_mem(self) -> Dict[str, Any]:
        used = self.num_qubits - len(self.free_qubits)
        return {"total": self.num_qubits, "used": used, "free": len(self.free_qubits),
                "segments": [{"sid": s.sid, "name": s.name, "qubits": s.qubits, "owner": s.owner,
                              "ops": len(s.history)} for s in self.segments.values()]}

    def _segment(self, sid: int) -> Segment:
        try:
            return self.segments[int(sid)]
        except (KeyError, ValueError):
            raise KernelError(f"no such segment: {sid}") from None

    def _new_statevector(self, size: int, apqbs: Optional[Sequence[APQB]] = None) -> StateVector:
        sv = StateVector.from_apqbs(list(apqbs)) if apqbs else StateVector(size)
        sv.backend = self.backend_info.name
        return sv

    # --------------------------------------------------------- register ops
    def sys_apply(self, sid: int, gate: str, targets: Sequence[int], params: Sequence[float] = ()) -> Segment:
        seg = self._segment(sid)
        key = gate.lower()
        if key not in G.GATE_ARITY:
            raise KernelError(f"unknown gate '{gate}'")
        if G.GATE_ARITY[key] != len(targets):
            raise KernelError(f"gate '{gate}' needs {G.GATE_ARITY[key]} target(s)")
        seg.state.apply(G.resolve(key, params), list(targets))
        seg.history.append(f"{key}{list(params) if params else ''} {list(targets)}")
        return seg

    def sys_measure(self, sid: int, qubits: Optional[Sequence[int]] = None,
                    shots: int = 1, collapse: bool = True) -> Dict[str, Any]:
        seg = self._segment(sid)
        qs = list(qubits) if qubits else list(range(seg.size))
        if shots <= 1:
            outcome = seg.state.measure(qs, rng=self.rng, collapse=collapse)
            seg.history.append(f"measure {qs} -> {outcome}")
            return {"outcome": outcome, "qubits": qs, "collapsed": collapse}
        counts = seg.state.sample(shots, qs, rng=self.rng)
        return {"counts": counts, "qubits": qs, "shots": shots, "collapsed": False}

    def sys_readout(self, sid: int) -> List[APQBReadout]:
        return self._segment(sid).state.apqb_readouts()

    def sys_reset(self, sid: int, apqbs: Optional[Sequence[APQB]] = None) -> Segment:
        seg = self._segment(sid)
        seg.state = self._new_statevector(seg.size, apqbs)
        seg.history.append("reset")
        return seg

    def sys_entanglement(self, sid: int) -> Dict[str, Any]:
        seg = self._segment(sid)
        return self.entanglement_of(seg.state)

    @staticmethod
    def entanglement_of(sv: StateVector) -> Dict[str, Any]:
        info: Dict[str, Any] = {"num_qubits": sv.n}
        readouts = sv.apqb_readouts()
        info["von_neumann"] = [ro["von_neumann"] for ro in readouts]
        info["r"] = [ro["r"] for ro in readouts]
        if sv.n == 2:
            c2 = concurrence(sv)
            info["concurrence"] = c2
            info["C2^2 + r^2"] = c2 ** 2 + readouts[0]["r"] ** 2
        if sv.n == 3:
            t3 = three_tangle(sv)
            info["three_tangle"] = t3
            info["tau3 + r^2"] = t3 + readouts[0]["r"] ** 2
        return info

    # ---------------------------------------------------------- processes
    def sys_spawn(self, name: str, argv: Optional[List[str]] = None, priority: int = 5,
                  shots: Optional[int] = None, seed: Optional[int] = None) -> Process:
        if name not in self.programs:
            raise KernelError(f"no such program: {name} (see 'ls /bin')")
        pid = self._next_pid
        self._next_pid += 1
        proc = Process(pid, name, list(argv or []), self.programs[name], priority=priority,
                       state=ProcState.READY, shots=shots or int(self.sysctl["run.shots"]), seed=seed)
        self.processes[pid] = proc
        self.log(f"spawn pid={pid} {name} {' '.join(proc.argv)} prio={priority}")
        return proc

    def sys_kill(self, pid: int) -> Process:
        proc = self._process(pid)
        if proc.state in (ProcState.READY, ProcState.NEW, ProcState.RUNNING):
            proc.state = ProcState.KILLED
            proc.finished = time.time()
            self.log(f"kill pid={pid}")
        return proc

    def sys_ps(self, all_: bool = True) -> List[Process]:
        procs = list(self.processes.values())
        if not all_:
            procs = [p for p in procs if p.state in (ProcState.READY, ProcState.RUNNING)]
        return procs

    def _process(self, pid: int) -> Process:
        try:
            return self.processes[int(pid)]
        except (KeyError, ValueError):
            raise KernelError(f"no such process: {pid}") from None

    def ready_queue(self) -> List[Process]:
        return [p for p in self.processes.values() if p.state == ProcState.READY]

    def pick_next(self) -> Optional[Process]:
        """APQB scheduler: explore with prob. eps (from eta), else exploit priority."""
        ready = self.ready_queue()
        if not ready:
            return None
        if self.rng.random() < self.exploration_rate():
            choice = self.rng.choice(ready)
            self.log(f"sched: explore -> pid={choice.pid} (eps={self.exploration_rate():.3f})")
            return choice
        ready.sort(key=lambda p: (-p.priority, p.pid))
        return ready[0]

    def execute(self, proc: Process) -> Process:
        proc.state = ProcState.RUNNING
        proc.started = time.time()
        try:
            if proc.program.circuit is not None:
                circuit = proc.program.circuit(proc.argv)
                proc.circuit = circuit
                if circuit.num_qubits > self.num_qubits:
                    raise KernelError(f"circuit needs {circuit.num_qubits} qubits, machine has {self.num_qubits}")
                result = self.hw.run(circuit, shots=proc.shots, seed=proc.seed)
                proc.result = result
                self.last_result = result
                proc.log(f"ran '{circuit.name}' ({circuit.num_qubits} qubits, depth {circuit.depth}) "
                         f"shots={proc.shots} in {result.elapsed * 1000:.1f} ms")
            else:
                assert proc.program.job is not None
                proc.result = proc.program.job(self, proc, proc.argv)
            proc.state = ProcState.DONE
        except KeyboardInterrupt:  # pragma: no cover
            proc.state = ProcState.KILLED
            proc.error = "interrupted"
        except Exception as exc:  # noqa: BLE001 - surface every job failure to the shell
            proc.state = ProcState.FAILED
            proc.error = f"{type(exc).__name__}: {exc}"
        proc.finished = time.time()
        self.log(f"pid={proc.pid} {proc.name} -> {proc.state.value}"
                 + (f" ({proc.error})" if proc.error else ""))
        self._save_result(proc)
        return proc

    def sys_schedule(self, max_steps: Optional[int] = None) -> List[Process]:
        """Run ready processes until the queue is empty (or ``max_steps``)."""
        done: List[Process] = []
        steps = 0
        while True:
            if max_steps is not None and steps >= max_steps:
                break
            proc = self.pick_next()
            if proc is None:
                break
            done.append(self.execute(proc))
            steps += 1
        return done

    def sys_run(self, name: str, argv: Optional[List[str]] = None, shots: Optional[int] = None,
                seed: Optional[int] = None, priority: int = 5) -> Process:
        """spawn + schedule in one call (what the shell's ``run`` does)."""
        proc = self.sys_spawn(name, argv, priority=priority, shots=shots, seed=seed)
        return self.execute(proc)

    def sys_exec_circuit(self, circuit: Circuit, shots: Optional[int] = None,
                         seed: Optional[int] = None) -> Result:
        """Run an ad-hoc circuit (e.g. loaded from a JSON file in the FS)."""
        result = self.hw.run(circuit, shots=shots or int(self.sysctl["run.shots"]), seed=seed)
        self.last_result = result
        self.log(f"exec circuit '{circuit.name}' ({circuit.num_qubits} qubits) shots={result.shots}")
        return result

    # ------------------------------------------------------------- misc
    def _save_result(self, proc: Process) -> None:
        payload: Dict[str, Any] = {"pid": proc.pid, "program": proc.name, "argv": proc.argv,
                                   "state": proc.state.value, "error": proc.error, "logs": proc.logs}
        if isinstance(proc.result, Result):
            payload["result"] = proc.result.to_dict()
        elif proc.result is not None:
            try:
                json.dumps(proc.result)
                payload["result"] = proc.result
            except TypeError:
                payload["result"] = str(proc.result)
        try:
            self.fs.write_json(f"/var/results/{proc.pid}_{proc.name}.json", payload)
        except FSError:  # pragma: no cover
            pass

    def _refresh_bin(self) -> None:
        for name, prog in self.programs.items():
            self.fs.write(f"/bin/{name}", f"#!qubitos {prog.kind}\n# {prog.description}\n# usage: {prog.usage}\n")

    def register_program(self, program: Program) -> None:
        self.programs[program.name] = program
        self._refresh_bin()
        self.log(f"registered program '{program.name}'")

    def shutdown(self) -> Optional[str]:
        path = self.fs.sync()
        self.log("shutdown" + (f" (fs synced to {path})" if path else ""))
        return path
