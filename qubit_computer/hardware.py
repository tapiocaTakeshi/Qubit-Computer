"""Composable APQB personal-computer hardware model.

This module models the parts of a PC *inside the classical APQB simulator*.
It does not claim that an APQB is a physical quantum processor.  The model is
useful to QubitOS because each part has an explicit responsibility and a
machine-readable status page.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from .backend import BackendInfo

__all__ = ["APQBPersonalComputer", "HardwareError"]


class HardwareError(ValueError):
    """Raised for an invalid virtual PC configuration."""


@dataclass
class APQBPersonalComputer:
    """A 64-bit APQB-PC bill of materials and live telemetry.

    ``attach_kernel`` is intentionally separate: the motherboard is assembled
    first, then QubitOS plugs its scheduler, APQB-RAM and QubitFS into it.
    """

    apqb_qubits: int = 16
    ram_qubits: int = 16
    storage_bytes: int = 64 * 1024 * 1024
    cpu_bits: int = 64
    gpu_lanes: int = 256
    network: List[str] = field(default_factory=lambda: ["Wi-Fi", "Bluetooth", "LAN (host bridge)"])
    sound: str = "virtual audio I/O"
    nominal_watts: float = 18.0
    base_temp_c: float = 32.0
    backend: BackendInfo | None = None
    _kernel: Any = field(default=None, repr=False, init=False)

    def __post_init__(self) -> None:
        if self.cpu_bits != 64:
            raise HardwareError("APQB-PC supports 64-bit hosts only")
        if not 1 <= self.apqb_qubits <= 20:
            raise HardwareError("apqb_qubits must be in 1..20")
        if self.ram_qubits < self.apqb_qubits:
            raise HardwareError("APQB-RAM must cover all APQB processor qubits")
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

    def telemetry(self) -> Dict[str, float]:
        active = 0 if self._kernel is None else len(self._kernel.segments)
        process_load = 0 if self._kernel is None else len(self._kernel.ready_queue())
        load = min(1.0, (active + process_load) / max(1, self.apqb_qubits))
        watts = self.nominal_watts * (0.35 + 0.65 * load)
        return {"load": load, "watts": watts, "cpu_temp_c": self.base_temp_c + 34 * load,
                "fan_percent": 20 + 75 * load}

    def report(self) -> Dict[str, Any]:
        used = self.storage_used_bytes()
        allocated = 0 if self._kernel is None else self.apqb_qubits - len(self._kernel.free_qubits)
        return {
            "motherboard": {"name": "APQB-MB64", "bus": "APQB IR -> QVM -> host backend"},
            "cpu": {"name": "APQB-CPU64", "bits": self.cpu_bits, "role": "circuit execution and QubitOS scheduling"},
            "ram": {"name": "APQB-RAM", "total_qubits": self.ram_qubits, "allocated_qubits": allocated},
            "gpu_npu": {"name": "APQB-GPU/NPU", "lanes": self.gpu_lanes,
                        "backend": self.backend.name.value if self.backend else "cpu",
                        "role": "state-vector and QBNN acceleration"},
            "ssd": {"name": "QubitFS SSD", "capacity_bytes": self.storage_bytes, "used_bytes": used,
                    "free_bytes": max(0, self.storage_bytes - used)},
            "power": {"name": "virtual PSU", **self.telemetry()},
            "cooling": {"name": "virtual CPU cooler and case fans", "fan_percent": self.telemetry()["fan_percent"]},
            "network": self.network,
            "sound": self.sound,
            "case": "QubitOS mobile / desktop enclosure",
            "physical_quantum_hardware": False,
        }
