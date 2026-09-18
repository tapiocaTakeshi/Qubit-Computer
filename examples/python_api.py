"""Using Qubit Computer from Python (hardware layer + OS layer)."""

import math

from qubit_computer import APQB, Circuit, QubitComputer, algorithms, concurrence, qbnn
from qubit_computer.os import Kernel, Shell

# --- APQB: the basic unit -------------------------------------------------
q = APQB.from_r(0.6)                      # theta = 1/2 arccos r
print(q, "| r^2 + T^2 =", q.constraint())

# --- Hardware: run a circuit on APQB qubits ---------------------------------
qc = QubitComputer()
circuit = Circuit(2, "apqb-bell").apqb(0, 0.4).cx(0, 1).measure()
result = qc.run(circuit, shots=1000, seed=42)
print(result.summary())
print("concurrence =", concurrence(result.state), "= eta =", abs(math.sin(0.8)))

# --- Prepare a register directly from correlation coefficients ------------
reg = qc.prepare([APQB.from_r(r) for r in (0.9, 0.0, -0.6)])
print([round(ro["r"], 3) for ro in reg.apqb_readouts()])

# --- Built-in algorithms ----------------------------------------------------
print(qc.run(algorithms.grover(3, "101"), shots=100, seed=0).most_common())

# --- QBNN layer (multiplicative APQB gating) --------------------------------
net = qbnn.QBNN([2, 4, 1], K=2, lam=1.0, seed=1)
qbnn.train(net, qbnn.xor_dataset(), epochs=60, lr=0.2)
print("XOR accuracy:", qbnn.accuracy(net, qbnn.xor_dataset()))

# --- QubitOS: kernel syscalls and the shell ---------------------------------
kernel = Kernel(num_qubits=8, seed=1, theta=0.2)
seg = kernel.sys_alloc(2, "pair", apqbs=[APQB(0.3), APQB.zero()])
kernel.sys_apply(seg.sid, "cx", [0, 1])
print(kernel.sys_entanglement(seg.sid))
proc = kernel.sys_run("teleport", ["0.7"], shots=1)
print(proc.state, proc.result.apqb[2]["theta"])

shell = Shell(kernel)
shell.execute_line("run bell --shots 10 --seed 1; ps")
