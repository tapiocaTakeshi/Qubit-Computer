"""qsh -- the QubitOS shell.

Every command maps onto kernel syscalls.  The shell can run
interactively, execute a ``.qsh`` script, or evaluate a one-liner
(``qubitos -c "run bell; ent last"``).
"""

from __future__ import annotations

import json
import math
import shlex
import shutil
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional

from ..apqb import APQB, chebyshev_features, theta_from_latent, theta_from_r
from ..circuit import Circuit
from ..computer import Result
from .fs import FSError
from .kernel import Kernel, KernelError, ProcState
from .programs import parse_args

__all__ = ["Shell"]

# Package managers and other host-only tools a new user might type expecting a real terminal.
# qsh is QubitOS's own virtual shell (kernel syscalls, not a host process), so these can never
# work here -- point the user back to their host terminal instead of a bare "not found".
_HOST_ONLY_COMMANDS = {
    "brew", "apt", "apt-get", "dpkg", "yum", "dnf", "pacman", "port",
    "pip", "pip3", "npm", "npx", "yarn", "pnpm", "cargo", "gem",
    "git", "docker", "sudo", "curl", "wget", "ssh",
}


def _num(s: str) -> float:
    if s.endswith("pi"):
        return float(s[:-2] or "1") * math.pi
    return float(s)


class Shell:
    def __init__(self, kernel: Kernel, out: Callable[[str], None] = None):
        self.k = kernel
        self.out = out or (lambda s: print(s))
        self.running = True
        self.last_status = 0
        self.commands: Dict[str, Callable[[List[str]], None]] = {
            "help": self.cmd_help, "?": self.cmd_help, "uname": self.cmd_uname, "uptime": self.cmd_uptime,
            "dmesg": self.cmd_dmesg, "sysctl": self.cmd_sysctl, "echo": self.cmd_echo, "motd": self.cmd_motd,
            "backend": self.cmd_backend,
            "run": self.cmd_run, "spawn": self.cmd_spawn, "sched": self.cmd_sched, "ps": self.cmd_ps,
            "kill": self.cmd_kill, "log": self.cmd_log, "result": self.cmd_result, "draw": self.cmd_draw,
            "alloc": self.cmd_alloc, "free": self.cmd_free, "mem": self.cmd_mem, "regs": self.cmd_mem,
            "gate": self.cmd_gate, "measure": self.cmd_measure, "readout": self.cmd_readout,
            "state": self.cmd_state, "reset": self.cmd_reset, "ent": self.cmd_ent,
            "apqb": self.cmd_apqb, "exec": self.cmd_exec,
            "ls": self.cmd_ls, "cat": self.cmd_cat, "cd": self.cmd_cd, "pwd": self.cmd_pwd,
            "mkdir": self.cmd_mkdir, "rm": self.cmd_rm, "write": self.cmd_write, "tree": self.cmd_tree,
            "save": self.cmd_save, "sh": self.cmd_sh, "sync": self.cmd_sync,
            "claude": self.cmd_claude,
            "exit": self.cmd_exit, "quit": self.cmd_exit, "halt": self.cmd_exit,
        }

    # ------------------------------------------------------------ driver
    def prompt(self) -> str:
        return f"qubitos:{self.k.fs.cwd}$ "

    def execute_line(self, line: str) -> int:
        line = line.strip()
        if not line or line.startswith("#"):
            return 0
        for part in self._split(line):
            try:
                argv = shlex.split(part)
            except ValueError as exc:
                self.out(f"qsh: parse error: {exc}")
                self.last_status = 2
                continue
            if not argv:
                continue
            name, args = argv[0], argv[1:]
            fn = self.commands.get(name)
            if fn is None and name in self.k.programs:
                fn, args = self.cmd_run, [name] + args
            if fn is None:
                if name in _HOST_ONLY_COMMANDS:
                    self.out(
                        f"qsh: command not found: {name} -- qsh is QubitOS's own virtual shell, "
                        f"not your host terminal, so it can't run host programs like `{name}`. "
                        f"Install/run it in the terminal you used *before* starting `qubitos` "
                        f"(try 'help' for what qsh itself supports)."
                    )
                else:
                    self.out(f"qsh: command not found: {name} (try 'help')")
                self.last_status = 127
                continue
            try:
                fn(args)
                self.last_status = 0
            except (KernelError, FSError, ValueError, KeyError, IndexError) as exc:
                self.out(f"qsh: {name}: {exc}")
                self.last_status = 1
        return self.last_status

    @staticmethod
    def _split(line: str) -> List[str]:
        parts, buf, quote = [], "", None
        for ch in line:
            if quote:
                buf += ch
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
                buf += ch
            elif ch == ";":
                parts.append(buf)
                buf = ""
            else:
                buf += ch
        parts.append(buf)
        return [p for p in parts if p.strip()]

    def run_script(self, text: str) -> int:
        status = 0
        for line in text.splitlines():
            status = self.execute_line(line)
            if not self.running:
                break
        return status

    def repl(self, stdin=None) -> None:
        stdin = stdin or sys.stdin
        self.cmd_motd([])
        while self.running:
            try:
                if stdin.isatty():
                    line = input(self.prompt())
                else:
                    line = stdin.readline()
                    if not line:
                        break
            except EOFError:
                break
            except KeyboardInterrupt:
                self.out("")
                continue
            self.execute_line(line)

    # ------------------------------------------------------------ helpers
    def _result_of(self, token: str) -> Result:
        if token in ("last", "-"):
            if self.k.last_result is None:
                raise KernelError("no result yet")
            return self.k.last_result
        proc = self.k._process(int(token))
        if not isinstance(proc.result, Result):
            raise KernelError(f"pid {token} has no circuit result")
        return proc.result

    def _print_readouts(self, readouts) -> None:
        self.out("  qubit    r=<Z>      T=|<X>|    theta      p1       S_vn")
        for ro in readouts:
            flag = "  entangled" if ro["von_neumann"] > 1e-9 else ""
            self.out(f"  q{ro['qubit']:<5} {ro['r']:+.4f}   {ro['T']:.4f}    {ro['theta']:.4f}   "
                     f"{ro['p1']:.4f}   {ro['von_neumann']:.4f}{flag}")

    # ------------------------------------------------------------ system
    def cmd_help(self, args: List[str]) -> None:
        self.out("QubitOS shell (qsh) commands:")
        groups = [
            ("system", "help uname uptime dmesg sysctl [key [value]] backend [cpu|gpu|qnpu] motd echo exit"),
            ("processes", "run <prog> [args] [--shots N --seed S --prio P] | spawn <prog> [args] | sched | ps | kill <pid> | log <pid> | result <pid|last> | draw <prog> [args]"),
            ("memory", "alloc <n> [--name x --theta t1,t2,.. | --r r1,r2,..] | free <sid> | mem | reset <sid>"),
            ("registers", "gate <sid> <gate> <q..> [--p a,b] | measure <sid> [q..] [--shots N] | readout <sid> | state <sid> | ent <sid|last|pid>"),
            ("apqb", "apqb <theta> | apqb --r <r> | apqb --a <latent> | apqb --p1 <prob>  [--K k]"),
            ("files", "ls cat cd pwd mkdir rm write <path> <text> tree save <pid|last> <path> exec <circuit.json> sh <script.qsh> sync"),
            ("external", "claude [args...]  -- hand off to the Claude Code CLI installed on the host (e.g. via Homebrew)"),
        ]
        for name, text in groups:
            self.out(f"  {name:<10} {text}")
        self.out("programs in /bin: " + ", ".join(sorted(self.k.programs)))
        self.out("angles accept 'pi' suffix (0.25pi). Bitstrings print qubit 0 on the left.")

    def cmd_uname(self, args: List[str]) -> None:
        u = self.k.sys_uname()
        self.out(f"{u['os']} {u['version']} apqb-statevector {u['num_qubits']}q")

    def cmd_uptime(self, args: List[str]) -> None:
        u = self.k.sys_uname()
        mem = self.k.sys_mem()
        self.out(f"up {u['uptime']:.1f}s, {len(self.k.processes)} processes, "
                 f"{mem['used']}/{mem['total']} qubits allocated, sched eps={self.k.exploration_rate():.3f}")

    def cmd_dmesg(self, args: List[str]) -> None:
        n = int(args[0]) if args else 50
        for line in self.k.sys_dmesg(n):
            self.out(line)

    def cmd_sysctl(self, args: List[str]) -> None:
        if not args:
            for k, v in self.k.sys_sysctl().items():
                self.out(f"{k} = {v}")
            a = self.k.system_apqb()
            self.out(f"system APQB: r={a.r:+.4f} eta={a.T:.4f} -> exploration eps={self.k.exploration_rate():.4f}")
            return
        key = args[0]
        if "=" in key and len(args) == 1:
            key, val = key.split("=", 1)
            self.out(f"{key} = {self.k.sys_sysctl(key, val)}")
        elif len(args) >= 2:
            self.out(f"{key} = {self.k.sys_sysctl(key, args[1])}")
        else:
            self.out(f"{key} = {self.k.sys_sysctl(key)}")

    def cmd_backend(self, args: List[str]) -> None:
        if not args:
            info = self.k.sys_backend()
            self.out(f"current: {info['current']} (engine={info['engine']})")
            for b in info["available"]:
                flag = "*" if b["name"] == info["current"] else " "
                status = "available" if b["available"] else "unavailable"
                self.out(f"  {flag} {b['name']:<5} {status:<11} engine={b['engine']:<8} {b['detail']}")
            return
        self.out(f"backend = {self.k.sys_backend(args[0])}")

    def cmd_echo(self, args: List[str]) -> None:
        self.out(" ".join(args))

    def cmd_motd(self, args: List[str]) -> None:
        try:
            self.out(self.k.fs.read("/etc/motd").rstrip())
        except FSError:
            pass

    def cmd_exit(self, args: List[str]) -> None:
        self.running = False
        path = self.k.shutdown()
        self.out("QubitOS halted." + (f" Filesystem synced to {path}." if path else ""))

    # --------------------------------------------------------- processes
    def _run_opts(self, args: List[str]):
        parsed = parse_args(args)
        opts = parsed["opts"]
        shots = int(opts["shots"]) if "shots" in opts else None
        seed = int(opts["seed"]) if "seed" in opts else None
        prio = int(opts.get("prio", 5))
        # Pass the remaining options through to the program.
        passthrough: List[str] = list(parsed["pos"])
        for k, v in opts.items():
            if k in ("shots", "seed", "prio"):
                continue
            passthrough.append("--" + k)
            if v is not True:
                passthrough.append(str(v))
        return passthrough, shots, seed, prio

    def cmd_run(self, args: List[str]) -> None:
        if not args:
            raise ValueError("usage: run <program> [args] [--shots N --seed S]")
        name = args[0]
        argv, shots, seed, prio = self._run_opts(args[1:])
        proc = self.k.sys_run(name, argv, shots=shots, seed=seed, priority=prio)
        self._show_process(proc)

    def cmd_spawn(self, args: List[str]) -> None:
        if not args:
            raise ValueError("usage: spawn <program> [args] [--prio P]")
        argv, shots, seed, prio = self._run_opts(args[1:])
        proc = self.k.sys_spawn(args[0], argv, priority=prio, shots=shots, seed=seed)
        self.out(f"[{proc.pid}] {proc.name} ready (prio {prio})")

    def cmd_sched(self, args: List[str]) -> None:
        steps = int(args[0]) if args else None
        done = self.k.sys_schedule(steps)
        if not done:
            self.out("scheduler: nothing to run")
        for proc in done:
            self.out(f"--- pid {proc.pid} ({proc.name}) -> {proc.state.value}")
            self._show_process(proc, brief=True)

    def _show_process(self, proc, brief: bool = False) -> None:
        for line in proc.logs:
            self.out(line)
        if proc.state == ProcState.FAILED:
            self.out(f"pid {proc.pid} failed: {proc.error}")
            return
        if isinstance(proc.result, Result):
            self.out(proc.result.summary())
        elif proc.result is not None and not brief:
            self.out(json.dumps(proc.result, indent=2, ensure_ascii=False, default=str))

    def cmd_ps(self, args: List[str]) -> None:
        self.out(" PID  STATE    PRI   ELAPSED  COMMAND")
        for proc in self.k.sys_ps():
            self.out(proc.row())

    def cmd_kill(self, args: List[str]) -> None:
        proc = self.k.sys_kill(int(args[0]))
        self.out(f"pid {proc.pid} -> {proc.state.value}")

    def cmd_log(self, args: List[str]) -> None:
        proc = self.k._process(int(args[0]))
        for line in proc.logs:
            self.out(line)
        if proc.error:
            self.out(f"error: {proc.error}")

    def cmd_result(self, args: List[str]) -> None:
        res = self._result_of(args[0] if args else "last")
        self.out(res.summary())

    def cmd_draw(self, args: List[str]) -> None:
        if not args:
            raise ValueError("usage: draw <program> [args]")
        prog = self.k.programs.get(args[0])
        if prog is None or prog.circuit is None:
            raise KernelError(f"'{args[0]}' is not a circuit program")
        c = prog.circuit(args[1:])
        self.out(f"{c.name}: {c.num_qubits} qubits, {len(c)} instructions, depth {c.depth}")
        self.out(c.draw())

    # ------------------------------------------------------------ memory
    def _apqbs_from_opts(self, opts: Dict[str, Any], n: int) -> Optional[List[APQB]]:
        if "theta" in opts:
            vals = [_num(v) for v in str(opts["theta"]).split(",")]
            apqbs = [APQB(t) for t in vals]
        elif "r" in opts:
            apqbs = [APQB.from_r(_num(v)) for v in str(opts["r"]).split(",")]
        elif "a" in opts:
            apqbs = [APQB.from_latent(_num(v)) for v in str(opts["a"]).split(",")]
        else:
            return None
        if len(apqbs) != n:
            raise ValueError(f"expected {n} initial values, got {len(apqbs)}")
        return apqbs

    def cmd_alloc(self, args: List[str]) -> None:
        parsed = parse_args(args)
        if not parsed["pos"]:
            raise ValueError("usage: alloc <n> [--name x] [--theta t1,t2 | --r r1,r2 | --a a1,a2]")
        n = int(parsed["pos"][0])
        apqbs = self._apqbs_from_opts(parsed["opts"], n)
        seg = self.k.sys_alloc(n, name=str(parsed["opts"].get("name", "")), apqbs=apqbs)
        self.out(f"segment {seg.sid} '{seg.name}': physical qubits {seg.qubits}")
        self.out(f"state: {seg.state}")

    def cmd_free(self, args: List[str]) -> None:
        self.k.sys_free(int(args[0]))
        self.out(f"segment {args[0]} freed")

    def cmd_mem(self, args: List[str]) -> None:
        m = self.k.sys_mem()
        self.out(f"qubits: total {m['total']}  used {m['used']}  free {m['free']}")
        for s in m["segments"]:
            self.out(f"  sid {s['sid']:<3} {s['name']:<12} qubits={s['qubits']} ops={s['ops']}")

    def cmd_reset(self, args: List[str]) -> None:
        parsed = parse_args(args)
        sid = int(parsed["pos"][0])
        seg = self.k._segment(sid)
        apqbs = self._apqbs_from_opts(parsed["opts"], seg.size)
        self.k.sys_reset(sid, apqbs)
        self.out(f"state: {seg.state}")

    # --------------------------------------------------------- registers
    def cmd_gate(self, args: List[str]) -> None:
        parsed = parse_args(args)
        pos = parsed["pos"]
        if len(pos) < 3:
            raise ValueError("usage: gate <sid> <gate> <q...> [--p a,b]")
        sid, gate = int(pos[0]), pos[1]
        targets = [int(q) for q in pos[2:]]
        params = [_num(v) for v in str(parsed["opts"]["p"]).split(",")] if "p" in parsed["opts"] else []
        seg = self.k.sys_apply(sid, gate, targets, params)
        self.out(f"state: {seg.state}")

    def cmd_measure(self, args: List[str]) -> None:
        parsed = parse_args(args)
        sid = int(parsed["pos"][0])
        qs = [int(q) for q in parsed["pos"][1:]] or None
        shots = int(parsed["opts"].get("shots", 1))
        res = self.k.sys_measure(sid, qs, shots=shots)
        if "outcome" in res:
            self.out(f"outcome {res['outcome']} on qubits {res['qubits']} (register collapsed)")
            self.out(f"state: {self.k._segment(sid).state}")
        else:
            total = res["shots"]
            for k, v in res["counts"].items():
                self.out(f"  {k}  {v:>6}  {v / total:6.1%} " + "█" * int(40 * v / total))

    def cmd_readout(self, args: List[str]) -> None:
        self._print_readouts(self.k.sys_readout(int(args[0])))

    def cmd_state(self, args: List[str]) -> None:
        seg = self.k._segment(int(args[0]))
        self.out(f"segment {seg.sid} '{seg.name}': {seg.state}")
        for i, p in enumerate(seg.state.probabilities()):
            if p > 1e-12:
                self.out(f"  |{seg.state.index_to_bits(i)}>  p={p:.4f}")

    def cmd_ent(self, args: List[str]) -> None:
        token = args[0] if args else "last"
        if token.isdigit() and int(token) in self.k.segments:
            info = self.k.sys_entanglement(int(token))
        else:
            res = self._result_of(token)
            if res.state is None:
                raise KernelError("result has no state")
            info = self.k.entanglement_of(res.state)
        for key, val in info.items():
            if isinstance(val, list):
                self.out(f"  {key}: " + ", ".join(f"{v:+.4f}" for v in val))
            elif isinstance(val, float):
                self.out(f"  {key}: {val:.6f}")
            else:
                self.out(f"  {key}: {val}")
        if "concurrence" in info:
            holds = abs(info["C2^2 + r^2"] - 1.0) < 1e-9
            self.out("  (paper Eq. 13-14: C2 = η and C2² + r² = 1 hold for the |Psi2(θ)> family"
                     + (" -- satisfied)" if holds else " -- this state is outside that family)"))
        if "three_tangle" in info:
            holds = abs(info["tau3 + r^2"] - 1.0) < 1e-9
            self.out("  (paper Eq. 16-17: τ3 = η² and τ3 + r² = 1 hold for the |Psi3(θ)> family"
                     + (" -- satisfied)" if holds else " -- this state is outside that family)"))

    # -------------------------------------------------------------- apqb
    def cmd_apqb(self, args: List[str]) -> None:
        parsed = parse_args(args)
        opts = parsed["opts"]
        if "r" in opts:
            q = APQB.from_r(_num(opts["r"]))
        elif "a" in opts:
            q = APQB.from_latent(_num(opts["a"]))
        elif "p1" in opts:
            q = APQB.from_probability(_num(opts["p1"]))
        elif parsed["pos"]:
            q = APQB(_num(parsed["pos"][0]))
        else:
            q = self.k.system_apqb()
            self.out("(system APQB)")
        c, s = q.amplitudes
        self.out(f"|ψ(θ)> = {c.real:.4f}|0> + {s.real:.4f}|1>   θ = {q.theta:.4f} rad ({math.degrees(q.theta):.1f}°)")
        self.out(f"r = cos2θ = {q.r:+.4f}   η = T = |sin2θ| = {q.T:.4f}   r²+η² = {q.constraint():.6f}")
        self.out(f"P(0) = {q.probabilities[0]:.4f}   P(1) = {q.probabilities[1]:.4f}   H_Z = {q.entropy:.4f} bit")
        self.out(f"z = e^(i2θ) = {q.z.real:+.4f}{q.z.imag:+.4f}i   Bloch = {tuple(round(v, 4) for v in q.bloch)}")
        K = int(opts.get("K", 3))
        re, im = q.features(K)
        self.out("Chebyshev features Re z^k = T_k(r): " + ", ".join(f"{v:+.4f}" for v in re))
        self.out("                   Im z^k = η U_k-1(r): " + ", ".join(f"{v:+.4f}" for v in im))
        self.out(f"temperature control τ(η) on [0.1, 1.0]: {0.1 + 0.9 * q.T:.4f}")

    # ------------------------------------------------------------- files
    def cmd_ls(self, args: List[str]) -> None:
        for name in self.k.fs.ls(args[0] if args else ""):
            self.out(name)

    def cmd_cat(self, args: List[str]) -> None:
        for path in args:
            self.out(self.k.fs.read(path).rstrip("\n"))

    def cmd_cd(self, args: List[str]) -> None:
        self.k.fs.cd(args[0] if args else "/home/user")

    def cmd_pwd(self, args: List[str]) -> None:
        self.out(self.k.fs.cwd)

    def cmd_mkdir(self, args: List[str]) -> None:
        for path in args:
            self.k.fs.mkdir(path)

    def cmd_rm(self, args: List[str]) -> None:
        recursive = "-r" in args
        for path in args:
            if path != "-r":
                self.k.fs.rm(path, recursive=recursive)

    def cmd_write(self, args: List[str]) -> None:
        if len(args) < 2:
            raise ValueError("usage: write <path> <text...>")
        self.k.fs.write(args[0], " ".join(args[1:]) + "\n")

    def cmd_tree(self, args: List[str]) -> None:
        path = args[0] if args else "/"
        self.out(path)
        for line in self.k.fs.tree(path):
            self.out(line)

    def cmd_save(self, args: List[str]) -> None:
        if len(args) < 2:
            raise ValueError("usage: save <pid|last> <path>")
        token, path = args[0], args[1]
        if token == "last":
            procs = [p for p in self.k.processes.values() if p.circuit is not None]
            if not procs:
                raise KernelError("no circuit to save")
            proc = procs[-1]
        else:
            proc = self.k._process(int(token))
        if proc.circuit is None:
            raise KernelError("process has no circuit")
        self.k.fs.write(path, proc.circuit.to_json())
        self.out(f"saved circuit '{proc.circuit.name}' to {path}")

    def cmd_exec(self, args: List[str]) -> None:
        parsed = parse_args(args)
        if not parsed["pos"]:
            raise ValueError("usage: exec <circuit.json> [--shots N --seed S]")
        circuit = Circuit.from_dict(self.k.fs.read_json(parsed["pos"][0]))
        shots = int(parsed["opts"]["shots"]) if "shots" in parsed["opts"] else None
        seed = int(parsed["opts"]["seed"]) if "seed" in parsed["opts"] else None
        self.out(circuit.draw())
        self.out(self.k.sys_exec_circuit(circuit, shots=shots, seed=seed).summary())

    def cmd_sh(self, args: List[str]) -> None:
        if not args:
            raise ValueError("usage: sh <script.qsh>")
        self.run_script(self.k.fs.read(args[0]))

    def cmd_sync(self, args: List[str]) -> None:
        path = self.k.fs.sync()
        self.out(f"synced to {path}" if path else "in-memory filesystem (boot with --fs PATH to persist)")

    # -------------------------------------------------------------- host
    def cmd_claude(self, args: List[str]) -> None:
        """Hand off to the Claude Code CLI (`claude`) installed on the host, e.g. via Homebrew."""
        exe = shutil.which("claude")
        if exe is None:
            raise KernelError(
                "claude: command not found on PATH. Install the Claude Code CLI first, e.g. "
                "`brew install claude-code` (see https://claude.com/claude-code for other install "
                "methods), then restart qsh."
            )
        status = subprocess.call([exe, *args])
        if status:
            raise KernelError(f"claude exited with status {status}")
