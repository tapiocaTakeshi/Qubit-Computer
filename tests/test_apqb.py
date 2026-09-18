import math
import unittest

from qubit_computer import APQB, chebyshev_features, theta_from_latent, theta_from_r
from qubit_computer.apqb import Q_k


class TestAPQB(unittest.TestCase):
    def test_endpoints(self):
        self.assertEqual(APQB.zero().probabilities, (1.0, 0.0))
        self.assertAlmostEqual(APQB.one().probabilities[1], 1.0)
        p0, p1 = APQB.plus().probabilities
        self.assertAlmostEqual(p0, 0.5)
        self.assertAlmostEqual(p1, 0.5)

    def test_unit_circle_identity(self):
        for i in range(0, 101):
            q = APQB(i / 100 * math.pi / 2)
            self.assertAlmostEqual(q.constraint(), 1.0, places=12)
            self.assertAlmostEqual(q.r, math.cos(2 * q.theta))
            self.assertAlmostEqual(q.T, abs(math.sin(2 * q.theta)))

    def test_r_roundtrip(self):
        for r in (-1.0, -0.5, 0.0, 0.3, 0.99, 1.0):
            self.assertAlmostEqual(APQB.from_r(r).r, r, places=9)
            self.assertAlmostEqual(theta_from_r(r), 0.5 * math.acos(r))

    def test_born_probabilities_match_correlation(self):
        q = APQB.from_r(0.4)
        p0, p1 = q.probabilities
        self.assertAlmostEqual(p0, (1 + 0.4) / 2)
        self.assertAlmostEqual(p1, (1 - 0.4) / 2)

    def test_latent_parameterization(self):
        for a in (-50.0, -3.0, 0.0, 1.5, 50.0):
            r, T, theta = theta_from_latent(a)
            self.assertAlmostEqual(r, math.tanh(a))
            self.assertAlmostEqual(r * r + T * T, 1.0, places=12)
            self.assertTrue(0 <= theta <= math.pi / 2)
            self.assertAlmostEqual(APQB.from_latent(a).r, r, places=9)

    def test_chebyshev_features(self):
        q = APQB(0.37)
        re, im = q.features(4)
        for k in range(1, 5):
            self.assertAlmostEqual(re[k - 1], math.cos(2 * k * q.theta))
            self.assertAlmostEqual(im[k - 1], math.sin(2 * k * q.theta))
        # T_k(r) identity on the real part
        r = q.r
        self.assertAlmostEqual(re[1], 2 * r * r - 1)
        self.assertAlmostEqual(Q_k(q.theta, 2), math.cos(4 * q.theta))

    def test_density_matrix_and_entropy(self):
        q = APQB.plus()
        rho = q.density_matrix()
        self.assertAlmostEqual(rho[0][0].real, 0.5)
        self.assertAlmostEqual(rho[0][1].real, 0.5)
        self.assertAlmostEqual(q.entropy, 1.0)
        self.assertAlmostEqual(APQB.zero().entropy, 0.0)
        self.assertAlmostEqual(q.coherence, 1.0)


if __name__ == "__main__":
    unittest.main()
