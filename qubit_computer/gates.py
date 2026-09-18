"""Gate library for Qubit Computer.

Gates are plain nested lists of ``complex`` (row-major unitary matrices)
so the simulator has no third-party dependencies.  Parametric gates are
functions returning a matrix; fixed gates are module-level constants.

The APQB-native gates are:

* ``APQB(theta)``   -- RY(2 theta): |0> -> cos(theta)|0> + sin(theta)|1>
* ``APQB_R(r)``     -- prepare from a correlation coefficient r = cos(2 theta)
* ``APQB_A(a)``     -- prepare from an unconstrained latent a (tanh / sech)
"""

from __future__ import annotations

import cmath
import math
from typing import Callable, Dict, List, Sequence

from .apqb import theta_from_latent, theta_from_r

Matrix = List[List[complex]]

_SQRT1_2 = 1.0 / math.sqrt(2.0)

# ----------------------------------------------------------------- 1-qubit
I: Matrix = [[1, 0], [0, 1]]
X: Matrix = [[0, 1], [1, 0]]
Y: Matrix = [[0, -1j], [1j, 0]]
Z: Matrix = [[1, 0], [0, -1]]
H: Matrix = [[_SQRT1_2, _SQRT1_2], [_SQRT1_2, -_SQRT1_2]]
S: Matrix = [[1, 0], [0, 1j]]
SDG: Matrix = [[1, 0], [0, -1j]]
T: Matrix = [[1, 0], [0, cmath.exp(1j * math.pi / 4)]]
TDG: Matrix = [[1, 0], [0, cmath.exp(-1j * math.pi / 4)]]
SX: Matrix = [[0.5 + 0.5j, 0.5 - 0.5j], [0.5 - 0.5j, 0.5 + 0.5j]]


def RX(theta: float) -> Matrix:
    c, s = math.cos(theta / 2), math.sin(theta / 2)
    return [[c, -1j * s], [-1j * s, c]]


def RY(theta: float) -> Matrix:
    c, s = math.cos(theta / 2), math.sin(theta / 2)
    return [[c, -s], [s, c]]


def RZ(theta: float) -> Matrix:
    return [[cmath.exp(-1j * theta / 2), 0], [0, cmath.exp(1j * theta / 2)]]


def P(lam: float) -> Matrix:
    """Phase gate diag(1, e^{i lam})."""
    return [[1, 0], [0, cmath.exp(1j * lam)]]


def U(theta: float, phi: float, lam: float) -> Matrix:
    """Generic single-qubit rotation U(theta, phi, lambda) (OpenQASM convention)."""
    c, s = math.cos(theta / 2), math.sin(theta / 2)
    return [
        [c, -cmath.exp(1j * lam) * s],
        [cmath.exp(1j * phi) * s, cmath.exp(1j * (phi + lam)) * c],
    ]


def APQB(theta: float) -> Matrix:
    """APQB preparation gate: RY(2 theta).

    Acting on |0> it yields the APQB state cos(theta)|0> + sin(theta)|1>,
    so r = cos(2 theta) and T = |sin(2 theta)| are read back exactly.
    """
    return RY(2.0 * theta)


def APQB_R(r: float) -> Matrix:
    """APQB preparation from a correlation coefficient r in [-1, 1]."""
    return APQB(theta_from_r(r))


def APQB_A(a: float) -> Matrix:
    """APQB preparation from an unconstrained latent a (r=tanh a, T=sech a)."""
    return APQB(theta_from_latent(a)[2])


# ----------------------------------------------------------------- 2-qubit
# Convention: for a k-qubit matrix the basis index is
#   idx = sum_j bit(target_j) << (k-1-j)
# i.e. the FIRST target listed is the most significant bit.  For CX this
# means targets=(control, target).


def controlled(u: Matrix) -> Matrix:
    """Return the controlled version of a k-qubit unitary (control = first qubit)."""
    n = len(u)
    dim = 2 * n
    m: Matrix = [[0j] * dim for _ in range(dim)]
    for i in range(n):
        m[i][i] = 1
    for i in range(n):
        for j in range(n):
            m[n + i][n + j] = u[i][j]
    return m


CX: Matrix = controlled(X)
CY: Matrix = controlled(Y)
CZ: Matrix = controlled(Z)
CH: Matrix = controlled(H)
SWAP: Matrix = [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]
ISWAP: Matrix = [[1, 0, 0, 0], [0, 0, 1j, 0], [0, 1j, 0, 0], [0, 0, 0, 1]]


def CRX(theta: float) -> Matrix:
    return controlled(RX(theta))


def CRY(theta: float) -> Matrix:
    return controlled(RY(theta))


def CRZ(theta: float) -> Matrix:
    return controlled(RZ(theta))


def CP(lam: float) -> Matrix:
    return controlled(P(lam))


def CAPQB(theta: float) -> Matrix:
    """Controlled APQB preparation (controlled RY(2 theta))."""
    return controlled(APQB(theta))


def RXX(theta: float) -> Matrix:
    c, s = math.cos(theta / 2), -1j * math.sin(theta / 2)
    return [[c, 0, 0, s], [0, c, s, 0], [0, s, c, 0], [s, 0, 0, c]]


def RZZ(theta: float) -> Matrix:
    e_m, e_p = cmath.exp(-1j * theta / 2), cmath.exp(1j * theta / 2)
    return [[e_m, 0, 0, 0], [0, e_p, 0, 0], [0, 0, e_p, 0], [0, 0, 0, e_m]]


# ----------------------------------------------------------------- 3-qubit
CCX: Matrix = controlled(CX)  # Toffoli, targets=(c1, c2, t)
CSWAP: Matrix = controlled(SWAP)  # Fredkin, targets=(c, a, b)


# ----------------------------------------------------------------- registry
FIXED_GATES: Dict[str, Matrix] = {
    "i": I, "id": I, "x": X, "y": Y, "z": Z, "h": H, "s": S, "sdg": SDG,
    "t": T, "tdg": TDG, "sx": SX,
    "cx": CX, "cnot": CX, "cy": CY, "cz": CZ, "ch": CH, "swap": SWAP,
    "iswap": ISWAP, "ccx": CCX, "toffoli": CCX, "cswap": CSWAP, "fredkin": CSWAP,
}

PARAM_GATES: Dict[str, Callable[..., Matrix]] = {
    "rx": RX, "ry": RY, "rz": RZ, "p": P, "u": U,
    "apqb": APQB, "apqb_r": APQB_R, "apqb_a": APQB_A,
    "crx": CRX, "cry": CRY, "crz": CRZ, "cp": CP, "capqb": CAPQB,
    "rxx": RXX, "rzz": RZZ,
}

GATE_ARITY: Dict[str, int] = {
    **{k: 1 for k in ("i", "id", "x", "y", "z", "h", "s", "sdg", "t", "tdg", "sx",
                      "rx", "ry", "rz", "p", "u", "apqb", "apqb_r", "apqb_a")},
    **{k: 2 for k in ("cx", "cnot", "cy", "cz", "ch", "swap", "iswap",
                      "crx", "cry", "crz", "cp", "capqb", "rxx", "rzz")},
    **{k: 3 for k in ("ccx", "toffoli", "cswap", "fredkin")},
}


def resolve(name: str, params: Sequence[float] = ()) -> Matrix:
    """Look up a gate by name and instantiate it with ``params``."""
    key = name.lower()
    if key in FIXED_GATES:
        if params:
            raise ValueError(f"gate '{name}' takes no parameters")
        return FIXED_GATES[key]
    if key in PARAM_GATES:
        return PARAM_GATES[key](*params)
    raise KeyError(f"unknown gate '{name}'")


def is_unitary(m: Matrix, tol: float = 1e-9) -> bool:
    """Check m^dagger m = I."""
    n = len(m)
    for i in range(n):
        for j in range(n):
            acc = 0j
            for k in range(n):
                acc += m[k][i].conjugate() * m[k][j]
            if abs(acc - (1.0 if i == j else 0.0)) > tol:
                return False
    return True


def dagger(m: Matrix) -> Matrix:
    n = len(m)
    return [[complex(m[j][i]).conjugate() for j in range(n)] for i in range(n)]
