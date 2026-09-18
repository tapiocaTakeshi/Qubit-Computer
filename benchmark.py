#!/usr/bin/env python3
import time
from qubit_computer import QubitComputer, Circuit, algorithms

def benchmark_operation(name, func, iterations=1):
    """Benchmark an operation."""
    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        func()
        elapsed = time.perf_counter() - start
        times.append(elapsed * 1000)
    
    avg = sum(times) / len(times)
    return avg

print("=" * 70)
print("QUBIT COMPUTER PERFORMANCE BENCHMARK (Python)")
print("=" * 70)

print("\n[1] STATE VECTOR SIZE SCALING")
print("-" * 70)
for n_qubits in [4, 8, 12, 16, 18, 20]:
    try:
        def test():
            circuit = Circuit(n_qubits)
            circuit.h(0)
            for i in range(1, n_qubits):
                circuit.cx(0, i)
            computer = QubitComputer(n_qubits)
            result = computer.run(circuit, shots=1)
        
        avg = benchmark_operation(f"GHZ({n_qubits}q)", test, iterations=3)
        state_size = 2**n_qubits
        amp_bytes = state_size * 16
        print(f"GHZ({n_qubits:2d}q) {avg:8.2f}ms | {state_size:7d} amps | {amp_bytes/1024/1024:6.1f}MB")
    except Exception as e:
        print(f"GHZ({n_qubits:2d}q) - Error: {str(e)[:50]}")

print("\n[2] GATE OPERATION OVERHEAD (8 qubits)")
print("-" * 70)
for n_gates in [10, 50, 100, 200]:
    def test():
        circuit = Circuit(8)
        for _ in range(n_gates):
            circuit.h(0)
            circuit.cx(0, 1)
            circuit.rz(0.5, 2)
        computer = QubitComputer(8)
        result = computer.run(circuit, shots=1)
    
    avg = benchmark_operation(f"Chain({n_gates:3d} gates)", test, iterations=3)
    overhead = avg / n_gates if n_gates > 0 else 0
    print(f"Chain({n_gates:3d} gates) {avg:8.2f}ms | {overhead:6.3f}ms/gate")

print("\n[3] ALGORITHM PERFORMANCE")
print("-" * 70)

def test_bell():
    circuit = algorithms.bell()
    computer = QubitComputer(2)
    result = computer.run(circuit, shots=1000)

avg = benchmark_operation("Bell (2q, 1000 shots)", test_bell, iterations=5)
print(f"Bell (2q, 1000 shots)    {avg:8.2f}ms")

def test_grover3():
    circuit = algorithms.grover(3, '011')
    computer = QubitComputer(3)
    result = computer.run(circuit, shots=1)

avg = benchmark_operation("Grover (3q)", test_grover3, iterations=5)
print(f"Grover (3q)              {avg:8.2f}ms")

def test_grover4():
    circuit = algorithms.grover(4, '0110')
    computer = QubitComputer(4)
    result = computer.run(circuit, shots=1)

avg = benchmark_operation("Grover (4q)", test_grover4, iterations=3)
print(f"Grover (4q)              {avg:8.2f}ms")

def test_grover8():
    circuit = algorithms.grover(8, '01101010')
    computer = QubitComputer(8)
    result = computer.run(circuit, shots=1)

avg = benchmark_operation("Grover (8q)", test_grover8, iterations=2)
print(f"Grover (8q)              {avg:8.2f}ms")

def test_qft8():
    circuit = algorithms.qft(8)
    computer = QubitComputer(8)
    result = computer.run(circuit, shots=1)

avg = benchmark_operation("QFT (8q)", test_qft8, iterations=3)
print(f"QFT (8q)                 {avg:8.2f}ms")

def test_qft12():
    circuit = algorithms.qft(12)
    computer = QubitComputer(12)
    result = computer.run(circuit, shots=1)

avg = benchmark_operation("QFT (12q)", test_qft12, iterations=2)
print(f"QFT (12q)                {avg:8.2f}ms")

print("\n[4] MEASUREMENT & READOUT")
print("-" * 70)
for n_qubits in [8, 12, 16]:
    def test():
        circuit = Circuit(n_qubits)
        for q in range(n_qubits):
            circuit.h(q)
        computer = QubitComputer(n_qubits)
        result = computer.run(circuit, shots=1000)
    
    avg = benchmark_operation(f"Measure({n_qubits:2d}q, 1000 shots)", test, iterations=3)
    per_shot = avg / 1000
    print(f"Measure({n_qubits:2d}q, 1000 shots) {avg:8.2f}ms | {per_shot*1000:.3f}µs/shot")

print("\n" + "=" * 70)
