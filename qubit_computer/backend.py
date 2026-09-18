"""Hardware backend selection: CPU / GPU / Q-NPU.

APQB / QBNN are *quantum-inspired* models that run on ordinary classical
hardware (paper Sec. 3.3 / 7.2) -- there is no physical qubit here, so
"backend" means which classical device drives the state-vector / QBNN
math, not which quantum processor is used.

* ``cpu``  -- the dependency-free pure-Python engine. Always available;
  this is what every other module in this package uses by default, so
  the test suite and existing behaviour are unaffected.
* ``gpu``  -- a vectorized engine. It dispatches the state-vector amplitude
  update through NumPy when NumPy is installed (``pip install -e ".[gpu]"``);
  point that NumPy build at CUDA/ROCm (or swap in CuPy) for real on-device
  execution. Falls back to ``cpu`` when NumPy is not installed.
* ``qnpu`` -- a dedicated APQB/QBNN processor. This is a *planned future*
  backend (see the QubitOS architecture notes in the README): no such
  hardware or driver exists yet, so selecting it always falls back to
  ``cpu`` with a clear reason.

This module only decides *which engine* is used; it never silently
pretends an unavailable backend is active -- ``resolve()`` always
returns the backend that will actually run, plus the reason if it had to
fall back.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from enum import Enum
from typing import Callable, List, Optional, Union

__all__ = ["Backend", "BackendInfo", "available_backends", "backend_info", "is_available", "resolve"]


class Backend(str, Enum):
    CPU = "cpu"
    GPU = "gpu"
    QNPU = "qnpu"


@dataclass(frozen=True)
class BackendInfo:
    name: Backend
    available: bool
    engine: str
    detail: str


def _numpy_available() -> bool:
    return importlib.util.find_spec("numpy") is not None


def _parse(name: Union[str, Backend]) -> Backend:
    if isinstance(name, Backend):
        return name
    try:
        return Backend(str(name).strip().lower())
    except ValueError:
        choices = ", ".join(b.value for b in Backend)
        raise ValueError(f"unknown backend '{name}' (choices: {choices})") from None


def backend_info(name: Union[str, Backend]) -> BackendInfo:
    """Describe ``name`` without switching to it."""
    b = _parse(name)
    if b is Backend.CPU:
        return BackendInfo(Backend.CPU, True, "pure-python",
                            "dependency-free reference state-vector engine (always available)")
    if b is Backend.GPU:
        if _numpy_available():
            return BackendInfo(Backend.GPU, True, "numpy",
                                "vectorized amplitude updates via numpy "
                                "(install a CUDA/ROCm-enabled numpy or cupy build for on-device execution)")
        return BackendInfo(Backend.GPU, False, "numpy",
                            "numpy is not installed; run `pip install -e \".[gpu]\"` to enable the vectorized engine")
    return BackendInfo(Backend.QNPU, False, "-",
                        "Q-NPU (a dedicated APQB/QBNN processor) is a planned future backend; "
                        "no hardware or driver exists yet")


def available_backends() -> List[BackendInfo]:
    return [backend_info(b) for b in Backend]


def is_available(name: Union[str, Backend]) -> bool:
    return backend_info(name).available


def resolve(name: Union[str, Backend], on_warning: Optional[Callable[[str], None]] = None) -> BackendInfo:
    """Return the ``BackendInfo`` that will actually run for ``name``.

    Falls back to ``cpu`` (and reports why via ``on_warning``, if given)
    when the requested backend is not available.
    """
    info = backend_info(name)
    if info.available:
        return info
    if on_warning:
        on_warning(f"backend '{info.name.value}' unavailable ({info.detail}); falling back to 'cpu'")
    return backend_info(Backend.CPU)
