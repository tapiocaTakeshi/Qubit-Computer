"""QBNN -- APQB neural network layer (revised manuscript v2, Sec. 4-5).

Pure-Python, dependency-free implementation of:

* subset-product features  phi_S(r) = prod_{i in S} r_i           (Eq. 19)
* complex subset features   Phi_S(z) = prod_{i in S} z_i           (Eq. 22)
* the basic QBNN layer                                             (Eq. 23-29)

      r      = tanh(h)                       bounded APQB coordinates
      a      = W h + b                       classical pre-activation
      q      = tanh(a)                       candidate state
      g_j    = sum_{S, 1<=|S|<=K} J_{S,j} prod_{i in S} r_i   (Eq. 26 / 30)
      Delta  = q (.) g                       multiplicative gate
      a~     = a + lambda * Delta
      h_next = sigma(a~)

* APQB uncertainty amplitude eta_i = sqrt(1 - r_i^2 + eps) mapped to a
  control signal (dropout rate / temperature)                      (Eq. 31-32)

With ``lam = 0`` (or J = 0) the layer is an ordinary affine + activation
layer.  Training uses finite-difference gradients, which is exact enough
for the small hypothesis-testing tasks (XOR, parity) the paper proposes
in Sec. 6 and keeps the OS free of third-party dependencies.
"""

from __future__ import annotations

import cmath
import math
import random
from itertools import combinations
from typing import Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "subset_features", "complex_subset_features", "uncertainty", "control_signal",
    "QBNNLayer", "QBNN", "train", "xor_dataset", "parity_dataset",
]


def subset_features(r: Sequence[float], K: Optional[int] = None) -> Dict[Tuple[int, ...], float]:
    """phi_S(r) for every S with |S| <= K (Eq. 19).  phi_{} = 1."""
    n = len(r)
    if K is None:
        K = n
    feats: Dict[Tuple[int, ...], float] = {(): 1.0}
    for k in range(1, K + 1):
        for S in combinations(range(n), k):
            prod = 1.0
            for i in S:
                prod *= r[i]
            feats[S] = prod
    return feats


def complex_subset_features(thetas: Sequence[float], K: Optional[int] = None) -> Dict[Tuple[int, ...], complex]:
    """Phi_S(z) with z_i = exp(i 2 theta_i) (Eq. 21-22)."""
    z = [cmath.exp(1j * 2.0 * t) for t in thetas]
    n = len(z)
    if K is None:
        K = n
    feats: Dict[Tuple[int, ...], complex] = {(): 1 + 0j}
    for k in range(1, K + 1):
        for S in combinations(range(n), k):
            prod = 1 + 0j
            for i in S:
                prod *= z[i]
            feats[S] = prod
    return feats


def uncertainty(r: float, eps: float = 1e-6) -> float:
    """eta = sqrt(1 - r^2 + eps) (Eq. 31)."""
    return math.sqrt(max(1.0 - r * r, 0.0) + eps)


def control_signal(eta: float, lo: float, hi: float) -> float:
    """Monotone map eta -> [lo, hi], e.g. temperature (Eq. 11) or dropout (Eq. 32)."""
    if not all(math.isfinite(v) for v in (eta, lo, hi)) or lo > hi:
        raise ValueError("invalid control signal bounds")
    # Preserve Eq. 31; saturate its epsilon overshoot at the control boundary.
    t = max(0.0, min(1.0, eta))
    return max(lo, min(hi, (1.0 - t) * lo + t * hi))


def _tanh(x: float) -> float:
    return math.tanh(x)


def _identity(x: float) -> float:
    return x


ACTIVATIONS: Dict[str, Callable[[float], float]] = {
    "tanh": _tanh,
    "identity": _identity,
    "sigmoid": lambda x: 1.0 / (1.0 + math.exp(-x)) if x > -700 else 0.0,
    "relu": lambda x: x if x > 0 else 0.0,
}


class QBNNLayer:
    """One QBNN layer, Eq. (23)-(29) with K-order gating (Eq. 30)."""

    def __init__(self, in_dim: int, out_dim: int, K: int = 1, lam: float = 1.0,
                 activation: str = "tanh", rng: Optional[random.Random] = None,
                 init_scale: float = 0.5):
        rng = rng or random.Random(0)
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.K = max(0, min(K, in_dim))
        self.lam = lam
        self.activation_name = activation
        self.act = ACTIVATIONS[activation]
        self.W = [[rng.uniform(-init_scale, init_scale) for _ in range(in_dim)] for _ in range(out_dim)]
        self.b = [0.0] * out_dim
        # Subsets S with 1 <= |S| <= K, in a fixed order (Eq. 30).
        self.subsets: List[Tuple[int, ...]] = []
        for k in range(1, self.K + 1):
            self.subsets.extend(combinations(range(in_dim), k))
        # J[s][j] for subset index s, output unit j; zero-init keeps the plain layer.
        self.J = [[0.0] * out_dim for _ in self.subsets]
        self.last: Dict[str, List[float]] = {}

    # ------------------------------------------------------------ params
    def parameters(self) -> List[Tuple[List[float], int]]:
        """Flat list of (row, index) handles for in-place updates."""
        handles: List[Tuple[List[float], int]] = []
        for row in self.W:
            handles.extend((row, i) for i in range(len(row)))
        handles.extend((self.b, i) for i in range(len(self.b)))
        for row in self.J:
            handles.extend((row, i) for i in range(len(row)))
        return handles

    def num_parameters(self) -> int:
        return self.out_dim * self.in_dim + self.out_dim + len(self.subsets) * self.out_dim

    # ----------------------------------------------------------- forward
    def forward(self, h: Sequence[float]) -> List[float]:
        if len(h) != self.in_dim or not all(math.isfinite(x) for x in h):
            raise ValueError(f"expected {self.in_dim} finite inputs")
        r = [math.tanh(x) for x in h]                                   # (23)
        a = [sum(w * x for w, x in zip(row, h)) + bb for row, bb in zip(self.W, self.b)]  # (24)
        q = [math.tanh(x) for x in a]                                   # (25)
        g = [0.0] * self.out_dim                                        # (26)/(30)
        if self.lam != 0.0 and self.subsets:
            for s, S in enumerate(self.subsets):
                phi = 1.0
                for i in S:
                    phi *= r[i]
                if phi == 0.0:
                    continue
                Jrow = self.J[s]
                for j in range(self.out_dim):
                    g[j] += Jrow[j] * phi
        delta = [qq * gg for qq, gg in zip(q, g)]                       # (27)
        a_tilde = [aa + self.lam * dd for aa, dd in zip(a, delta)]      # (28)
        out = [self.act(x) for x in a_tilde]                            # (29)
        self.last = {"r": r, "a": a, "q": q, "g": g, "delta": delta, "eta": [uncertainty(x) for x in r]}
        return out

    __call__ = forward

    def to_dict(self) -> dict:
        return {
            "in_dim": self.in_dim, "out_dim": self.out_dim, "K": self.K, "lam": self.lam,
            "activation": self.activation_name, "W": self.W, "b": self.b, "J": self.J,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "QBNNLayer":
        layer = cls(d["in_dim"], d["out_dim"], K=d.get("K", 1), lam=d.get("lam", 1.0),
                    activation=d.get("activation", "tanh"))
        layer.W = [list(map(float, row)) for row in d["W"]]
        layer.b = list(map(float, d["b"]))
        layer.J = [list(map(float, row)) for row in d["J"]]
        return layer


class QBNN:
    """A stack of QBNN layers."""

    def __init__(self, dims: Sequence[int], K: int = 1, lam: float = 1.0,
                 activation: str = "tanh", output_activation: str = "identity",
                 seed: int = 0):
        rng = random.Random(seed)
        self.dims = list(dims)
        self.layers: List[QBNNLayer] = []
        for i in range(len(dims) - 1):
            last = i == len(dims) - 2
            self.layers.append(QBNNLayer(dims[i], dims[i + 1], K=K, lam=lam,
                                         activation=output_activation if last else activation,
                                         rng=rng))

    def forward(self, x: Sequence[float]) -> List[float]:
        h = list(x)
        for layer in self.layers:
            h = layer.forward(h)
        return h

    __call__ = forward

    def parameters(self) -> List[Tuple[List[float], int]]:
        out: List[Tuple[List[float], int]] = []
        for layer in self.layers:
            out.extend(layer.parameters())
        return out

    def num_parameters(self) -> int:
        return sum(l.num_parameters() for l in self.layers)

    def uncertainties(self) -> List[List[float]]:
        """eta of every unit in every layer after the last forward pass (Eq. 31)."""
        return [layer.last.get("eta", []) for layer in self.layers]

    def to_dict(self) -> dict:
        return {"dims": self.dims, "layers": [l.to_dict() for l in self.layers]}

    @classmethod
    def from_dict(cls, d: dict) -> "QBNN":
        net = cls(d["dims"])
        net.layers = [QBNNLayer.from_dict(ld) for ld in d["layers"]]
        return net


# ------------------------------------------------------------------ data
def xor_dataset() -> List[Tuple[List[float], List[float]]]:
    return [([-1.0, -1.0], [-1.0]), ([-1.0, 1.0], [1.0]), ([1.0, -1.0], [1.0]), ([1.0, 1.0], [-1.0])]


def parity_dataset(n: int) -> List[Tuple[List[float], List[float]]]:
    """n-bit parity with +-1 encoding: target = prod_i x_i (a top-order subset feature)."""
    data = []
    for idx in range(2 ** n):
        x = [1.0 if (idx >> i) & 1 else -1.0 for i in range(n)]
        y = 1.0
        for v in x:
            y *= v
        data.append((x, [y]))
    return data


def mse(net: QBNN, data: Sequence[Tuple[Sequence[float], Sequence[float]]]) -> float:
    total = 0.0
    for x, y in data:
        out = net.forward(x)
        total += sum((o - t) ** 2 for o, t in zip(out, y))
    return total / len(data)


def accuracy(net: QBNN, data: Sequence[Tuple[Sequence[float], Sequence[float]]]) -> float:
    ok = 0
    for x, y in data:
        out = net.forward(x)
        ok += all((o > 0) == (t > 0) for o, t in zip(out, y))
    return ok / len(data)


def train(net: QBNN, data: Sequence[Tuple[Sequence[float], Sequence[float]]],
          epochs: int = 200, lr: float = 0.1, eps: float = 1e-4,
          log: Optional[Callable[[str], None]] = None, log_every: int = 50) -> List[float]:
    """Gradient descent with central finite differences (exact enough for tiny nets)."""
    history: List[float] = []
    params = net.parameters()
    for epoch in range(1, epochs + 1):
        grads: List[float] = []
        for row, i in params:
            orig = row[i]
            row[i] = orig + eps
            lp = mse(net, data)
            row[i] = orig - eps
            lm = mse(net, data)
            row[i] = orig
            grads.append((lp - lm) / (2 * eps))
        for (row, i), g in zip(params, grads):
            row[i] -= lr * g
        loss = mse(net, data)
        history.append(loss)
        if log and (epoch % log_every == 0 or epoch == 1 or epoch == epochs):
            log(f"epoch {epoch:4d}  loss {loss:.6f}  acc {accuracy(net, data):.2f}")
    return history
