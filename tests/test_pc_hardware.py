import unittest

from qubit_computer import APQB, APQBPersonalComputer, HardwareError
from qubit_computer.os import Kernel
from qubit_computer.os.kernel import KernelError
from qubit_computer.os.shell import Shell


class TestAPQBPersonalComputer(unittest.TestCase):
    def test_64_bit_only(self):
        with self.assertRaises(HardwareError):
            APQBPersonalComputer(cpu_bits=32)

    def test_kernel_assembles_all_pc_parts(self):
        kernel = Kernel(num_qubits=4, seed=1)
        report = kernel.sys_hardware()
        self.assertEqual(report["cpu"]["bits"], 64)
        self.assertEqual(report["ram"]["total_qubits"], 4)
        self.assertFalse(report["physical_quantum_hardware"])
        kernel.sys_alloc(2, "work")
        self.assertEqual(kernel.sys_hardware()["ram"]["allocated_qubits"], 2)

    def test_shell_hardware_command(self):
        lines = []
        shell = Shell(Kernel(num_qubits=4), out=lines.append)
        self.assertEqual(shell.execute_line("hardware"), 0)
        self.assertTrue(any(line.startswith("cpu:") for line in lines))

    def test_unsupported_devices_are_not_claimed_as_implemented(self):
        report = Kernel().sys_hardware()
        self.assertFalse(report["cpu"]["qvm_available"])
        self.assertIsNone(report["gpu_npu"]["lanes"])
        self.assertIsNone(report["ssd"]["capacity_bytes"])
        self.assertNotIn("watts", report["power"])
        self.assertIn("not implemented", report["sound"])

    def test_failed_allocation_does_not_leak_qubits(self):
        kernel = Kernel(num_qubits=4)
        for values in ([], [APQB(0.2)], [object(), object()]):
            with self.assertRaises((KernelError, ValueError, AttributeError)):
                kernel.sys_alloc(2, apqbs=values)
            self.assertEqual(kernel.free_qubits, list(range(4)))
            self.assertFalse(kernel.segments)
