"""APQB (Adjustable Pseudo Quantum Bit) -- the basic unit of Qubit Computer.

This module is a dependency-free port of the APQB formalization used by
Qubit AI (``apqb_qbnn_v2.py`` / ``qbnn_layered.py`` in the Qubit repository).

Core relations (see the Qubit README):

    |psi(theta)> = cos(theta)|0> + sin(theta)|1>
    r = cos(2 theta)          correlation / confidence  (= <Z>)
    T = |sin(2 theta)|        fluctuation / exploration (= |<X>|)
    r^2 + T^2 = 1
    z = r + i T = e^{i 2 theta}

An APQB is a *real-amplitude* single-qubit state, so it lives on the
great circle of the Bloch sphere spanned by Z and X.  Qubit Computer uses
APQBs as the initial states of its register and reads r / T back out of
any (possibly entangled) qubit through its reduced density matrix.
"""

from __future__ import annotations

import cmath
import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

__all__ = [
    "APQB",
    "theta_from_r",
    "theta_from_latent",
    "chebyshev_features",
    "Q_k",
]


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def theta_from_r(r: float) -> float:
    """Eq. (4): theta(r) = (1/2) arccos(r), theta in [0, pi/2]."""
    return 0.5 * math.acos(_clamp(r, -1.0, 1.0))


def theta_from_latent(a: float) -> Tuple[float, float, float]:
    """Eq. (12): unconstrained latent ``a`` -> (r, T, theta).

    r = tanh(a), T = sech(a); tanh^2 + sech^2 = 1 holds automatically.
    Overflow-safe for |a| up to the float range.
    """
    r = math.tanh(a)
    # sech(a) = 2 / (e^a + e^-a), computed without overflow.
    aa = abs(a)
    T = 2.0 * math.exp(-aa) / (1.0 + math.exp(-2.0 * aa))
    theta = 0.5 * math.atan2(T, r)
    return r, T, theta


def Q_k(theta: float, k: int) -> float:
    """k-body correlation Q_k(theta) = Re/Im of z^k = e^{i 2 k theta}.

    Following ``qbnn_layered.APQB.Q_k``: even k -> cos(2 k theta),
    odd k -> sin(2 k theta).
    """
    if k % 2 == 0:
        return math.cos(2.0 * k * theta)
    return math.sin(2.0 * k * theta)


def chebyshev_features(r: float, T: float, K: int) -> Tuple[List[float], List[float]]:
    """Prop. 2 (Eq. 15-16): Re(z^k) = T_k(r), Im(z^k) = T * U_{k-1}(r), k=1..K.

    Uses the z^k = z^{k-1} z recurrence, exactly as ``apqb_qbnn_v2``.
    Returns ``(real_feats, imag_feats)`` each of length ``K``.
    """
    z = complex(r, T)
    reals: List[float] = []
    imags: List[float] = []
    zk = complex(1.0, 0.0)
    for _ in range(K):
        zk = zk * z
        reals.append(zk.real)
        imags.append(zk.imag)
    return reals, imags


@dataclass(frozen=True)
class APQB:
    """An Adjustable Pseudo Quantum Bit parameterized by ``theta``.

    >>> q = APQB(math.pi / 8)
    >>> round(q.r, 6), round(q.T, 6)
    (0.707107, 0.707107)
    >>> abs(q.r ** 2 + q.T ** 2 - 1) < 1e-12
    True
    """

    theta: float = 0.0

    # ------------------------------------------------------------------ ctor
    @classmethod
    def from_r(cls, r: float) -> "APQB":
        """Build an APQB from a correlation coefficient r in [-1, 1]."""
        return cls(theta_from_r(r))

    @classmethod
    def from_latent(cls, a: float) -> "APQB":
        """Build an APQB from an unconstrained latent a (Eq. 12)."""
        return cls(theta_from_latent(a)[2])

    @classmethod
    def from_probability(cls, p1: float) -> "APQB":
        """Build an APQB whose |1> measurement probability is ``p1``."""
        p1 = _clamp(p1, 0.0, 1.0)
        return cls(math.asin(math.sqrt(p1)))

    @classmethod
    def zero(cls) -> "APQB":
        return cls(0.0)

    @classmethod
    def one(cls) -> "APQB":
        return cls(math.pi / 2)

    @classmethod
    def plus(cls) -> "APQB":
        return cls(math.pi / 4)

    # ------------------------------------------------------------ observables
    @property
    def r(self) -> float:
        """Correlation / confidence r = cos(2 theta) = <Z>."""
        return math.cos(2.0 * self.theta)

    @property
    def T(self) -> float:
        """Fluctuation / exploration T = |sin(2 theta)| = |<X>|."""
        return abs(math.sin(2.0 * self.theta))

    @property
    def q(self) -> float:
        """Alias of ``T`` using the paper's coherence coordinate name."""
        return self.T

    @property
    def z(self) -> complex:
        """Complex coordinate z = e^{i 2 theta} (Eq. 14)."""
        return cmath.exp(1j * 2.0 * self.theta)

    @property
    def amplitudes(self) -> Tuple[complex, complex]:
        """State-vector amplitudes (cos theta, sin theta)."""
        return complex(math.cos(self.theta), 0.0), complex(math.sin(self.theta), 0.0)

    @property
    def probabilities(self) -> Tuple[float, float]:
        """Born-rule probabilities (P(0), P(1)) = ((1+r)/2, (1-r)/2)."""
        c, s = math.cos(self.theta), math.sin(self.theta)
        return c * c, s * s

    @property
    def bloch(self) -> Tuple[float, float, float]:
        """Bloch vector (<X>, <Y>, <Z>) = (sin 2theta, 0, cos 2theta)."""
        return math.sin(2.0 * self.theta), 0.0, math.cos(2.0 * self.theta)

    def density_matrix(self) -> List[List[complex]]:
        """Eq. (8): rho = 1/2 [[1+r, q],[q, 1-r]] with q = sin(2 theta)."""
        r = self.r
        qq = math.sin(2.0 * self.theta)
        return [
            [complex((1.0 + r) / 2.0), complex(qq / 2.0)],
            [complex(qq / 2.0), complex((1.0 - r) / 2.0)],
        ]

    @property
    def coherence(self) -> float:
        """Sec. 3.4: l1-norm coherence C_l1 = 2|rho_01| = T."""
        return self.T

    @property
    def entropy(self) -> float:
        """Eq. (10): Shannon entropy (bits) of a Z-basis measurement."""
        p0, p1 = self.probabilities
        h = 0.0
        for p in (p0, p1):
            if p > 0.0:
                h -= p * math.log2(p)
        return h

    def constraint(self) -> float:
        """r^2 + T^2, which is 1 for every valid APQB."""
        return self.r ** 2 + self.T ** 2

    def features(self, K: int) -> Tuple[List[float], List[float]]:
        """Chebyshev harmonic features of order K (Prop. 2)."""
        return chebyshev_features(self.r, math.sin(2.0 * self.theta), K)

    # ---------------------------------------------------------------- misc
    def adjusted(self, delta_theta: float) -> "APQB":
        """Return a new APQB with theta shifted by ``delta_theta``."""
        return APQB(self.theta + delta_theta)

    def as_dict(self) -> dict:
        p0, p1 = self.probabilities
        return {
            "theta": self.theta,
            "r": self.r,
            "T": self.T,
            "p0": p0,
            "p1": p1,
            "entropy": self.entropy,
        }

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        c, s = math.cos(self.theta), math.sin(self.theta)
        return f"APQB(theta={self.theta:.4f}) = {c:.4f}|0> + {s:.4f}|1>  r={self.r:+.4f} T={self.T:.4f}"


def register_from_correlations(rs: Sequence[float]) -> List[APQB]:
    """Sec. 5: build a bank of APQBs from correlation coefficients."""
    return [APQB.from_r(r) for r in rs]
