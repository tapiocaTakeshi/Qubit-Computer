"""Qubit Computer -- a quantum computer whose qubits are APQBs, plus QubitOS.

Hardware layer:
    APQB, Circuit, QubitComputer, StateVector, gates, algorithms, qbnn
Operating system layer:
    qubit_computer.os  (Kernel, QubitFS, Shell)
"""

from .apqb import APQB, chebyshev_features, theta_from_latent, theta_from_r
from .backend import Backend, BackendInfo, available_backends
from .circuit import Circuit, Instruction
from .computer import QubitComputer, Result
from .hardware import APQBPersonalComputer, HardwareError
from .state import APQBReadout, StateVector, concurrence, three_tangle
from . import algorithms, backend, gates, qbnn

__version__ = "0.1.0"

__all__ = [
    "APQB", "chebyshev_features", "theta_from_latent", "theta_from_r",
    "Backend", "BackendInfo", "available_backends",
    "Circuit", "Instruction", "QubitComputer", "Result",
    "APQBPersonalComputer", "HardwareError",
    "APQBReadout", "StateVector", "concurrence", "three_tangle",
    "algorithms", "backend", "gates", "qbnn", "__version__",
]
