"""QubitOS -- the operating system of Qubit Computer."""

from .boot import boot, main
from .fs import FSError, QubitFS
from .kernel import OS_NAME, OS_VERSION, Kernel, KernelError, Process, ProcState, Segment
from .programs import PROGRAMS, Program
from .shell import Shell

__all__ = ["boot", "main", "FSError", "QubitFS", "OS_NAME", "OS_VERSION", "Kernel", "KernelError",
           "Process", "ProcState", "Segment", "PROGRAMS", "Program", "Shell"]
