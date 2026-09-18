/**
 * QBNN -- APQB neural network layer (paper v2 Sec. 4-5, Eq. 19-32).
 *   r = tanh(h); a = W h + b; q = tanh(a)
 *   g_j = sum_{S, 1<=|S|<=K} J_{S,j} prod_{i in S} r_i
 *   Delta = q (.) g;  a~ = a + lambda Delta;  h' = sigma(a~)
 */
import { cexp, cmul, Complex } from './complex';
import { Rng } from './rng';

export type Subset = number[];

function combinations(n: number, k: number): Subset[] {
  const out: Subset[] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

export const subsetKey = (S: Subset): string => (S.length ? S.join(',') : '∅');

/** phi_S(r) = prod_{i in S} r_i for |S| <= K (Eq. 19). */
export function subsetFeatures(r: number[], K?: number): Map<string, number> {
  const n = r.length;
  const kk = K ?? n;
  const feats = new Map<string, number>([['∅', 1]]);
  for (let k = 1; k <= kk; k++) for (const S of combinations(n, k)) feats.set(subsetKey(S), S.reduce((p, i) => p * r[i], 1));
  return feats;
}

/** Phi_S(z) = prod z_i, z_i = exp(i 2 theta_i) (Eq. 21-22). */
export function complexSubsetFeatures(thetas: number[], K?: number): Map<string, Complex> {
  const z = thetas.map((t) => cexp(2 * t));
  const kk = K ?? z.length;
  const feats = new Map<string, Complex>([['∅', { re: 1, im: 0 }]]);
  for (let k = 1; k <= kk; k++) for (const S of combinations(z.length, k)) feats.set(subsetKey(S), S.reduce((p, i) => cmul(p, z[i]), { re: 1, im: 0 }));
  return feats;
}

/** eta = sqrt(1 - r^2 + eps) (Eq. 31). */
export const uncertainty = (r: number, eps = 1e-6): number => Math.sqrt(Math.max(1 - r * r, 0) + eps);
/** Monotone map eta -> [lo, hi] (Eq. 11 / 32). */
export const controlSignal = (eta: number, lo: number, hi: number): number => lo + (hi - lo) * eta;

export type ActivationName = 'tanh' | 'identity' | 'sigmoid' | 'relu';
const ACT: Record<ActivationName, (x: number) => number> = {
  tanh: Math.tanh,
  identity: (x) => x,
  sigmoid: (x) => 1 / (1 + Math.exp(-x)),
  relu: (x) => (x > 0 ? x : 0),
};

export interface LayerJSON {
  in_dim: number;
  out_dim: number;
  K: number;
  lam: number;
  activation: ActivationName;
  W: number[][];
  b: number[];
  J: number[][];
}

export type ParamRef = { row: number[]; i: number };

export class QBNNLayer {
  inDim: number;
  outDim: number;
  K: number;
  lam: number;
  activation: ActivationName;
  W: number[][];
  b: number[];
  subsets: Subset[] = [];
  J: number[][];
  last: { r: number[]; a: number[]; q: number[]; g: number[]; delta: number[]; eta: number[] } | null = null;

  constructor(inDim: number, outDim: number, K = 1, lam = 1, activation: ActivationName = 'tanh', rng?: Rng, initScale = 0.5) {
    const r = rng ?? new Rng(0);
    this.inDim = inDim;
    this.outDim = outDim;
    this.K = Math.max(0, Math.min(K, inDim));
    this.lam = lam;
    this.activation = activation;
    this.W = Array.from({ length: outDim }, () => Array.from({ length: inDim }, () => (r.random() * 2 - 1) * initScale));
    this.b = new Array(outDim).fill(0);
    for (let k = 1; k <= this.K; k++) this.subsets.push(...combinations(inDim, k));
    this.J = this.subsets.map(() => new Array(outDim).fill(0));
  }

  parameters(): ParamRef[] {
    const refs: ParamRef[] = [];
    for (const row of this.W) for (let i = 0; i < row.length; i++) refs.push({ row, i });
    for (let i = 0; i < this.b.length; i++) refs.push({ row: this.b, i });
    for (const row of this.J) for (let i = 0; i < row.length; i++) refs.push({ row, i });
    return refs;
  }

  numParameters(): number {
    return this.outDim * this.inDim + this.outDim + this.subsets.length * this.outDim;
  }

  forward(h: number[]): number[] {
    const r = h.map(Math.tanh);
    const a = this.W.map((row, j) => row.reduce((s, w, i) => s + w * h[i], 0) + this.b[j]);
    const q = a.map(Math.tanh);
    const g = new Array(this.outDim).fill(0);
    if (this.lam !== 0 && this.subsets.length) {
      this.subsets.forEach((S, s) => {
        const phi = S.reduce((p, i) => p * r[i], 1);
        if (phi === 0) return;
        const Jrow = this.J[s];
        for (let j = 0; j < this.outDim; j++) g[j] += Jrow[j] * phi;
      });
    }
    const delta = q.map((qq, j) => qq * g[j]);
    const aTilde = a.map((aa, j) => aa + this.lam * delta[j]);
    const act = ACT[this.activation];
    this.last = { r, a, q, g, delta, eta: r.map((v) => uncertainty(v)) };
    return aTilde.map(act);
  }

  toJSON(): LayerJSON {
    return { in_dim: this.inDim, out_dim: this.outDim, K: this.K, lam: this.lam, activation: this.activation, W: this.W, b: this.b, J: this.J };
  }

  static fromJSON(d: LayerJSON): QBNNLayer {
    const l = new QBNNLayer(d.in_dim, d.out_dim, d.K ?? 1, d.lam ?? 1, d.activation ?? 'tanh');
    l.W = d.W.map((row) => row.map(Number));
    l.b = d.b.map(Number);
    l.J = d.J.map((row) => row.map(Number));
    return l;
  }
}

export interface QBNNJSON {
  dims: number[];
  layers: LayerJSON[];
}

export class QBNN {
  dims: number[];
  layers: QBNNLayer[] = [];

  constructor(dims: number[], K = 1, lam = 1, activation: ActivationName = 'tanh', outputActivation: ActivationName = 'identity', seed = 0) {
    const rng = new Rng(seed);
    this.dims = [...dims];
    for (let i = 0; i < dims.length - 1; i++) {
      const last = i === dims.length - 2;
      this.layers.push(new QBNNLayer(dims[i], dims[i + 1], K, lam, last ? outputActivation : activation, rng));
    }
  }

  forward(x: number[]): number[] {
    let h = [...x];
    for (const l of this.layers) h = l.forward(h);
    return h;
  }

  parameters(): ParamRef[] {
    return this.layers.flatMap((l) => l.parameters());
  }

  numParameters(): number {
    return this.layers.reduce((s, l) => s + l.numParameters(), 0);
  }

  uncertainties(): number[][] {
    return this.layers.map((l) => l.last?.eta ?? []);
  }

  toJSON(): QBNNJSON {
    return { dims: this.dims, layers: this.layers.map((l) => l.toJSON()) };
  }

  static fromJSON(d: QBNNJSON): QBNN {
    const net = new QBNN(d.dims);
    net.layers = d.layers.map((ld) => QBNNLayer.fromJSON(ld));
    return net;
  }
}

export type Sample = [number[], number[]];

export const xorDataset = (): Sample[] => [[[-1, -1], [-1]], [[-1, 1], [1]], [[1, -1], [1]], [[1, 1], [-1]]];

export function parityDataset(n: number): Sample[] {
  const data: Sample[] = [];
  for (let idx = 0; idx < 2 ** n; idx++) {
    const x: number[] = [...Array(n).keys()].map((i) => ((idx >> i) & 1 ? 1 : -1));
    data.push([x, [x.reduce((p, v) => p * v, 1)]]);
  }
  return data;
}

export function mse(net: QBNN, data: Sample[]): number {
  let total = 0;
  for (const [x, y] of data) {
    const out = net.forward(x);
    total += out.reduce((s, o, i) => s + (o - y[i]) ** 2, 0);
  }
  return total / data.length;
}

export function accuracy(net: QBNN, data: Sample[]): number {
  let ok = 0;
  for (const [x, y] of data) {
    const out = net.forward(x);
    if (out.every((o, i) => o > 0 === y[i] > 0)) ok++;
  }
  return ok / data.length;
}

export interface TrainOptions {
  epochs?: number;
  lr?: number;
  eps?: number;
  log?: (line: string) => void;
  logEvery?: number;
  onEpoch?: (epoch: number, loss: number) => void;
}

/** Gradient descent with central finite differences (small hypothesis-testing nets). */
export function train(net: QBNN, data: Sample[], opts: TrainOptions = {}): number[] {
  const epochs = opts.epochs ?? 200;
  const lr = opts.lr ?? 0.1;
  const eps = opts.eps ?? 1e-4;
  const logEvery = opts.logEvery ?? 50;
  const history: number[] = [];
  const params = net.parameters();
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const grads: number[] = [];
    for (const { row, i } of params) {
      const orig = row[i];
      row[i] = orig + eps;
      const lp = mse(net, data);
      row[i] = orig - eps;
      const lm = mse(net, data);
      row[i] = orig;
      grads.push((lp - lm) / (2 * eps));
    }
    params.forEach(({ row, i }, k) => (row[i] -= lr * grads[k]));
    const loss = mse(net, data);
    history.push(loss);
    opts.onEpoch?.(epoch, loss);
    if (opts.log && (epoch % logEvery === 0 || epoch === 1 || epoch === epochs)) {
      opts.log(`epoch ${String(epoch).padStart(4)}  loss ${loss.toFixed(6)}  acc ${accuracy(net, data).toFixed(2)}`);
    }
  }
  return history;
}

/** Train one epoch (for incremental UI progress). */
export function trainStep(net: QBNN, data: Sample[], lr = 0.1, eps = 1e-4): number {
  const params = net.parameters();
  const grads = params.map(({ row, i }) => {
    const orig = row[i];
    row[i] = orig + eps;
    const lp = mse(net, data);
    row[i] = orig - eps;
    const lm = mse(net, data);
    row[i] = orig;
    return (lp - lm) / (2 * eps);
  });
  params.forEach(({ row, i }, k) => (row[i] -= lr * grads[k]));
  return mse(net, data);
}
