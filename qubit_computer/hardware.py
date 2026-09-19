"""Composable APQB personal-computer hardware model.

This module models the parts of a PC *inside the classical APQB simulator*.
It does not claim that an APQB is a physical quantum processor.  The model is
useful to QubitOS because each part has an explicit responsibility and a
machine-readable status page.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict

from .backend import BackendInfo

__all__ = ["APQBPersonalComputer", "HardwareError"]


class HardwareError(ValueError):
    """Raised for an invalid virtual PC configuration."""


@dataclass
class APQBPersonalComputer:
    """Python service inventory (the executable QVM64 lives in the mobile app).

    ``attach_kernel`` is intentionally separate: the motherboard is assembled
    first, then QubitOS plugs its scheduler, APQB-RAM and QubitFS into it.
    """

    apqb_qubits: int = 16
    ram_qubits: int = 16
    storage_bytes: int = 64 * 1024 * 1024
    cpu_bits: int = 64
    backend: BackendInfo | None = None
    _kernel: Any = field(default=None, repr=False, init=False)

    def __post_init__(self) -> None:
        if self.cpu_bits != 64:
            raise HardwareError("APQB-PC supports a 64-bit word-size target only")
        if not 1 <= self.apqb_qubits <= 20:
            raise HardwareError("apqb_qubits must be in 1..20")
        if not isinstance(self.apqb_qubits, int) or isinstance(self.apqb_qubits, bool):
            raise HardwareError("apqb_qubits must be an integer")
        if self.ram_qubits != self.apqb_qubits:
            raise HardwareError("APQB-RAM must match the actual kernel pool")
        if self.storage_bytes < 1024 * 1024:
            raise HardwareError("APQB-SSD must be at least 1 MiB")

    def attach_kernel(self, kernel: Any) -> None:
        """Connect motherboard buses to the QubitOS kernel."""
        self._kernel = kernel
        self.backend = kernel.backend_info

    def storage_used_bytes(self) -> int:
        if self._kernel is None:
            return 0

        def count(node: Any) -> int:
            return len(node.encode("utf-8")) if isinstance(node, str) else sum(count(v) for v in node.values())

        return count(self._kernel.fs.root)

    def report(self) -> Dict[str, Any]:
        used = self.storage_used_bytes()
        allocated = 0 if self._kernel is None else self.apqb_qubits - len(self._kernel.free_qubits)
        return {
            "motherboard": {"name": "Python kernel services", "bus": "kernel -> state-vector engine / QubitFS"},
            "cpu": {"name": "host Python", "bits": self.cpu_bits,
                    "role": "circuit interpreter; bits is a design target, not measured host architecture",
                    "qvm_available": False},
            "ram": {"name": "APQB-RAM", "total_qubits": self.ram_qubits, "allocated_qubits": allocated},
            "gpu_npu": {"name": "classical state-vector backend", "lanes": None,
                        "backend": self.backend.name.value if self.backend else "cpu",
                        "role": "CPU or NumPy vectorization; no physical GPU/NPU driver"},
            "ssd": {"name": "QubitFS files", "capacity_bytes": None, "used_bytes": used,
                    "free_bytes": None, "quota_enforced": False,
                    "persistent": bool(self._kernel and self._kernel.fs.backing_file)},
            "power": {"status": "host-managed; not measured"},
            "cooling": {"status": "host-managed; not measured"},
            "network": ["no network device driver"],
            "sound": "audio driver not implemented",
            "case": "QubitOS mobile / desktop enclosure",
            "physical_quantum_hardware": False,
        }
