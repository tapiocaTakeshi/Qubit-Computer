"""QubitOS program table (``/bin``).

A ``Program`` is something the kernel can spawn as a process: either a
circuit builder (runs on the APQB hardware) or a Python job (e.g. QBNN
training).  ``argv`` is a list of strings exactly as typed in the shell.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

from .. import algorithms, qbnn
from ..apqb import APQB
from ..circuit import Circuit

if TYPE_CHECKING:  # pragma: no cover
    from .kernel import Kernel, Process

__all__ = ["Program", "PROGRAMS", "parse_args"]


def parse_args(argv: List[str]) -> Dict[str, Any]:
    """Split ``argv`` into positional strings and ``--key value`` options."""
    pos: List[str] = []
    opts: Dict[str, Any] = {}
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok.startswith("--"):
            key = tok[2:].replace("-", "_")
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                opts[key] = argv[i + 1]
                i += 2
            else:
                opts[key] = True
                i += 1
        else:
            pos.append(tok)
            i += 1
    return {"pos": pos, "opts": opts}


def _f(s: str) -> float:
    if s.endswith("pi"):
        s = s[:-2] or "1"
        return float(s) * math.pi
    return float(s)


@dataclass
class Program:
    name: str
    description: str
    usage: str
    circuit: Optional[Callable[[List[str]], Circuit]] = None
    job: Optional[Callable[["Kernel", "Process", List[str]], Any]] = None

    @property
    def kind(self) -> str:
        return "circuit" if self.circuit else "job"


# ---------------------------------------------------------------- circuits
def _bell(argv):
    return algorithms.bell()


def _bell_apqb(argv):
    a = parse_args(argv)
    theta = _f(a["pos"][0]) if a["pos"] else math.pi / 4
    return algorithms.bell_apqb(theta)


def _ghz(argv):
    a = parse_args(argv)
    n = int(a["pos"][0]) if a["pos"] else 3
    return algorithms.ghz(n)


def _ghz_apqb(argv):
    a = parse_args(argv)
    theta = _f(a["pos"][0]) if a["pos"] else math.pi / 4
    n = int(a["pos"][1]) if len(a["pos"]) > 1 else 3
    return algorithms.ghz_apqb(theta, n)


def _encode(argv):
    a = parse_args(argv)
    rs = [_f(x) for x in a["pos"]] or [0.9, 0.0, -0.6]
    return algorithms.correlation_register(rs)


def _teleport(argv):
    a = parse_args(argv)
    theta = _f(a["pos"][0]) if a["pos"] else 0.3
    return algorithms.teleportation(theta)


def _superdense(argv):
    a = parse_args(argv)
    return algorithms.superdense_coding(a["pos"][0] if a["pos"] else "10")


def _dj(argv):
    a = parse_args(argv)
    n = int(a["pos"][0]) if a["pos"] else 3
    oracle = a["pos"][1] if len(a["pos"]) > 1 else "balanced"
    return algorithms.deutsch_jozsa(n, oracle)


def _grover(argv):
    a = parse_args(argv)
    marked = a["pos"][0] if a["pos"] else "101"
    its = int(a["opts"]["iterations"]) if "iterations" in a["opts"] else None
    return algorithms.grover(len(marked), marked, its)


def _qft(argv):
    a = parse_args(argv)
    n = int(a["pos"][0]) if a["pos"] else 3
    c = algorithms.qft(n)
    # Optional input basis state, e.g. "qft 3 --input 101".
    if "input" in a["opts"]:
        pre = Circuit(n, f"qft{n}")
        for q, b in enumerate(str(a["opts"]["input"])):
            if b == "1":
                pre.x(q)
        c = pre.compose(c)
    return c


# ---------------------------------------------------------------- jobs
def _qbnn_train(kernel: "Kernel", proc: "Process", argv: List[str]) -> Dict[str, Any]:
    """Train a QBNN on XOR / n-bit parity (paper Sec. 6 hypothesis H1)."""
    a = parse_args(argv)
    task = a["pos"][0] if a["pos"] else "xor"
    opts = a["opts"]
    K = int(opts.get("K", opts.get("k", 2)))
    lam = float(opts.get("lam", 1.0))
    epochs = int(opts.get("epochs", 150))
    lr = float(opts.get("lr", 0.2))
    hidden = int(opts.get("hidden", 4))
    seed = int(opts.get("seed", 1))
    if task == "xor":
        data = qbnn.xor_dataset()
        n_in = 2
    elif task == "parity":
        n_in = int(a["pos"][1]) if len(a["pos"]) > 1 else 3
        data = qbnn.parity_dataset(n_in)
    else:
        raise ValueError("task must be 'xor' or 'parity N'")
    net = qbnn.QBNN([n_in, hidden, 1], K=K, lam=lam, seed=seed)
    proc.log(f"QBNN dims={net.dims} K={K} lam={lam} params={net.num_parameters()} task={task}")
    history = qbnn.train(net, data, epochs=epochs, lr=lr, log=proc.log, log_every=max(1, epochs // 5))
    acc = qbnn.accuracy(net, data)
    path = opts.get("save", f"/lib/qbnn/{task}{'' if task == 'xor' else n_in}_K{K}.json")
    kernel.fs.write_json(path, net.to_dict())
    proc.log(f"saved weights to {path}")
    etas = net.uncertainties()
    return {"task": task, "K": K, "lam": lam, "final_loss": history[-1], "accuracy": acc,
            "epochs": epochs, "weights": path,
            "eta_hidden": etas[0], "temperature_hidden": [qbnn.control_signal(e, 0.1, 1.0) for e in etas[0]]}


def _qbnn_eval(kernel: "Kernel", proc: "Process", argv: List[str]) -> Dict[str, Any]:
    a = parse_args(argv)
    if not a["pos"]:
        raise ValueError("usage: qbnn_eval <weights.json> x1 x2 ...")
    net = qbnn.QBNN.from_dict(kernel.fs.read_json(a["pos"][0]))
    x = [_f(v) for v in a["pos"][1:]]
    out = net.forward(x)
    proc.log(f"QBNN({x}) = {out}")
    return {"input": x, "output": out, "eta": net.uncertainties()}


def _features(kernel: "Kernel", proc: "Process", argv: List[str]) -> Dict[str, Any]:
    """Subset-product features phi_S / Phi_S of an APQB register (Eq. 19/22)."""
    a = parse_args(argv)
    thetas = [_f(x) for x in a["pos"]]
    if not thetas:
        raise ValueError("usage: features theta1 theta2 ... [--K k]")
    K = int(a["opts"]["K"]) if "K" in a["opts"] else None
    rs = [math.cos(2 * t) for t in thetas]
    phi = qbnn.subset_features(rs, K)
    Phi = qbnn.complex_subset_features(thetas, K)
    for S in phi:
        proc.log(f"S={S or '∅'}: phi_S={phi[S]:+.4f}  Phi_S={Phi[S].real:+.4f}{Phi[S].imag:+.4f}i")
    proc.log(f"{len(phi)} subset features (2^n = {2 ** len(thetas)} when K = n)")
    return {"r": rs, "count": len(phi),
            "phi": {",".join(map(str, S)) or "∅": v for S, v in phi.items()}}


PROGRAMS: Dict[str, Program] = {
    "bell": Program("bell", "Bell pair (H, CX)", "bell", circuit=_bell),
    "bell_apqb": Program("bell_apqb", "|Psi2(θ)> = cosθ|00> + sinθ|11>  (paper Eq. 12)", "bell_apqb <theta>", circuit=_bell_apqb),
    "ghz": Program("ghz", "GHZ state on n qubits", "ghz [n]", circuit=_ghz),
    "ghz_apqb": Program("ghz_apqb", "|Psi3(θ)> = cosθ|000> + sinθ|111>  (paper Eq. 15)", "ghz_apqb <theta> [n]", circuit=_ghz_apqb),
    "encode": Program("encode", "APQB register from correlation coefficients r_i (Eq. 18)", "encode r1 r2 ...", circuit=_encode),
    "teleport": Program("teleport", "Teleport an APQB |ψ(θ)> from q0 to q2", "teleport <theta>", circuit=_teleport),
    "superdense": Program("superdense", "Superdense coding of two classical bits", "superdense <2 bits>", circuit=_superdense),
    "deutsch_jozsa": Program("deutsch_jozsa", "Deutsch-Jozsa (constant0|constant1|balanced)", "deutsch_jozsa [n] [oracle]", circuit=_dj),
    "grover": Program("grover", "Grover search for a bitstring", "grover <bits> [--iterations k]", circuit=_grover),
    "qft": Program("qft", "Quantum Fourier transform", "qft [n] [--input bits]", circuit=_qft),
    "qbnn_train": Program("qbnn_train", "Train a QBNN (Eq. 23-30) on xor / parity", "qbnn_train xor|parity [n] [--K 2 --lam 1 --epochs 150 --lr 0.2 --hidden 4 --seed 1]", job=_qbnn_train),
    "qbnn_eval": Program("qbnn_eval", "Evaluate saved QBNN weights", "qbnn_eval <weights.json> x1 x2 ...", job=_qbnn_eval),
    "features": Program("features", "Subset-product APQB features phi_S / Phi_S (Eq. 19, 22)", "features theta1 theta2 ... [--K k]", job=_features),
}
