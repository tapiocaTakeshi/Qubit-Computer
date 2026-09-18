import importlib.util
import math
import random
import unittest

from qubit_computer import backend as backend_mod
from qubit_computer.algorithms import bell, bell_apqb, ghz
from qubit_computer.backend import Backend, available_backends, backend_info, resolve
from qubit_computer.computer import QubitComputer
from qubit_computer.gates import CCX, CX, H, RY
from qubit_computer.os import Kernel, Shell
from qubit_computer.state import StateVector

HAS_NUMPY = importlib.util.find_spec("numpy") is not None


class TestBackendInfo(unittest.TestCase):
    def test_cpu_always_available(self):
        info = backend_info("cpu")
        self.assertTrue(info.available)
        self.assertEqual(info.name, Backend.CPU)

    def test_qnpu_is_a_future_backend(self):
        info = backend_info("qnpu")
        self.assertFalse(info.available)
        self.assertIn("Q-NPU", info.detail)

    def test_available_backends_lists_all_three(self):
        names = {info.name for info in available_backends()}
        self.assertEqual(names, {Backend.CPU, Backend.GPU, Backend.QNPU})

    def test_unknown_backend_name_rejected(self):
        with self.assertRaises(ValueError):
            backend_info("tpu")

    def test_resolve_qnpu_falls_back_to_cpu_with_warning(self):
        warnings = []
        info = resolve("qnpu", on_warning=warnings.append)
        self.assertEqual(info.name, Backend.CPU)
        self.assertEqual(len(warnings), 1)
        self.assertIn("qnpu", warnings[0])
        self.assertIn("cpu", warnings[0])

    def test_resolve_cpu_never_warns(self):
        warnings = []
        info = resolve("cpu", on_warning=warnings.append)
        self.assertEqual(info.name, Backend.CPU)
        self.assertEqual(warnings, [])

    def test_resolve_gpu_matches_numpy_availability(self):
        info = resolve("gpu")
        if HAS_NUMPY:
            self.assertEqual(info.name, Backend.GPU)
        else:
            self.assertEqual(info.name, Backend.CPU)

    def test_case_and_whitespace_insensitive(self):
        self.assertEqual(backend_info("  CPU ").name, Backend.CPU)


class TestQubitComputerBackend(unittest.TestCase):
    def test_defaults_to_cpu(self):
        qc = QubitComputer()
        self.assertEqual(qc.backend_info.name, Backend.CPU)
        sv = qc.statevector(bell())
        self.assertEqual(sv.backend, Backend.CPU)

    def test_unavailable_backend_is_silently_resolved_not_raised(self):
        qc = QubitComputer(backend="qnpu")
        self.assertEqual(qc.backend_info.name, Backend.CPU)

    @unittest.skipUnless(HAS_NUMPY, "numpy not installed")
    def test_gpu_matches_cpu_numerically(self):
        cpu = QubitComputer(backend="cpu").statevector(ghz(4))
        gpu = QubitComputer(backend="gpu").statevector(ghz(4))
        self.assertEqual(gpu.backend, Backend.GPU)
        self.assertAlmostEqual(cpu.fidelity(gpu), 1.0, places=9)

    @unittest.skipUnless(HAS_NUMPY, "numpy not installed")
    def test_apply_numpy_matches_pure_python_on_random_circuits(self):
        rng = random.Random(7)
        for _ in range(20):
            n = rng.randint(1, 4)
            sv_cpu = StateVector(n)
            sv_gpu = StateVector(n)
            sv_gpu.backend = Backend.GPU
            k = rng.randint(1, min(n, 3))
            targets = rng.sample(range(n), k)
            if k == 1:
                theta = rng.uniform(0, math.pi)
                matrix = RY(theta)
            elif k == 2:
                matrix = CX
            else:
                matrix = CCX
            sv_cpu.apply(matrix, targets)
            sv_gpu.apply(matrix, targets)
            self.assertAlmostEqual(sv_cpu.fidelity(sv_gpu), 1.0, places=9)

    def test_gpu_backend_without_numpy_would_not_crash_apply(self):
        # Simulate "gpu selected but numpy missing" by forcing the flag: apply()
        # must not raise even if numpy import fails inside _apply_numpy.
        sv = StateVector(1)
        sv.backend = Backend.GPU
        sv.apply(H, [0])  # falls through to pure-python if numpy is unavailable
        self.assertAlmostEqual(sum(sv.probabilities()), 1.0)


class TestKernelBackend(unittest.TestCase):
    def test_default_backend_is_cpu(self):
        k = Kernel(num_qubits=4, seed=0)
        self.assertEqual(k.sysctl["hardware.backend"], "cpu")
        self.assertEqual(k.sys_uname()["backend"], "cpu")

    def test_backend_syscall_lists_three_backends(self):
        k = Kernel(num_qubits=4, seed=0)
        info = k.sys_backend()
        self.assertEqual(info["current"], "cpu")
        self.assertEqual({b["name"] for b in info["available"]}, {"cpu", "gpu", "qnpu"})

    def test_switching_to_qnpu_falls_back_to_cpu_and_logs(self):
        k = Kernel(num_qubits=4, seed=0)
        result = k.sys_backend("qnpu")
        self.assertEqual(result, "cpu")
        self.assertEqual(k.sysctl["hardware.backend"], "cpu")
        self.assertTrue(any("unavailable" in line for line in k.sys_dmesg()))

    def test_sysctl_hardware_backend_alias(self):
        k = Kernel(num_qubits=4, seed=0)
        self.assertEqual(k.sys_sysctl("hardware.backend", "qnpu"), "cpu")

    def test_new_segments_are_tagged_with_current_backend(self):
        k = Kernel(num_qubits=4, seed=0)
        seg = k.sys_alloc(2, "reg")
        self.assertEqual(seg.state.backend, backend_mod.Backend.CPU)

    @unittest.skipUnless(HAS_NUMPY, "numpy not installed")
    def test_switching_to_gpu_actually_switches(self):
        k = Kernel(num_qubits=4, seed=0)
        self.assertEqual(k.sys_backend("gpu"), "gpu")
        self.assertEqual(k.hw.backend_info.name, backend_mod.Backend.GPU)
        seg = k.sys_alloc(2, "reg")
        self.assertEqual(seg.state.backend, backend_mod.Backend.GPU)

    def test_shell_backend_command(self):
        k = Kernel(num_qubits=4, seed=0)
        lines = []
        sh = Shell(k, out=lines.append)
        sh.execute_line("backend")
        self.assertTrue(any("current: cpu" in line for line in lines))
        lines.clear()
        sh.execute_line("backend qnpu")
        self.assertTrue(any("backend = cpu" in line for line in lines))


class TestBellApqbInvariantAcrossBackends(unittest.TestCase):
    """Backend selection must never change the physics (paper Eq. 13-14)."""

    def test_concurrence_matches_regardless_of_backend(self):
        from qubit_computer.state import concurrence

        for name in ("cpu", "gpu"):
            qc = QubitComputer(backend=name)
            sv = qc.statevector(bell_apqb(0.37))
            eta = abs(math.sin(2 * 0.37))
            self.assertAlmostEqual(concurrence(sv), eta, places=9)


if __name__ == "__main__":
    unittest.main()
