import json
import math
import random
import unittest

from qubit_computer import (APQB, Circuit, QubitComputer, StateVector, algorithms, concurrence,
                            gates, three_tangle)


class TestGates(unittest.TestCase):
    def test_all_fixed_gates_unitary(self):
        for name, m in gates.FIXED_GATES.items():
            self.assertTrue(gates.is_unitary(m), name)

    def test_param_gates_unitary(self):
        for name, fn in gates.PARAM_GATES.items():
            n = {"u": 3}.get(name, 1)
            m = fn(*([0.7] * n))
            self.assertTrue(gates.is_unitary(m), name)

    def test_apqb_gate_prepares_apqb_state(self):
        sv = StateVector(1).apply(gates.APQB(0.3), [0])
        c, s = APQB(0.3).amplitudes
        self.assertAlmostEqual(sv.amp[0], c)
        self.assertAlmostEqual(sv.amp[1], s)
        ro = sv.apqb_readout(0)
        self.assertAlmostEqual(ro["theta"], 0.3)
        self.assertAlmostEqual(ro["r"], math.cos(0.6))
        self.assertAlmostEqual(ro["T"], math.sin(0.6))


class TestStateVector(unittest.TestCase):
    def test_from_apqbs_matches_probabilities(self):
        sv = StateVector.from_correlations([0.8, -0.2])
        self.assertAlmostEqual(sv.apqb_readout(0)["r"], 0.8)
        self.assertAlmostEqual(sv.apqb_readout(1)["r"], -0.2)
        self.assertAlmostEqual(sum(sv.probabilities()), 1.0)

    def test_cx_and_bit_order(self):
        sv = StateVector.from_bitstring("10")  # q0=1, q1=0
        sv.apply(gates.CX, [0, 1])
        self.assertEqual(sv.nonzero()[0][0], "11")

    def test_generic_multi_qubit_apply_matches_composition(self):
        sv1 = StateVector(3).apply(gates.H, [0]).apply(gates.CCX, [0, 1, 2])
        sv2 = StateVector(3).apply(gates.H, [0])
        # Toffoli with control q1=0 is the identity.
        self.assertAlmostEqual(sv1.fidelity(sv2), 1.0)
        sv3 = StateVector.from_bitstring("110").apply(gates.CCX, [0, 1, 2])
        self.assertEqual(sv3.nonzero()[0][0], "111")

    def test_swap(self):
        sv = StateVector.from_bitstring("100").apply(gates.SWAP, [0, 2])
        self.assertEqual(sv.nonzero()[0][0], "001")

    def test_measure_collapses(self):
        rng = random.Random(3)
        sv = StateVector(2).apply(gates.H, [0]).apply(gates.CX, [0, 1])
        out = sv.measure(rng=rng)
        self.assertIn(out, ("00", "11"))
        self.assertAlmostEqual(sv.probability_of(out), 1.0)

    def test_sampling_statistics(self):
        sv = StateVector.from_apqbs([APQB.from_r(0.5)])
        counts = sv.sample(4000, rng=random.Random(0))
        self.assertAlmostEqual(counts["1"] / 4000, 0.25, delta=0.03)

    def test_entanglement_measures_match_paper(self):
        qc = QubitComputer()
        for theta in (0.0, 0.2, 0.5, math.pi / 4, 1.2):
            eta = abs(math.sin(2 * theta))
            r = math.cos(2 * theta)
            sv2 = qc.statevector(algorithms.bell_apqb(theta))
            self.assertAlmostEqual(concurrence(sv2), eta)              # Eq. 13
            self.assertAlmostEqual(concurrence(sv2) ** 2 + r * r, 1.0)  # Eq. 14
            sv3 = qc.statevector(algorithms.ghz_apqb(theta))
            self.assertAlmostEqual(three_tangle(sv3), eta * eta)        # Eq. 16
            self.assertAlmostEqual(three_tangle(sv3) + r * r, 1.0)      # Eq. 17

    def test_product_state_has_no_entanglement(self):
        sv = StateVector.from_correlations([0.3, -0.7])
        self.assertAlmostEqual(concurrence(sv), 0.0)
        self.assertAlmostEqual(sv.apqb_readout(0)["von_neumann"], 0.0)


class TestCircuitAndComputer(unittest.TestCase):
    def setUp(self):
        self.qc = QubitComputer()

    def test_bell_counts(self):
        res = self.qc.run(Circuit(2, "bell").h(0).cx(0, 1), shots=500, seed=1)
        self.assertEqual(set(res.counts), {"00", "11"})
        self.assertEqual(sum(res.counts.values()), 500)
        self.assertAlmostEqual(res.apqb[0]["von_neumann"], 1.0)

    def test_json_roundtrip(self):
        c = Circuit(3, "t").apqb(0, 0.3).cx(0, 1).cry(1, 2, 0.5).measure()
        c2 = Circuit.from_json(c.to_json())
        self.assertEqual(c.to_dict(), c2.to_dict())
        # Both circuits include measurement. Compare the same random trajectory;
        # independent draws can correctly collapse to orthogonal states.
        for seed in (0, 1, 2):
            original = self.qc.statevector(c, rng=random.Random(seed))
            restored = self.qc.statevector(c2, rng=random.Random(seed))
            self.assertAlmostEqual(original.fidelity(restored), 1.0)

    def test_initial_apqbs_serialized(self):
        c = Circuit(2).prepare_from_correlations([0.5, -0.5])
        c2 = Circuit.from_dict(json.loads(c.to_json()))
        self.assertAlmostEqual(self.qc.statevector(c2).apqb_readout(1)["r"], -0.5)

    def test_inverse(self):
        c = Circuit(2).h(0).t(0).cp(0, 1, 0.4).ry(1, 0.9).u(0, 0.1, 0.2, 0.3).sx(1).iswap(0, 1)
        sv = self.qc.statevector(c.compose(c.inverse()))
        self.assertAlmostEqual(abs(sv.amp[0]), 1.0)

    def test_mid_circuit_measurement(self):
        c = Circuit(2).h(0).measure(0).cx(0, 1).measure(1)
        res = self.qc.run(c, shots=50, seed=4)
        self.assertEqual(set(res.counts) <= {"00", "11"}, True)
        self.assertEqual(len(res.memory), 50)

    def test_validation(self):
        with self.assertRaises(IndexError):
            Circuit(1).cx(0, 1)
        with self.assertRaises(ValueError):
            Circuit(2).cx(0, 0)
        with self.assertRaises(KeyError):
            Circuit(2).append("nope", [0])

    def test_draw_runs(self):
        text = algorithms.teleportation(0.3).draw()
        self.assertIn("q2", text)


class TestAlgorithms(unittest.TestCase):
    def setUp(self):
        self.qc = QubitComputer()

    def test_teleportation_preserves_apqb(self):
        for theta in (0.1, 0.7, 1.3):
            sv = self.qc.statevector(algorithms.teleportation(theta))
            self.assertAlmostEqual(sv.apqb_readout(2)["theta"], theta)
            self.assertAlmostEqual(sv.apqb_readout(2)["purity"], 1.0)

    def test_grover_finds_marked(self):
        for marked in ("101", "0110", "11"):
            res = self.qc.run(algorithms.grover(len(marked), marked), shots=200, seed=0)
            self.assertEqual(res.most_common(), marked)
            self.assertGreater(res.counts[marked] / 200, 0.8)

    def test_deutsch_jozsa(self):
        for oracle, expect in (("constant0", "000"), ("constant1", "000"), ("balanced", "111")):
            res = self.qc.run(algorithms.deutsch_jozsa(3, oracle), shots=20, seed=0)
            self.assertEqual(res.counts, {expect: 20})

    def test_superdense(self):
        for bits in ("00", "01", "10", "11"):
            res = self.qc.run(algorithms.superdense_coding(bits), shots=10, seed=0)
            self.assertEqual(res.counts, {bits: 10})

    def test_qft_inverse(self):
        c = Circuit(4).x(1).x(3).compose(algorithms.qft(4)).compose(algorithms.inverse_qft(4))
        sv = self.qc.statevector(c)
        self.assertAlmostEqual(sv.probability_of("0101"), 1.0)

    def test_qft_of_zero_is_uniform(self):
        sv = self.qc.statevector(algorithms.qft(3))
        for p in sv.probabilities():
            self.assertAlmostEqual(p, 1 / 8)

    def test_correlation_register(self):
        rs = [0.9, 0.0, -0.6]
        ros = self.qc.readout(algorithms.correlation_register(rs))
        for ro, r in zip(ros, rs):
            self.assertAlmostEqual(ro["r"], r)
            self.assertAlmostEqual(ro["T"], math.sqrt(1 - r * r))


if __name__ == "__main__":
    unittest.main()
