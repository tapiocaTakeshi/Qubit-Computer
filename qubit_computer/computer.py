"""QubitComputer -- executes circuits on an APQB-based state-vector backend."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from . import gates as G
from .apqb import APQB
from .circuit import Circuit
from .state import APQBReadout, StateVector

__all__ = ["QubitComputer", "Result"]


@dataclass
class Result:
    """Outcome of ``QubitComputer.run``."""

    circuit_name: str
    num_qubits: int
    shots: int
    counts: Dict[str, int]
    measured_qubits: List[int]
    state: Optional[StateVector]
    apqb: List[APQBReadout]
    elapsed: float
    seed: Optional[int] = None
    memory: List[str] = field(default_factory=list)

    @property
    def probabilities(self) -> Dict[str, float]:
        total = sum(self.counts.values()) or 1
        return {k: v / total for k, v in self.counts.items()}

    def most_common(self) -> Optional[str]:
        if not self.counts:
            return None
        return max(self.counts.items(), key=lambda kv: kv[1])[0]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "circuit": self.circuit_name,
            "num_qubits": self.num_qubits,
            "shots": self.shots,
            "seed": self.seed,
            "measured_qubits": self.measured_qubits,
            "counts": self.counts,
            "apqb": [dict(a) for a in self.apqb],
            "state": None if self.state is None else
            [{"basis": b, "re": a.real, "im": a.imag} for b, a in self.state.nonzero()],
            "elapsed_sec": self.elapsed,
        }

    def summary(self) -> str:
        lines = [f"== {self.circuit_name}: {self.num_qubits} qubits, {self.shots} shots"
                 + (f", seed={self.seed}" if self.seed is not None else "")]
        if self.state is not None:
            lines.append(f"state : {self.state}")
        if self.counts:
            total = sum(self.counts.values())
            width = max(len(k) for k in self.counts)
            for k, v in self.counts.items():
                bar = "█" * int(40 * v / total)
                lines.append(f"  {k:<{width}}  {v:>6}  {v / total:6.1%} {bar}")
        lines.append("APQB readout per qubit (r=<Z> confidence, T=|<X>| fluctuation):")
        for a in self.apqb:
            tag = " entangled" if a["von_neumann"] > 1e-9 else ""
            lines.append(f"  q{a['qubit']}: r={a['r']:+.4f} T={a['T']:.4f} theta={a['theta']:.4f} "
                         f"p1={a['p1']:.4f} S_vn={a['von_neumann']:.4f}{tag}")
        return "\n".join(lines)


class QubitComputer:
    """A quantum computer whose qubits are APQBs.

    >>> qc = QubitComputer()
    >>> res = qc.run(Circuit(2).h(0).cx(0, 1), shots=100, seed=1)
    >>> set(res.counts) <= {"00", "11"}
    True
    """

    def __init__(self, max_qubits: int = 20):
        self.max_qubits = max_qubits

    # ------------------------------------------------------------ core
    def initial_state(self, circuit: Circuit) -> StateVector:
        if circuit.initial_apqbs is not None:
            return StateVector.from_apqbs(circuit.initial_apqbs)
        return StateVector(circuit.num_qubits)

    def statevector(self, circuit: Circuit, rng: Optional[random.Random] = None,
                    memory: Optional[List[str]] = None) -> StateVector:
        """Evolve the circuit once and return the final state.

        Mid-circuit measurements collapse the state using ``rng``.
        """
        if circuit.num_qubits > self.max_qubits:
            raise ValueError(f"circuit has {circuit.num_qubits} qubits > max_qubits={self.max_qubits}")
        sv = self.initial_state(circuit)
        for ins in circuit.instructions:
            if ins.is_barrier:
                continue
            if ins.is_measurement:
                out = sv.measure(ins.targets, rng=rng or random, collapse=True)
                if memory is not None:
                    memory.append(out)
                continue
            sv.apply(G.resolve(ins.name, ins.params), ins.targets)
        return sv

    def run(self, circuit: Circuit, shots: int = 1024, seed: Optional[int] = None,
            return_state: bool = True) -> Result:
        """Execute ``circuit`` for ``shots`` shots.

        * If the circuit ends with measurements only at the end (the common
          case), the state is evolved once and outcomes are sampled from
          it.
        * If it contains mid-circuit measurements, each shot is simulated
          independently (the state returned is from the last shot).
        * With no ``measure`` instruction at all, every qubit is sampled.
        """
        t0 = time.perf_counter()
        rng = random.Random(seed)
        measured = circuit.measured_qubits or list(range(circuit.num_qubits))

        has_mid = False
        seen_measure = False
        for ins in circuit.instructions:
            if ins.is_measurement:
                seen_measure = True
            elif seen_measure and not ins.is_barrier:
                has_mid = True
                break

        counts: Dict[str, int] = {}
        memory: List[str] = []
        if has_mid:
            sv = None
            for _ in range(shots):
                shot_mem: List[str] = []
                sv = self.statevector(circuit, rng=rng, memory=shot_mem)
                # Combine measured qubit outcomes in circuit order.
                outcome = self._combine(circuit, shot_mem, measured)
                counts[outcome] = counts.get(outcome, 0) + 1
                memory.append(outcome)
            assert sv is not None
        else:
            # Evolve unitary part once; measurement at the end is sampling.
            unitary = Circuit(circuit.num_qubits, name=circuit.name)
            if circuit.initial_apqbs is not None:
                unitary.prepare(circuit.initial_apqbs)
            for ins in circuit.instructions:
                if not ins.is_measurement:
                    unitary.append(ins.name, ins.targets, ins.params)
            sv = self.statevector(unitary)
            if shots > 0:
                counts = sv.sample(shots, measured, rng=rng)

        readouts = sv.apqb_readouts()
        return Result(
            circuit_name=circuit.name,
            num_qubits=circuit.num_qubits,
            shots=shots,
            counts=dict(sorted(counts.items())),
            measured_qubits=list(measured),
            state=sv if return_state else None,
            apqb=readouts,
            elapsed=time.perf_counter() - t0,
            seed=seed,
            memory=memory,
        )

    @staticmethod
    def _combine(circuit: Circuit, shot_mem: List[str], measured: List[int]) -> str:
        latest: Dict[int, str] = {}
        k = 0
        for ins in circuit.instructions:
            if ins.is_measurement:
                out = shot_mem[k]
                k += 1
                for q, b in zip(ins.targets, out):
                    latest[q] = b
        return "".join(latest.get(q, "0") for q in measured)

    # ------------------------------------------------------- shortcuts
    def prepare(self, apqbs: Sequence[APQB]) -> StateVector:
        """Directly prepare a register of APQBs (no circuit)."""
        return StateVector.from_apqbs(apqbs)

    def readout(self, circuit: Circuit) -> List[APQBReadout]:
        """APQB observables of every qubit after running ``circuit``."""
        return self.statevector(circuit).apqb_readouts()
