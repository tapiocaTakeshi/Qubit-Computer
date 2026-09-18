/**
 * State-vector engine. Qubit j is bit j of the basis index (qubit 0 = LSB).
 * Bitstrings print qubit 0 on the LEFT.
 */
import { APQB, thetaFromR } from './apqb';
import { Complex, C, cabs2, cfmt, cmul, conj } from './complex';
import { Matrix } from './gates';
import { Rng } from './rng';

export interface APQBReadout {
  qubit: number;
  r: number;
  T: number;
  x: number;
  y: number;
  z: number;
  theta: number;
  coherence: number;
  purity: number;
  p0: number;
  p1: number;
  entropy: number;
  vonNeumann: number;
}

export class StateVector {
  readonly n: number;
  readonly dim: number;
  re: Float64Array;
  im: Float64Array;

  constructor(numQubits: number, amplitudes?: Complex[]) {
    if (!Number.isInteger(numQubits) || numQubits < 1 || numQubits > 20) throw new Error('a register needs 1..20 simulated qubits');
    this.n = numQubits;
    this.dim = 2 ** numQubits;
    this.re = new Float64Array(this.dim);
    this.im = new Float64Array(this.dim);
    if (amplitudes) {
      if (amplitudes.length !== this.dim) throw new Error(`expected ${this.dim} amplitudes`);
      amplitudes.forEach((a, i) => {
        this.re[i] = a.re;
        this.im[i] = a.im;
      });
      this.normalize();
    } else {
      this.re[0] = 1;
    }
  }

  static fromAPQBs(apqbs: APQB[]): StateVector {
    const sv = new StateVector(apqbs.length);
    sv.re.fill(0);
    for (let idx = 0; idx < sv.dim; idx++) {
      let a = 1;
      apqbs.forEach((q, j) => {
        const [c, s] = q.amplitudes;
        a *= (idx >> j) & 1 ? s : c;
      });
      sv.re[idx] = a;
    }
    return sv;
  }

  static fromCorrelations(rs: number[]): StateVector {
    return StateVector.fromAPQBs(rs.map((r) => APQB.fromR(r)));
  }

  static fromBitstring(bits: string): StateVector {
    const sv = new StateVector(bits.length);
    let idx = 0;
    for (let j = 0; j < bits.length; j++) {
      if (bits[j] === '1') idx |= 1 << j;
      else if (bits[j] !== '0') throw new Error('bitstring must contain only 0/1');
    }
    sv.re.fill(0);
    sv.re[idx] = 1;
    return sv;
  }

  copy(): StateVector {
    const sv = new StateVector(this.n);
    sv.re.set(this.re);
    sv.im.set(this.im);
    return sv;
  }

  amp(i: number): Complex {
    return C(this.re[i], this.im[i]);
  }

  normalize(): void {
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += this.re[i] ** 2 + this.im[i] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) throw new Error('cannot normalize the zero vector');
    if (Math.abs(norm - 1) > 1e-15) {
      for (let i = 0; i < this.dim; i++) {
        this.re[i] /= norm;
        this.im[i] /= norm;
      }
    }
  }

  indexToBits(idx: number): string {
    let s = '';
    for (let j = 0; j < this.n; j++) s += (idx >> j) & 1 ? '1' : '0';
    return s;
  }

  bitsToIndex(bits: string): number {
    let idx = 0;
    for (let j = 0; j < bits.length; j++) if (bits[j] === '1') idx |= 1 << j;
    return idx;
  }

  probabilities(): number[] {
    const out: number[] = new Array(this.dim);
    for (let i = 0; i < this.dim; i++) out[i] = this.re[i] ** 2 + this.im[i] ** 2;
    return out;
  }

  probabilityOf(bits: string): number {
    const i = this.bitsToIndex(bits);
    return this.re[i] ** 2 + this.im[i] ** 2;
  }

  fidelity(other: StateVector): number {
    if (other.dim !== this.dim) throw new Error('dimension mismatch');
    let re = 0;
    let im = 0;
    for (let i = 0; i < this.dim; i++) {
      const p = cmul(conj(this.amp(i)), other.amp(i));
      re += p.re;
      im += p.im;
    }
    return re * re + im * im;
  }

  /** Apply a k-qubit unitary to targets (first target = most significant bit of the matrix index). */
  apply(matrix: Matrix, targets: number[]): StateVector {
    const k = targets.length;
    if (matrix.length !== 1 << k) throw new Error(`matrix of size ${matrix.length} does not act on ${k} qubit(s)`);
    for (const t of targets) if (t < 0 || t >= this.n) throw new Error(`qubit ${t} out of range for ${this.n}-qubit register`);
    if (new Set(targets).size !== k) throw new Error('targets must be distinct');
    if (k === 1) {
      this.apply1q(matrix, targets[0]);
      return this;
    }
    const masks = targets.map((t) => 1 << t);
    let targetMask = 0;
    for (const m of masks) targetMask |= m;
    const sub = 1 << k;
    const newRe = new Float64Array(this.re);
    const newIm = new Float64Array(this.im);
    const idxs = new Array<number>(sub);
    for (let base = 0; base < this.dim; base++) {
      if (base & targetMask) continue;
      for (let local = 0; local < sub; local++) {
        let idx = base;
        for (let j = 0; j < k; j++) if ((local >> (k - 1 - j)) & 1) idx |= masks[j];
        idxs[local] = idx;
      }
      for (let row = 0; row < sub; row++) {
        let accRe = 0;
        let accIm = 0;
        const mrow = matrix[row];
        for (let col = 0; col < sub; col++) {
          const m = mrow[col];
          if (m.re === 0 && m.im === 0) continue;
          const vr = this.re[idxs[col]];
          const vi = this.im[idxs[col]];
          accRe += m.re * vr - m.im * vi;
          accIm += m.re * vi + m.im * vr;
        }
        newRe[idxs[row]] = accRe;
        newIm[idxs[row]] = accIm;
      }
    }
    this.re = newRe;
    this.im = newIm;
    return this;
  }

  private apply1q(m: Matrix, t: number): void {
    const bit = 1 << t;
    const [[m00, m01], [m10, m11]] = m;
    for (let i = 0; i < this.dim; i++) {
      if (i & bit) continue;
      const j = i | bit;
      const a0r = this.re[i];
      const a0i = this.im[i];
      const a1r = this.re[j];
      const a1i = this.im[j];
      this.re[i] = m00.re * a0r - m00.im * a0i + m01.re * a1r - m01.im * a1i;
      this.im[i] = m00.re * a0i + m00.im * a0r + m01.re * a1i + m01.im * a1r;
      this.re[j] = m10.re * a0r - m10.im * a0i + m11.re * a1r - m11.im * a1i;
      this.im[j] = m10.re * a0i + m10.im * a0r + m11.re * a1i + m11.im * a1r;
    }
  }

  /** Sample one Born-rule outcome for qubits (default all); collapses unless told otherwise. */
  measure(qubits?: number[], rng?: Rng, collapse = true): string {
    const r = rng ?? new Rng();
    const qs = qubits ?? [...Array(this.n).keys()];
    const probs = this.probabilities();
    const u = r.random();
    let acc = 0;
    let chosen = this.dim - 1;
    for (let idx = 0; idx < this.dim; idx++) {
      acc += probs[idx];
      if (u < acc) {
        chosen = idx;
        break;
      }
    }
    const outcome = qs.map((q) => ((chosen >> q) & 1 ? '1' : '0')).join('');
    if (collapse) this.collapse(qs, outcome);
    return outcome;
  }

  collapse(qubits: number[], outcome: string): void {
    let mask = 0;
    let want = 0;
    qubits.forEach((q, i) => {
      mask |= 1 << q;
      if (outcome[i] === '1') want |= 1 << q;
    });
    for (let i = 0; i < this.dim; i++) {
      if ((i & mask) !== want) {
        this.re[i] = 0;
        this.im[i] = 0;
      }
    }
    this.normalize();
  }

  sample(shots: number, qubits?: number[], rng?: Rng): Record<string, number> {
    if (!Number.isInteger(shots) || shots < 0 || shots > 16384) throw new Error('shots must be an integer in 0..16384');
    const r = rng ?? new Rng();
    const qs = qubits ?? [...Array(this.n).keys()];
    const probs = this.probabilities();
    const cdf: number[] = [];
    let acc = 0;
    for (const p of probs) {
      acc += p;
      cdf.push(acc);
    }
    const counts: Record<string, number> = {};
    for (let s = 0; s < shots; s++) {
      const u = r.random() * acc;
      let lo = 0;
      let hi = this.dim - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] > u) hi = mid;
        else lo = mid + 1;
      }
      const key = qs.map((q) => ((lo >> q) & 1 ? '1' : '0')).join('');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  reducedDensityMatrix(qubit: number): Complex[][] {
    const bit = 1 << qubit;
    const rho = [[C(0), C(0)], [C(0), C(0)]];
    for (let i = 0; i < this.dim; i++) {
      if (i & bit) continue;
      const a0 = this.amp(i);
      const a1 = this.amp(i | bit);
      const add = (r: number, c: number, v: Complex) => {
        rho[r][c].re += v.re;
        rho[r][c].im += v.im;
      };
      add(0, 0, cmul(a0, conj(a0)));
      add(0, 1, cmul(a0, conj(a1)));
      add(1, 0, cmul(a1, conj(a0)));
      add(1, 1, cmul(a1, conj(a1)));
    }
    return rho;
  }

  expectation(qubit: number, pauli: 'X' | 'Y' | 'Z'): number {
    const rho = this.reducedDensityMatrix(qubit);
    if (pauli === 'Z') return rho[0][0].re - rho[1][1].re;
    if (pauli === 'X') return 2 * rho[0][1].re;
    return -2 * rho[0][1].im;
  }

  apqbReadout(qubit: number): APQBReadout {
    const rho = this.reducedDensityMatrix(qubit);
    const p0 = rho[0][0].re;
    const p1 = rho[1][1].re;
    const r = p0 - p1;
    const x = 2 * rho[0][1].re;
    const y = -2 * rho[0][1].im;
    const coherence = 2 * Math.hypot(rho[0][1].re, rho[0][1].im);
    const purity = p0 * p0 + p1 * p1 + 2 * cabs2(rho[0][1]);
    const tr = p0 + p1;
    const det = p0 * p1 - cabs2(rho[0][1]);
    const disc = Math.max((tr * tr) / 4 - det, 0);
    const lams = [tr / 2 + Math.sqrt(disc), tr / 2 - Math.sqrt(disc)];
    let vn = 0;
    for (const l of lams) if (l > 1e-15) vn -= l * Math.log2(l);
    let ent = 0;
    for (const p of [p0, p1]) if (p > 1e-15) ent -= p * Math.log2(p);
    return {
      qubit, r, T: Math.abs(x), x, y, z: r, theta: thetaFromR(r), coherence, purity, p0, p1,
      entropy: ent, vonNeumann: Math.max(vn, 0),
    };
  }

  apqbReadouts(): APQBReadout[] {
    return [...Array(this.n).keys()].map((j) => this.apqbReadout(j));
  }

  nonzero(tol = 1e-12): Array<[string, Complex]> {
    const out: Array<[string, Complex]> = [];
    for (let i = 0; i < this.dim; i++) {
      if (this.re[i] ** 2 + this.im[i] ** 2 > tol * tol) out.push([this.indexToBits(i), this.amp(i)]);
    }
    return out;
  }

  toString(): string {
    const parts = this.nonzero().map(([bits, a]) => `${cfmt(a)}|${bits}>`);
    return parts.length ? parts.join(' ') : '0';
  }
}

/** Wootters concurrence of a pure 2-qubit state: 2|a00 a11 - a01 a10|. */
export function concurrence(sv: StateVector): number {
  if (sv.n !== 2) throw new Error('concurrence() is defined here for 2-qubit pure states');
  const p = cmul(sv.amp(0), sv.amp(3));
  const q = cmul(sv.amp(1), sv.amp(2));
  return 2 * Math.hypot(p.re - q.re, p.im - q.im);
}

/** Coffman-Kundu-Wootters three-tangle of a pure 3-qubit state. */
export function threeTangle(sv: StateVector): number {
  if (sv.n !== 3) throw new Error('threeTangle() is defined here for 3-qubit pure states');
  const a = (i: number, j: number, k: number) => sv.amp(i | (j << 1) | (k << 2));
  const m = cmul;
  const sq = (v: Complex) => m(v, v);
  const a000 = a(0, 0, 0), a001 = a(0, 0, 1), a010 = a(0, 1, 0), a011 = a(0, 1, 1);
  const a100 = a(1, 0, 0), a101 = a(1, 0, 1), a110 = a(1, 1, 0), a111 = a(1, 1, 1);
  const sum = (...vs: Complex[]) => vs.reduce((acc, v) => C(acc.re + v.re, acc.im + v.im), C(0));
  const d1 = sum(m(sq(a000), sq(a111)), m(sq(a001), sq(a110)), m(sq(a010), sq(a101)), m(sq(a100), sq(a011)));
  const d2 = sum(
    m(m(a000, a111), m(a011, a100)), m(m(a000, a111), m(a101, a010)), m(m(a000, a111), m(a110, a001)),
    m(m(a011, a100), m(a101, a010)), m(m(a011, a100), m(a110, a001)), m(m(a101, a010), m(a110, a001)),
  );
  const d3 = sum(m(m(a000, a110), m(a101, a011)), m(m(a111, a001), m(a010, a100)));
  const v = C(d1.re - 2 * d2.re + 4 * d3.re, d1.im - 2 * d2.im + 4 * d3.im);
  return 4 * Math.hypot(v.re, v.im);
}
