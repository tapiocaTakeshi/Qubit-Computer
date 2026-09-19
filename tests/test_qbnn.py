import math
import unittest

from qubit_computer import qbnn


class TestQBNN(unittest.TestCase):
    def test_control_bounds_with_regularized_uncertainty(self):
        self.assertEqual(qbnn.control_signal(qbnn.uncertainty(0), 0, 1), 1)
        self.assertEqual(qbnn.control_signal(-0.1, 0.2, 0.8), 0.2)
        for args in ((math.nan, 0, 1), (0.5, 1, 0), (0.5, 0, math.inf)):
            with self.assertRaises(ValueError):
                qbnn.control_signal(*args)

    def test_forward_rejects_invalid_inputs(self):
        for lam in (0, 1):
            layer = qbnn.QBNNLayer(2, 1, lam=lam)
            for h in ([1], [1, 2, 3], [math.nan, 1], [math.inf, 1]):
                with self.assertRaises(ValueError):
                    layer.forward(h)

    def test_subset_feature_count_is_2_pow_n(self):
        r = [0.2, -0.5, 0.9, 0.1]
        self.assertEqual(len(qbnn.subset_features(r)), 16)
        self.assertEqual(len(qbnn.subset_features(r, K=2)), 1 + 4 + 6)
        feats = qbnn.subset_features(r)
        self.assertAlmostEqual(feats[(0, 2)], 0.2 * 0.9)
        self.assertEqual(feats[()], 1.0)

    def test_complex_features_consistent_with_real(self):
        thetas = [0.2, 0.5]
        Phi = qbnn.complex_subset_features(thetas)
        self.assertAlmostEqual(Phi[(0, 1)].real, math.cos(2 * 0.2 + 2 * 0.5))
        self.assertAlmostEqual(abs(Phi[(0, 1)]), 1.0)

    def test_uncertainty_and_control(self):
        self.assertAlmostEqual(qbnn.uncertainty(0.0, eps=0.0), 1.0)
        self.assertAlmostEqual(qbnn.uncertainty(1.0, eps=0.0), 0.0)
        self.assertAlmostEqual(qbnn.control_signal(0.5, 0.1, 1.0), 0.55)

    def test_layer_reduces_to_plain_nn_when_lambda_zero(self):
        layer = qbnn.QBNNLayer(3, 2, K=2, lam=0.0)
        for s, _ in enumerate(layer.subsets):
            layer.J[s] = [0.7, -0.3]
        h = [0.3, -0.2, 0.9]
        out = layer.forward(h)
        plain = [math.tanh(sum(w * x for w, x in zip(row, h)) + b) for row, b in zip(layer.W, layer.b)]
        for o, p in zip(out, plain):
            self.assertAlmostEqual(o, p)

    def test_layer_matches_equations(self):
        layer = qbnn.QBNNLayer(2, 2, K=2, lam=0.5)
        layer.J = [[0.1, 0.2], [0.3, -0.4], [0.5, 0.6]]  # subsets (0,), (1,), (0,1)
        h = [0.4, -0.7]
        out = layer.forward(h)
        r = [math.tanh(x) for x in h]
        a = [sum(w * x for w, x in zip(row, h)) + b for row, b in zip(layer.W, layer.b)]
        q = [math.tanh(x) for x in a]
        for j in range(2):
            g = layer.J[0][j] * r[0] + layer.J[1][j] * r[1] + layer.J[2][j] * r[0] * r[1]
            self.assertAlmostEqual(out[j], math.tanh(a[j] + 0.5 * q[j] * g))

    def test_learns_xor(self):
        net = qbnn.QBNN([2, 4, 1], K=2, lam=1.0, seed=1)
        qbnn.train(net, qbnn.xor_dataset(), epochs=80, lr=0.2)
        self.assertEqual(qbnn.accuracy(net, qbnn.xor_dataset()), 1.0)

    def test_serialization(self):
        net = qbnn.QBNN([2, 3, 1], K=2, seed=3)
        x = [0.5, -0.5]
        net2 = qbnn.QBNN.from_dict(net.to_dict())
        self.assertAlmostEqual(net.forward(x)[0], net2.forward(x)[0])


if __name__ == "__main__":
    unittest.main()
