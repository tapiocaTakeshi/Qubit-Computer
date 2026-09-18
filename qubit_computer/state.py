"""State-vector engine for Qubit Computer (pure Python, no dependencies).

An ``n``-qubit register holds ``2**n`` complex amplitudes.  Qubit ``j``
corresponds to bit ``j`` of the basis index (qubit 0 = least significant
bit), which is the same convention as most simulators.  When rendering
bitstrings, Qubit Computer prints qubit 0 on the LEFT so that the string
reads in the same order as the register (``"01"`` means q0=0, q1=1).
"""

from __future__ import annotations

import cmath
import math
import random
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .apqb import APQB, theta_from_r
from .gates import Matrix

__all__ = ["StateVector", "APQBReadout"]


class APQBReadout(dict):
    """APQB observables of one qubit read out of a (possibly entangled) register.

    Keys: ``r`` (<Z>), ``T`` (|<X>|), ``x``, ``y``, ``z``, ``theta``
    (= 1/2 arccos r), ``coherence`` (2|rho_01|), ``purity`` (Tr rho^2),
    ``p0``, ``p1``, ``entropy`` (Z-basis Shannon entropy) and
    ``von_neumann`` (entropy of the reduced state; > 0 iff entangled with
    the rest of the register).
    """

    def __getattr__(self, name: str):
        try:
            return self[name]
        except KeyError as exc:  # pragma: no cover
            raise AttributeError(name) from exc

    def as_apqb(self) -> APQB:
        """Project the readout onto the nearest APQB (theta = 1/2 arccos r)."""
        return APQB(self["theta"])


class StateVector:
    """Complex amplitude vector of an ``n``-qubit register."""

    def __init__(self, num_qubits: int, amplitudes: Optional[Sequence[complex]] = None):
        if num_qubits < 1:
            raise ValueError("a register needs at least one qubit")
        self.n = num_qubits
        self.dim = 1 << num_qubits
        if amplitudes is None:
            self.amp: List[complex] = [0j] * self.dim
            self.amp[0] = 1 + 0j
        else:
            if len(amplitudes) != self.dim:
                raise ValueError(f"expected {self.dim} amplitudes, got {len(amplitudes)}")
            self.amp = [complex(a) for a in amplitudes]
            self.normalize()

    # ------------------------------------------------------------ builders
    @classmethod
    def from_apqbs(cls, apqbs: Sequence[APQB]) -> "StateVector":
        """Product state of APQBs: qubit j is prepared in ``apqbs[j]``."""
        n = len(apqbs)
        sv = cls(n)
        sv.amp = [0j] * sv.dim
        for idx in range(sv.dim):
            a = 1 + 0j
            for j, q in enumerate(apqbs):
                c, s = q.amplitudes
                a *= s if (idx >> j) & 1 else c
            sv.amp[idx] = a
        return sv

    @classmethod
    def from_correlations(cls, rs: Sequence[float]) -> "StateVector":
        return cls.from_apqbs([APQB.from_r(r) for r in rs])

    @classmethod
    def from_bitstring(cls, bits: str) -> "StateVector":
        """Computational basis state; ``bits[0]`` is qubit 0."""
        n = len(bits)
        sv = cls(n)
        idx = 0
        for j, b in enumerate(bits):
            if b == "1":
                idx |= 1 << j
            elif b != "0":
                raise ValueError("bitstring must contain only 0/1")
        sv.amp = [0j] * sv.dim
        sv.amp[idx] = 1 + 0j
        return sv

    def copy(self) -> "StateVector":
        return StateVector(self.n, list(self.amp))

    # ------------------------------------------------------------ helpers
    def normalize(self) -> None:
        norm = math.sqrt(sum(abs(a) ** 2 for a in self.amp))
        if norm == 0.0:
            raise ValueError("cannot normalize the zero vector")
        if abs(norm - 1.0) > 1e-15:
            self.amp = [a / norm for a in self.amp]

    def index_to_bits(self, idx: int) -> str:
        return "".join("1" if (idx >> j) & 1 else "0" for j in range(self.n))

    def bits_to_index(self, bits: str) -> int:
        idx = 0
        for j, b in enumerate(bits):
            if b == "1":
                idx |= 1 << j
        return idx

    def probabilities(self) -> List[float]:
        return [abs(a) ** 2 for a in self.amp]

    def probability_of(self, bits: str) -> float:
        return abs(self.amp[self.bits_to_index(bits)]) ** 2

    def fidelity(self, other: "StateVector") -> float:
        """|<self|other>|^2."""
        if other.dim != self.dim:
            raise ValueError("dimension mismatch")
        ov = sum(a.conjugate() * b for a, b in zip(self.amp, other.amp))
        return abs(ov) ** 2

    # ------------------------------------------------------------- gates
    def apply(self, matrix: Matrix, targets: Sequence[int]) -> "StateVector":
        """Apply a k-qubit unitary to ``targets`` in place.

        Basis index of the matrix: first target is the most significant bit.
        """
        k = len(targets)
        if len(matrix) != (1 << k):
            raise ValueError(f"matrix of size {len(matrix)} does not act on {k} qubit(s)")
        for t in targets:
            if not 0 <= t < self.n:
                raise IndexError(f"qubit {t} out of range for {self.n}-qubit register")
        if len(set(targets)) != k:
            raise ValueError("targets must be distinct")

        if k == 1:
            self._apply_1q(matrix, targets[0])
            return self

        masks = [1 << t for t in targets]
        target_mask = 0
        for m in masks:
            target_mask |= m
        sub = 1 << k
        new_amp = list(self.amp)
        # Iterate over every basis index with all target bits cleared.
        for base in range(self.dim):
            if base & target_mask:
                continue
            # Gather sub-vector.
            idxs = []
            for local in range(sub):
                idx = base
                for j in range(k):
                    if (local >> (k - 1 - j)) & 1:
                        idx |= masks[j]
                idxs.append(idx)
            vec = [self.amp[i] for i in idxs]
            for row in range(sub):
                acc = 0j
                mrow = matrix[row]
                for col in range(sub):
                    m = mrow[col]
                    if m:
                        acc += m * vec[col]
                new_amp[idxs[row]] = acc
        self.amp = new_amp
        return self

    def _apply_1q(self, m: Matrix, t: int) -> None:
        bit = 1 << t
        m00, m01 = m[0][0], m[0][1]
        m10, m11 = m[1][0], m[1][1]
        amp = self.amp
        for i in range(self.dim):
            if i & bit:
                continue
            j = i | bit
            a0, a1 = amp[i], amp[j]
            amp[i] = m00 * a0 + m01 * a1
            amp[j] = m10 * a0 + m11 * a1

    # ------------------------------------------------------- measurement
    def measure(self, qubits: Optional[Sequence[int]] = None,
                rng: Optional[random.Random] = None,
                collapse: bool = True) -> str:
        """Sample a Born-rule outcome for ``qubits`` (default: all).

        Returns the outcome as a bitstring ordered like ``qubits``.  With
        ``collapse=True`` the register is projected onto the outcome.
        """
        rng = rng or random
        if qubits is None:
            qubits = list(range(self.n))
        probs = self.probabilities()
        u = rng.random()
        acc = 0.0
        chosen = self.dim - 1
        for idx, p in enumerate(probs):
            acc += p
            if u < acc:
                chosen = idx
                break
        outcome = "".join("1" if (chosen >> q) & 1 else "0" for q in qubits)
        if collapse:
            self.collapse(qubits, outcome)
        return outcome

    def collapse(self, qubits: Sequence[int], outcome: str) -> None:
        mask = 0
        want = 0
        for q, b in zip(qubits, outcome):
            mask |= 1 << q
            if b == "1":
                want |= 1 << q
        self.amp = [a if (i & mask) == want else 0j for i, a in enumerate(self.amp)]
        self.normalize()

    def sample(self, shots: int, qubits: Optional[Sequence[int]] = None,
               rng: Optional[random.Random] = None) -> Dict[str, int]:
        """Draw ``shots`` non-collapsing samples and return a histogram."""
        rng = rng or random
        if qubits is None:
            qubits = list(range(self.n))
        probs = self.probabilities()
        cdf: List[float] = []
        acc = 0.0
        for p in probs:
            acc += p
            cdf.append(acc)
        counts: Dict[str, int] = {}
        for _ in range(shots):
            u = rng.random() * acc
            lo, hi = 0, self.dim - 1
            while lo < hi:
                mid = (lo + hi) // 2
                if cdf[mid] > u:
                    hi = mid
                else:
                    lo = mid + 1
            key = "".join("1" if (lo >> q) & 1 else "0" for q in qubits)
            counts[key] = counts.get(key, 0) + 1
        return dict(sorted(counts.items()))

    # ------------------------------------------------- APQB observables
    def reduced_density_matrix(self, qubit: int) -> List[List[complex]]:
        """Partial trace over every qubit except ``qubit`` -> 2x2 rho."""
        bit = 1 << qubit
        rho = [[0j, 0j], [0j, 0j]]
        for i in range(self.dim):
            if i & bit:
                continue
            a0 = self.amp[i]
            a1 = self.amp[i | bit]
            rho[0][0] += a0 * a0.conjugate()
            rho[0][1] += a0 * a1.conjugate()
            rho[1][0] += a1 * a0.conjugate()
            rho[1][1] += a1 * a1.conjugate()
        return rho

    def expectation(self, qubit: int, pauli: str) -> float:
        """<P> for P in {X, Y, Z} on one qubit."""
        rho = self.reduced_density_matrix(qubit)
        pauli = pauli.upper()
        if pauli == "Z":
            return (rho[0][0] - rho[1][1]).real
        if pauli == "X":
            return (2.0 * rho[0][1]).real
        if pauli == "Y":
            return (-2.0 * rho[0][1]).imag
        raise ValueError("pauli must be X, Y or Z")

    def apqb_readout(self, qubit: int) -> APQBReadout:
        """Read APQB observables (r, T, theta, ...) off one qubit."""
        rho = self.reduced_density_matrix(qubit)
        p0 = rho[0][0].real
        p1 = rho[1][1].real
        r = p0 - p1
        x = (2.0 * rho[0][1]).real
        y = (-2.0 * rho[0][1]).imag
        coherence = 2.0 * abs(rho[0][1])
        purity = (rho[0][0] * rho[0][0] + 2.0 * rho[0][1] * rho[1][0]
                  + rho[1][1] * rho[1][1]).real
        # Eigenvalues of a 2x2 Hermitian matrix for the von Neumann entropy.
        tr = p0 + p1
        det = (rho[0][0] * rho[1][1] - rho[0][1] * rho[1][0]).real
        disc = max(tr * tr / 4.0 - det, 0.0)
        lam = (tr / 2.0 + math.sqrt(disc), tr / 2.0 - math.sqrt(disc))
        vn = 0.0
        for l in lam:
            if l > 1e-15:
                vn -= l * math.log2(l)
        vn = max(vn, 0.0)
        ent = 0.0
        for p in (p0, p1):
            if p > 1e-15:
                ent -= p * math.log2(p)
        return APQBReadout(
            qubit=qubit,
            r=r,
            T=abs(x),
            x=x,
            y=y,
            z=r,
            theta=theta_from_r(r),
            coherence=coherence,
            purity=purity,
            p0=p0,
            p1=p1,
            entropy=ent,
            von_neumann=vn,
        )

    def apqb_readouts(self) -> List[APQBReadout]:
        return [self.apqb_readout(j) for j in range(self.n)]

    def correlation(self, a: int, b: int) -> float:
        """Two-qubit Z correlation <Z_a Z_b> - <Z_a><Z_b>."""
        zz = 0.0
        for i, amp in enumerate(self.amp):
            p = abs(amp) ** 2
            if p == 0.0:
                continue
            sa = -1.0 if (i >> a) & 1 else 1.0
            sb = -1.0 if (i >> b) & 1 else 1.0
            zz += p * sa * sb
        return zz - self.expectation(a, "Z") * self.expectation(b, "Z")

    # ------------------------------------------------------------ display
    def nonzero(self, tol: float = 1e-12) -> List[Tuple[str, complex]]:
        return [(self.index_to_bits(i), a) for i, a in enumerate(self.amp) if abs(a) > tol]

    def __str__(self) -> str:
        parts = []
        for bits, a in self.nonzero():
            if abs(a.imag) < 1e-12:
                coef = f"{a.real:+.4f}"
            elif abs(a.real) < 1e-12:
                coef = f"{a.imag:+.4f}i"
            else:
                coef = f"({a.real:+.4f}{a.imag:+.4f}i)"
            parts.append(f"{coef}|{bits}>")
        return " ".join(parts) if parts else "0"

    __repr__ = __str__


# ---------------------------------------------------------------------------
# Entanglement measures for the state families singled out in the paper
# (Sec. 3.1 / 3.2 of the revised manuscript): Wootters concurrence for pure
# 2-qubit states and the Coffman-Kundu-Wootters three-tangle for pure
# 3-qubit states.
# ---------------------------------------------------------------------------

def concurrence(sv: StateVector) -> float:
    """Wootters concurrence of a pure 2-qubit state: C = 2|a00 a11 - a01 a10|.

    For |Psi2(theta)> = cos(theta)|00> + sin(theta)|11> this equals
    eta = |sin(2 theta)| (Eq. 13), hence C^2 + r^2 = 1 (Eq. 14).
    """
    if sv.n != 2:
        raise ValueError("concurrence() is defined here for 2-qubit pure states")
    a = sv.amp
    return 2.0 * abs(a[0] * a[3] - a[1] * a[2])


def three_tangle(sv: StateVector) -> float:
    """Coffman-Kundu-Wootters three-tangle of a pure 3-qubit state.

    tau_3 = 4 |d1 - 2 d2 + 4 d3| with the standard Cayley hyperdeterminant
    combination.  For |Psi3(theta)> = cos(theta)|000> + sin(theta)|111> it
    equals eta^2 = sin^2(2 theta) (Eq. 16), hence tau_3 + r^2 = 1 (Eq. 17).
    """
    if sv.n != 3:
        raise ValueError("three_tangle() is defined here for 3-qubit pure states")
    # Map amplitudes to a_{ijk} with i = qubit 0, j = qubit 1, k = qubit 2.
    def a(i: int, j: int, k: int) -> complex:
        return sv.amp[i | (j << 1) | (k << 2)]

    a000, a001, a010, a011 = a(0, 0, 0), a(0, 0, 1), a(0, 1, 0), a(0, 1, 1)
    a100, a101, a110, a111 = a(1, 0, 0), a(1, 0, 1), a(1, 1, 0), a(1, 1, 1)
    d1 = (a000 ** 2 * a111 ** 2 + a001 ** 2 * a110 ** 2
          + a010 ** 2 * a101 ** 2 + a100 ** 2 * a011 ** 2)
    d2 = (a000 * a111 * a011 * a100 + a000 * a111 * a101 * a010
          + a000 * a111 * a110 * a001 + a011 * a100 * a101 * a010
          + a011 * a100 * a110 * a001 + a101 * a010 * a110 * a001)
    d3 = a000 * a110 * a101 * a011 + a111 * a001 * a010 * a100
    return 4.0 * abs(d1 - 2.0 * d2 + 4.0 * d3)


__all__ += ["concurrence", "three_tangle"]
