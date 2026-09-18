"""Circuit builder for Qubit Computer.

A ``Circuit`` is an ordered list of ``Instruction``s.  It is backend
agnostic: the ``QubitComputer`` executes it, and it can be serialized to
JSON so circuits can be shared between Python and other Qubit AI tools.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from . import gates as G
from .apqb import APQB

__all__ = ["Instruction", "Circuit"]


@dataclass(frozen=True)
class Instruction:
    name: str
    targets: Tuple[int, ...]
    params: Tuple[float, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"gate": self.name, "targets": list(self.targets)}
        if self.params:
            d["params"] = list(self.params)
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Instruction":
        name = d.get("gate") or d.get("name")
        if not name:
            raise ValueError("instruction needs a 'gate' field")
        targets = d.get("targets", d.get("qubits", []))
        if isinstance(targets, int):
            targets = [targets]
        return cls(str(name).lower(), tuple(int(t) for t in targets),
                   tuple(float(p) for p in d.get("params", [])))

    @property
    def is_measurement(self) -> bool:
        return self.name == "measure"

    @property
    def is_barrier(self) -> bool:
        return self.name == "barrier"


class Circuit:
    """Chainable quantum circuit on ``num_qubits`` qubits.

    >>> c = Circuit(2).h(0).cx(0, 1)
    >>> len(c)
    2
    """

    def __init__(self, num_qubits: int, name: str = "circuit"):
        if num_qubits < 1:
            raise ValueError("a circuit needs at least one qubit")
        self.num_qubits = num_qubits
        self.name = name
        self.instructions: List[Instruction] = []
        self.initial_apqbs: Optional[List[APQB]] = None

    # --------------------------------------------------------- generic
    def append(self, name: str, targets: Sequence[int], params: Sequence[float] = ()) -> "Circuit":
        key = name.lower()
        targets = tuple(int(t) for t in targets)
        for t in targets:
            if not 0 <= t < self.num_qubits:
                raise IndexError(f"qubit {t} out of range (circuit has {self.num_qubits})")
        if key not in ("measure", "barrier"):
            if key not in G.GATE_ARITY:
                raise KeyError(f"unknown gate '{name}'")
            if G.GATE_ARITY[key] != len(targets):
                raise ValueError(f"gate '{name}' acts on {G.GATE_ARITY[key]} qubit(s), got {len(targets)}")
            if len(set(targets)) != len(targets):
                raise ValueError("targets must be distinct")
            # Validate parameters eagerly so JSON circuits fail fast.
            G.resolve(key, params)
        self.instructions.append(Instruction(key, targets, tuple(float(p) for p in params)))
        return self

    def __len__(self) -> int:
        return len(self.instructions)

    def __iter__(self):
        return iter(self.instructions)

    # ------------------------------------------------- APQB preparation
    def prepare(self, apqbs: Sequence[APQB]) -> "Circuit":
        """Set the initial register to a product of APQBs (one per qubit)."""
        if len(apqbs) != self.num_qubits:
            raise ValueError("need one APQB per qubit")
        self.initial_apqbs = list(apqbs)
        return self

    def prepare_from_correlations(self, rs: Sequence[float]) -> "Circuit":
        return self.prepare([APQB.from_r(r) for r in rs])

    def apqb(self, q: int, theta: float) -> "Circuit":
        """APQB gate: rotate qubit ``q`` by RY(2 theta)."""
        return self.append("apqb", [q], [theta])

    def apqb_r(self, q: int, r: float) -> "Circuit":
        return self.append("apqb_r", [q], [r])

    def apqb_a(self, q: int, a: float) -> "Circuit":
        return self.append("apqb_a", [q], [a])

    def capqb(self, c: int, t: int, theta: float) -> "Circuit":
        return self.append("capqb", [c, t], [theta])

    # --------------------------------------------------- 1-qubit gates
    def i(self, q: int) -> "Circuit":
        return self.append("i", [q])

    def x(self, q: int) -> "Circuit":
        return self.append("x", [q])

    def y(self, q: int) -> "Circuit":
        return self.append("y", [q])

    def z(self, q: int) -> "Circuit":
        return self.append("z", [q])

    def h(self, q: int) -> "Circuit":
        return self.append("h", [q])

    def s(self, q: int) -> "Circuit":
        return self.append("s", [q])

    def sdg(self, q: int) -> "Circuit":
        return self.append("sdg", [q])

    def t(self, q: int) -> "Circuit":
        return self.append("t", [q])

    def tdg(self, q: int) -> "Circuit":
        return self.append("tdg", [q])

    def sx(self, q: int) -> "Circuit":
        return self.append("sx", [q])

    def rx(self, q: int, theta: float) -> "Circuit":
        return self.append("rx", [q], [theta])

    def ry(self, q: int, theta: float) -> "Circuit":
        return self.append("ry", [q], [theta])

    def rz(self, q: int, theta: float) -> "Circuit":
        return self.append("rz", [q], [theta])

    def p(self, q: int, lam: float) -> "Circuit":
        return self.append("p", [q], [lam])

    def u(self, q: int, theta: float, phi: float, lam: float) -> "Circuit":
        return self.append("u", [q], [theta, phi, lam])

    # --------------------------------------------------- 2-qubit gates
    def cx(self, c: int, t: int) -> "Circuit":
        return self.append("cx", [c, t])

    cnot = cx

    def cy(self, c: int, t: int) -> "Circuit":
        return self.append("cy", [c, t])

    def cz(self, c: int, t: int) -> "Circuit":
        return self.append("cz", [c, t])

    def ch(self, c: int, t: int) -> "Circuit":
        return self.append("ch", [c, t])

    def swap(self, a: int, b: int) -> "Circuit":
        return self.append("swap", [a, b])

    def iswap(self, a: int, b: int) -> "Circuit":
        return self.append("iswap", [a, b])

    def crx(self, c: int, t: int, theta: float) -> "Circuit":
        return self.append("crx", [c, t], [theta])

    def cry(self, c: int, t: int, theta: float) -> "Circuit":
        return self.append("cry", [c, t], [theta])

    def crz(self, c: int, t: int, theta: float) -> "Circuit":
        return self.append("crz", [c, t], [theta])

    def cp(self, c: int, t: int, lam: float) -> "Circuit":
        return self.append("cp", [c, t], [lam])

    def rxx(self, a: int, b: int, theta: float) -> "Circuit":
        return self.append("rxx", [a, b], [theta])

    def rzz(self, a: int, b: int, theta: float) -> "Circuit":
        return self.append("rzz", [a, b], [theta])

    # --------------------------------------------------- 3-qubit gates
    def ccx(self, c1: int, c2: int, t: int) -> "Circuit":
        return self.append("ccx", [c1, c2, t])

    toffoli = ccx

    def cswap(self, c: int, a: int, b: int) -> "Circuit":
        return self.append("cswap", [c, a, b])

    fredkin = cswap

    # ----------------------------------------------------- non-unitary
    def measure(self, *qubits: int) -> "Circuit":
        """Measure ``qubits`` (default: all) into the classical result."""
        if not qubits:
            qubits = tuple(range(self.num_qubits))
        return self.append("measure", list(qubits))

    def barrier(self) -> "Circuit":
        return self.append("barrier", [])

    # ------------------------------------------------------ composition
    def compose(self, other: "Circuit", qubits: Optional[Sequence[int]] = None) -> "Circuit":
        """Append ``other`` (mapped onto ``qubits``) to this circuit."""
        if qubits is None:
            qubits = list(range(other.num_qubits))
        if len(qubits) != other.num_qubits:
            raise ValueError("qubit map must cover every qubit of the sub-circuit")
        for ins in other.instructions:
            self.append(ins.name, [qubits[t] for t in ins.targets], ins.params)
        return self

    def inverse(self) -> "Circuit":
        """Return the adjoint circuit (measurements/barriers dropped)."""
        inv = Circuit(self.num_qubits, name=f"{self.name}_dg")
        adj = {"s": "sdg", "sdg": "s", "t": "tdg", "tdg": "t"}
        for ins in reversed(self.instructions):
            if ins.is_measurement or ins.is_barrier:
                continue
            name = ins.name
            if name in adj:
                inv.append(adj[name], ins.targets)
            elif name in ("sx",):
                # sx^dagger = sx^3
                for _ in range(3):
                    inv.append("sx", ins.targets)
            elif name in ("iswap",):
                for _ in range(3):
                    inv.append("iswap", ins.targets)
            elif ins.params:
                inv.append(name, ins.targets, [-p for p in ins.params] if name != "u"
                           else [-ins.params[0], -ins.params[2], -ins.params[1]])
            else:
                inv.append(name, ins.targets)
        return inv

    @property
    def measured_qubits(self) -> List[int]:
        out: List[int] = []
        for ins in self.instructions:
            if ins.is_measurement:
                for t in ins.targets:
                    if t not in out:
                        out.append(t)
        return out

    @property
    def depth(self) -> int:
        layer = [0] * self.num_qubits
        d = 0
        for ins in self.instructions:
            if ins.is_barrier:
                continue
            level = max((layer[t] for t in ins.targets), default=0) + 1
            for t in ins.targets:
                layer[t] = level
            d = max(d, level)
        return d

    # ---------------------------------------------------- serialization
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "name": self.name,
            "num_qubits": self.num_qubits,
            "instructions": [ins.to_dict() for ins in self.instructions],
        }
        if self.initial_apqbs is not None:
            d["initial_thetas"] = [q.theta for q in self.initial_apqbs]
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Circuit":
        c = cls(int(d["num_qubits"]), name=str(d.get("name", "circuit")))
        if "initial_thetas" in d:
            c.prepare([APQB(float(t)) for t in d["initial_thetas"]])
        elif "initial_correlations" in d:
            c.prepare_from_correlations([float(r) for r in d["initial_correlations"]])
        for raw in d.get("instructions", []):
            ins = Instruction.from_dict(raw)
            c.append(ins.name, ins.targets, ins.params)
        return c

    @classmethod
    def from_json(cls, text: str) -> "Circuit":
        return cls.from_dict(json.loads(text))

    # ------------------------------------------------------------ draw
    def draw(self) -> str:
        """ASCII circuit diagram (qubit 0 on top)."""
        cols: List[List[str]] = []
        for ins in self.instructions:
            col = ["─" * 7] * self.num_qubits
            if ins.is_barrier:
                col = ["──░────"] * self.num_qubits
            elif ins.is_measurement:
                for t in ins.targets:
                    col[t] = "──[M]──"
            else:
                label = ins.name.upper()
                if ins.params:
                    label += "(" + ",".join(f"{p:.2f}" for p in ins.params) + ")"
                width = max(len(label) + 2, 7)
                col = ["─" * width] * self.num_qubits
                ctrl_names = {"cx", "cnot", "cy", "cz", "ch", "crx", "cry", "crz", "cp", "capqb",
                              "ccx", "toffoli", "cswap", "fredkin"}
                if ins.name in ctrl_names:
                    n_ctrl = 2 if ins.name in ("ccx", "toffoli") else 1
                    body = label[1:] if ins.name not in ("cnot", "toffoli", "fredkin") else \
                        {"cnot": "X", "toffoli": "X", "fredkin": "SWAP"}[ins.name]
                    if ins.name in ("ccx",):
                        body = "X"
                    if ins.name == "cswap":
                        body = "SWAP"
                    lo, hi = min(ins.targets), max(ins.targets)
                    for q in range(lo, hi + 1):
                        col[q] = "───┼" + "─" * (width - 4)
                    for c in ins.targets[:n_ctrl]:
                        col[c] = "───●" + "─" * (width - 4)
                    for t in ins.targets[n_ctrl:]:
                        col[t] = ("[" + body + "]").center(width, "─")
                elif ins.name in ("swap", "iswap", "rxx", "rzz"):
                    lo, hi = min(ins.targets), max(ins.targets)
                    for q in range(lo, hi + 1):
                        col[q] = "───┼" + "─" * (width - 4)
                    for t in ins.targets:
                        col[t] = ("[" + label + "]").center(width, "─")
                else:
                    for t in ins.targets:
                        col[t] = ("[" + label + "]").center(width, "─")
            cols.append(col)
        lines = []
        for q in range(self.num_qubits):
            init = ""
            if self.initial_apqbs is not None:
                init = f"|APQB θ={self.initial_apqbs[q].theta:.2f}>"
            else:
                init = "|0>"
            lines.append(f"q{q}: {init:>14} " + "".join(col[q] for col in cols))
        return "\n".join(lines)

    def __str__(self) -> str:
        return self.draw()
