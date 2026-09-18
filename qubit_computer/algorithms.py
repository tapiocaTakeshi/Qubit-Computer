"""Reference circuits and APQB-native routines for Qubit Computer.

Every function returns a ``Circuit`` so it can be run, drawn, serialized
or composed.  The APQB-specific families of the paper are included:

* ``bell_apqb(theta)``  -> |Psi2> = cos(theta)|00> + sin(theta)|11>   (Eq. 12)
* ``ghz_apqb(theta)``   -> |Psi3> = cos(theta)|000> + sin(theta)|111> (Eq. 15)
* ``correlation_register(rs)`` -> product of APQBs with r_i = cos(2 theta_i) (Eq. 18)
"""

from __future__ import annotations

import math
from typing import Callable, Dict, Iterable, List, Sequence

from .apqb import APQB
from .circuit import Circuit

__all__ = [
    "bell", "bell_apqb", "ghz", "ghz_apqb", "correlation_register",
    "teleportation", "deutsch_jozsa", "grover", "qft", "inverse_qft",
    "superdense_coding", "PROGRAMS",
]


def bell() -> Circuit:
    return Circuit(2, "bell").h(0).cx(0, 1)


def bell_apqb(theta: float) -> Circuit:
    """|Psi2(theta)> = cos(theta)|00> + sin(theta)|11> (paper Eq. 12)."""
    return Circuit(2, f"bell_apqb(θ={theta:.3f})").apqb(0, theta).cx(0, 1)


def ghz(n: int = 3) -> Circuit:
    c = Circuit(n, f"ghz{n}").h(0)
    for q in range(1, n):
        c.cx(q - 1, q)
    return c


def ghz_apqb(theta: float, n: int = 3) -> Circuit:
    """|Psi_n(theta)> = cos(theta)|0...0> + sin(theta)|1...1> (paper Eq. 15)."""
    c = Circuit(n, f"ghz_apqb(θ={theta:.3f})").apqb(0, theta)
    for q in range(1, n):
        c.cx(q - 1, q)
    return c


def correlation_register(rs: Sequence[float]) -> Circuit:
    """Encode correlation coefficients r_i into an APQB register (Eq. 18)."""
    c = Circuit(len(rs), "correlation_register")
    for q, r in enumerate(rs):
        c.apqb_r(q, r)
    return c


def teleportation(theta: float = 0.3) -> Circuit:
    """Teleport the APQB |psi(theta)> from qubit 0 to qubit 2.

    Uses deferred measurement (classically-controlled corrections replaced
    by CX/CZ), so the final state of qubit 2 is exactly |psi(theta)>.
    """
    c = Circuit(3, f"teleport(θ={theta:.3f})")
    c.apqb(0, theta)          # message
    c.h(1).cx(1, 2)           # shared Bell pair
    c.cx(0, 1).h(0)           # Bell measurement basis
    c.cx(1, 2).cz(0, 2)       # corrections (deferred measurement)
    return c


def superdense_coding(bits: str = "10") -> Circuit:
    c = Circuit(2, f"superdense({bits})").h(0).cx(0, 1)
    if bits[1] == "1":
        c.x(0)
    if bits[0] == "1":
        c.z(0)
    c.cx(0, 1).h(0)
    return c


def deutsch_jozsa(n: int, oracle: str = "balanced") -> Circuit:
    """Deutsch-Jozsa on n input qubits + 1 ancilla.

    ``oracle``: 'constant0', 'constant1' or 'balanced' (f(x) = x_0 XOR ... ).
    Measuring the input register gives all-zeros iff f is constant.
    """
    c = Circuit(n + 1, f"deutsch_jozsa({oracle})")
    anc = n
    c.x(anc)
    for q in range(n + 1):
        c.h(q)
    if oracle == "constant1":
        c.x(anc)
    elif oracle == "balanced":
        for q in range(n):
            c.cx(q, anc)
    elif oracle != "constant0":
        raise ValueError("oracle must be constant0, constant1 or balanced")
    for q in range(n):
        c.h(q)
    c.measure(*range(n))
    return c


def _multi_controlled_z(c: Circuit, qubits: List[int]) -> None:
    """Apply Z on the |1...1> state of ``qubits`` (any count) via decomposition."""
    k = len(qubits)
    if k == 1:
        c.z(qubits[0])
    elif k == 2:
        c.cz(qubits[0], qubits[1])
    elif k == 3:
        c.h(qubits[2]).ccx(qubits[0], qubits[1], qubits[2]).h(qubits[2])
    else:
        # Gray-code style decomposition via controlled-phase ladder.
        # Simple exact construction: C^{k-1}Z = product of CP gates (Barenco).
        _mcz_recursive(c, qubits[:-1], qubits[-1], math.pi)


def _mcz_recursive(c: Circuit, controls: List[int], target: int, angle: float) -> None:
    if len(controls) == 1:
        c.cp(controls[0], target, angle)
        return
    last = controls[-1]
    rest = controls[:-1]
    c.cp(last, target, angle / 2)
    _mcx_recursive(c, rest, last)
    c.cp(last, target, -angle / 2)
    _mcx_recursive(c, rest, last)
    _mcz_recursive(c, rest, target, angle / 2)


def _mcx_recursive(c: Circuit, controls: List[int], target: int) -> None:
    if len(controls) == 1:
        c.cx(controls[0], target)
    elif len(controls) == 2:
        c.ccx(controls[0], controls[1], target)
    else:
        c.h(target)
        _mcz_recursive(c, controls, target, math.pi)
        c.h(target)


def grover(n: int, marked: str, iterations: int | None = None) -> Circuit:
    """Grover search for the bitstring ``marked`` (qubit 0 = leftmost char)."""
    if len(marked) != n:
        raise ValueError("marked bitstring length must equal n")
    if iterations is None:
        iterations = max(1, int(math.pi / 4 * math.sqrt(2 ** n)))
    c = Circuit(n, f"grover({marked})")
    for q in range(n):
        c.h(q)
    for _ in range(iterations):
        # Oracle: phase flip on |marked>.
        for q, b in enumerate(marked):
            if b == "0":
                c.x(q)
        _multi_controlled_z(c, list(range(n)))
        for q, b in enumerate(marked):
            if b == "0":
                c.x(q)
        # Diffusion.
        for q in range(n):
            c.h(q).x(q)
        _multi_controlled_z(c, list(range(n)))
        for q in range(n):
            c.x(q).h(q)
    c.measure()
    return c


def qft(n: int, swap: bool = True) -> Circuit:
    """Quantum Fourier transform on n qubits (qubit 0 = most significant)."""
    c = Circuit(n, f"qft{n}")
    for j in range(n):
        c.h(j)
        for k in range(j + 1, n):
            c.cp(k, j, math.pi / (2 ** (k - j)))
    if swap:
        for j in range(n // 2):
            c.swap(j, n - 1 - j)
    return c


def inverse_qft(n: int, swap: bool = True) -> Circuit:
    inv = qft(n, swap).inverse()
    inv.name = f"iqft{n}"
    return inv


PROGRAMS: Dict[str, Callable[..., Circuit]] = {
    "bell": bell,
    "bell_apqb": bell_apqb,
    "ghz": ghz,
    "ghz_apqb": ghz_apqb,
    "correlation_register": correlation_register,
    "teleport": teleportation,
    "superdense": superdense_coding,
    "deutsch_jozsa": deutsch_jozsa,
    "grover": grover,
    "qft": qft,
    "iqft": inverse_qft,
}
