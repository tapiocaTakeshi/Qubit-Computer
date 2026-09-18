"""Qubit Computer -- a quantum computer whose qubits are APQBs, plus QubitOS.

Hardware layer:
    APQB, Circuit, QubitComputer, StateVector, gates, algorithms, qbnn
Operating system layer:
    qubit_computer.os  (Kernel, QubitFS, Shell)
"""

from .apqb import APQB, chebyshev_features, theta_from_latent, theta_from_r
from .circuit import Circuit, Instruction
from .computer import QubitComputer, Result
from .state import APQBReadout, StateVector, concurrence, three_tangle
from . import algorithms, gates, qbnn

__version__ = "0.1.0"

__all__ = [
    "APQB", "chebyshev_features", "theta_from_latent", "theta_from_r",
    "Circuit", "Instruction", "QubitComputer", "Result",
    "APQBReadout", "StateVector", "concurrence", "three_tangle",
    "algorithms", "gates", "qbnn", "__version__",
]
