import { APQB, thetaFromLatent, thetaFromR, chebyshevFeatures } from '../src/core/apqb';
import * as G from '../src/core/gates';
import { StateVector, concurrence, threeTangle } from '../src/core/state';
import { Circuit } from '../src/core/circuit';
import { QubitComputer, mostCommon } from '../src/core/computer';
import * as A from '../src/core/algorithms';
import * as Q from '../src/core/qbnn';
import { Rng } from '../src/core/rng';

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('APQB', () => {
  test('unit circle identity and endpoints', () => {
    for (let i = 0; i <= 100; i++) {
      const q = new APQB((i / 100) * (Math.PI / 2));
      close(q.constraint(), 1, 1e-12);
    }
    expect(APQB.zero().probabilities[0]).toBe(1);
    close(APQB.plus().probabilities[1], 0.5);
    close(APQB.plus().entropy, 1);
  });
  test('r roundtrip and Born probabilities', () => {
    for (const r of [-1, -0.5, 0, 0.3, 0.99, 1]) close(APQB.fromR(r).r, r);
    const [p0, p1] = APQB.fromR(0.4).probabilities;
    close(p0, 0.7);
    close(p1, 0.3);
    close(thetaFromR(0.2), 0.5 * Math.acos(0.2));
  });
  test('latent parameterization stays finite', () => {
    for (const a of [-50, -3, 0, 1.5, 50]) {
      const [r, eta, theta] = thetaFromLatent(a);
      close(r, Math.tanh(a));
      close(r * r + eta * eta, 1, 1e-12);
      expect(theta).toBeGreaterThanOrEqual(0);
      expect(theta).toBeLessThanOrEqual(Math.PI / 2);
    }
  });
  test('Chebyshev features', () => {
    const q = new APQB(0.37);
    const [re, im] = q.features(4);
    for (let k = 1; k <= 4; k++) {
      close(re[k - 1], Math.cos(2 * k * q.theta));
      close(im[k - 1], Math.sin(2 * k * q.theta));
    }
    close(chebyshevFeatures(q.r, q.T, 2)[0][1], 2 * q.r * q.r - 1);
  });
});

describe('gates and state vector', () => {
  test('all gates unitary', () => {
    for (const [name, m] of Object.entries(G.FIXED_GATES)) expect(G.isUnitary(m)).toBe(true);
    for (const [name, fn] of Object.entries(G.PARAM_GATES)) expect(G.isUnitary(fn(...new Array(G.GATE_PARAM_COUNT[name]).fill(0.7)))).toBe(true);
  });
  test('APQB gate prepares APQB state', () => {
    const sv = new StateVector(1).apply(G.APQB(0.3), [0]);
    const ro = sv.apqbReadout(0);
    close(ro.theta, 0.3);
    close(ro.r, Math.cos(0.6));
    close(ro.T, Math.sin(0.6));
  });
  test('bit order, CX, CCX, SWAP', () => {
    expect(StateVector.fromBitstring('10').apply(G.CX, [0, 1]).nonzero()[0][0]).toBe('11');
    expect(StateVector.fromBitstring('110').apply(G.CCX, [0, 1, 2]).nonzero()[0][0]).toBe('111');
    expect(StateVector.fromBitstring('100').apply(G.SWAP, [0, 2]).nonzero()[0][0]).toBe('001');
  });
  test('measurement collapses and sampling is unbiased', () => {
    const sv = new StateVector(2).apply(G.H, [0]).apply(G.CX, [0, 1]);
    const out = sv.measure(undefined, new Rng(3));
    expect(['00', '11']).toContain(out);
    close(sv.probabilityOf(out), 1);
    const counts = StateVector.fromAPQBs([APQB.fromR(0.5)]).sample(4000, undefined, new Rng(0));
    expect(Math.abs(counts['1'] / 4000 - 0.25)).toBeLessThan(0.03);
  });
  test('entanglement measures match the paper', () => {
    const qc = new QubitComputer();
    for (const theta of [0, 0.2, 0.5, Math.PI / 4, 1.2]) {
      const eta = Math.abs(Math.sin(2 * theta));
      const r = Math.cos(2 * theta);
      close(concurrence(qc.statevector(A.bellAPQB(theta))), eta);
      close(concurrence(qc.statevector(A.bellAPQB(theta))) ** 2 + r * r, 1);
      close(threeTangle(qc.statevector(A.ghzAPQB(theta))), eta * eta);
    }
    close(concurrence(StateVector.fromCorrelations([0.3, -0.7])), 0);
  });
});

describe('circuits and algorithms', () => {
  const qc = new QubitComputer();
  test('bell counts and json roundtrip', () => {
    const res = qc.run(new Circuit(2, 'bell').h(0).cx(0, 1), 500, 1);
    expect(Object.keys(res.counts).sort()).toEqual(['00', '11']);
    close(res.apqb[0].vonNeumann, 1);
    const c = new Circuit(3).apqb(0, 0.3).cx(0, 1).cry(1, 2, 0.5).measure();
    const c2 = Circuit.fromJSONString(c.toJSONString());
    expect(c2.toJSON()).toEqual(c.toJSON());
    const c3 = Circuit.fromJSON({ name: 'x', num_qubits: 2, initial_correlations: [0.5, -0.5], instructions: [] });
    close(qc.statevector(c3).apqbReadout(1).r, -0.5);
  });
  test('inverse', () => {
    const c = new Circuit(2).h(0).t(0).cp(0, 1, 0.4).ry(1, 0.9).u(0, 0.1, 0.2, 0.3).sx(1).iswap(0, 1);
    close(Math.abs(qc.statevector(c.compose(c.inverse())).re[0]), 1);
  });
  test('mid-circuit measurement', () => {
    const res = qc.run(new Circuit(2).h(0).measure(0).cx(0, 1).measure(1), 50, 4);
    for (const k of Object.keys(res.counts)) expect(['00', '11']).toContain(k);
    expect(res.memory.length).toBe(50);
  });
  test('teleportation preserves theta', () => {
    for (const theta of [0.1, 0.7, 1.3]) close(qc.statevector(A.teleportation(theta)).apqbReadout(2).theta, theta);
  });
  test('grover, deutsch-jozsa, superdense, qft', () => {
    for (const marked of ['101', '0110', '11']) expect(mostCommon(qc.run(A.grover(marked.length, marked), 200, 0))).toBe(marked);
    expect(qc.run(A.deutschJozsa(3, 'balanced'), 20, 0).counts).toEqual({ '111': 20 });
    expect(qc.run(A.deutschJozsa(3, 'constant1'), 20, 0).counts).toEqual({ '000': 20 });
    for (const bits of ['00', '01', '10', '11']) expect(qc.run(A.superdenseCoding(bits), 10, 0).counts).toEqual({ [bits]: 10 });
    const c = new Circuit(4).x(1).x(3).compose(A.qft(4)).compose(A.inverseQft(4));
    close(qc.statevector(c).probabilityOf('0101'), 1);
    for (const p of qc.statevector(A.qft(3)).probabilities()) close(p, 1 / 8);
  });
  test('draw', () => {
    expect(A.teleportation(0.3).draw()).toContain('q2');
  });
});

describe('QBNN', () => {
  test('subset features', () => {
    const r = [0.2, -0.5, 0.9, 0.1];
    expect(Q.subsetFeatures(r).size).toBe(16);
    expect(Q.subsetFeatures(r, 2).size).toBe(11);
    close(Q.subsetFeatures(r).get('0,2')!, 0.18);
    close(Q.complexSubsetFeatures([0.2, 0.5]).get('0,1')!.re, Math.cos(1.4));
  });
  test('lambda=0 reduces to plain layer and equations hold', () => {
    const layer = new Q.QBNNLayer(3, 2, 2, 0);
    layer.J = layer.J.map(() => [0.7, -0.3]);
    const h = [0.3, -0.2, 0.9];
    const out = layer.forward(h);
    layer.W.forEach((row, j) => close(out[j], Math.tanh(row.reduce((s, w, i) => s + w * h[i], 0) + layer.b[j])));
    const l2 = new Q.QBNNLayer(2, 2, 2, 0.5);
    l2.J = [[0.1, 0.2], [0.3, -0.4], [0.5, 0.6]];
    const x = [0.4, -0.7];
    const o = l2.forward(x);
    const r = x.map(Math.tanh);
    for (let j = 0; j < 2; j++) {
      const a = l2.W[j].reduce((s, w, i) => s + w * x[i], 0) + l2.b[j];
      const g = l2.J[0][j] * r[0] + l2.J[1][j] * r[1] + l2.J[2][j] * r[0] * r[1];
      close(o[j], Math.tanh(a + 0.5 * Math.tanh(a) * g));
    }
  });
  test('learns XOR and serializes', () => {
    const net = new Q.QBNN([2, 4, 1], 2, 1, 'tanh', 'identity', 1);
    Q.train(net, Q.xorDataset(), { epochs: 80, lr: 0.2 });
    expect(Q.accuracy(net, Q.xorDataset())).toBe(1);
    const net2 = Q.QBNN.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
    close(net.forward([0.5, -0.5])[0], net2.forward([0.5, -0.5])[0]);
  });
});
