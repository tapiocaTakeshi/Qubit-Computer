/**
 * APQB (Adjustable Pseudo Quantum Bit) -- the basic unit of Qubit Computer.
 *
 *   |psi(theta)> = cos(theta)|0> + sin(theta)|1>
 *   r   = cos(2 theta)          correlation / confidence  (= <Z>)
 *   eta = T = |sin(2 theta)|    uncertainty amplitude     (= |<X>|)
 *   r^2 + eta^2 = 1,  z = r + i eta = e^{i 2 theta}
 */
import { Complex, cexp } from './complex';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Eq. (4): theta(r) = 1/2 arccos(r). */
export function thetaFromR(r: number): number {
  return 0.5 * Math.acos(clamp(r, -1, 1));
}

/** Eq. (12): unconstrained latent a -> [r, eta, theta] with r = tanh a, eta = sech a. */
export function thetaFromLatent(a: number): [number, number, number] {
  const r = Math.tanh(a);
  const aa = Math.abs(a);
  const eta = (2 * Math.exp(-aa)) / (1 + Math.exp(-2 * aa));
  return [r, eta, 0.5 * Math.atan2(eta, r)];
}

/** k-body correlation Q_k(theta): even k -> cos(2k theta), odd k -> sin(2k theta). */
export function Qk(theta: number, k: number): number {
  return k % 2 === 0 ? Math.cos(2 * k * theta) : Math.sin(2 * k * theta);
}

/** Prop. 2: Re z^k = T_k(r), Im z^k = eta U_{k-1}(r) via the z^k recurrence. */
export function chebyshevFeatures(r: number, eta: number, K: number): [number[], number[]] {
  const reals: number[] = [];
  const imags: number[] = [];
  let zr = 1;
  let zi = 0;
  for (let k = 0; k < K; k++) {
    const nr = zr * r - zi * eta;
    const ni = zr * eta + zi * r;
    zr = nr;
    zi = ni;
    reals.push(zr);
    imags.push(zi);
  }
  return [reals, imags];
}

export interface APQBInfo {
  theta: number;
  r: number;
  T: number;
  p0: number;
  p1: number;
  entropy: number;
}

export class APQB {
  readonly theta: number;

  constructor(theta = 0) {
    this.theta = theta;
  }

  static fromR(r: number): APQB {
    return new APQB(thetaFromR(r));
  }

  static fromLatent(a: number): APQB {
    return new APQB(thetaFromLatent(a)[2]);
  }

  static fromProbability(p1: number): APQB {
    return new APQB(Math.asin(Math.sqrt(clamp(p1, 0, 1))));
  }

  static zero(): APQB {
    return new APQB(0);
  }

  static one(): APQB {
    return new APQB(Math.PI / 2);
  }

  static plus(): APQB {
    return new APQB(Math.PI / 4);
  }

  get r(): number {
    return Math.cos(2 * this.theta);
  }

  /** Uncertainty amplitude eta = |sin 2theta|. */
  get T(): number {
    return Math.abs(Math.sin(2 * this.theta));
  }

  get eta(): number {
    return this.T;
  }

  get z(): Complex {
    return cexp(2 * this.theta);
  }

  get amplitudes(): [number, number] {
    return [Math.cos(this.theta), Math.sin(this.theta)];
  }

  get probabilities(): [number, number] {
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    return [c * c, s * s];
  }

  /** Bloch vector (<X>, <Y>, <Z>) = (sin 2theta, 0, cos 2theta). */
  get bloch(): [number, number, number] {
    return [Math.sin(2 * this.theta), 0, Math.cos(2 * this.theta)];
  }

  get coherence(): number {
    return this.T;
  }

  /** Shannon entropy (bits) of a Z measurement. */
  get entropy(): number {
    const [p0, p1] = this.probabilities;
    let h = 0;
    for (const p of [p0, p1]) if (p > 0) h -= p * Math.log2(p);
    return h;
  }

  constraint(): number {
    return this.r ** 2 + this.T ** 2;
  }

  features(K: number): [number[], number[]] {
    return chebyshevFeatures(this.r, Math.sin(2 * this.theta), K);
  }

  adjusted(delta: number): APQB {
    return new APQB(this.theta + delta);
  }

  info(): APQBInfo {
    const [p0, p1] = this.probabilities;
    return { theta: this.theta, r: this.r, T: this.T, p0, p1, entropy: this.entropy };
  }

  toString(): string {
    const [c, s] = this.amplitudes;
    return `APQB(θ=${this.theta.toFixed(4)}) = ${c.toFixed(4)}|0> + ${s.toFixed(4)}|1>  r=${this.r >= 0 ? '+' : ''}${this.r.toFixed(4)} η=${this.T.toFixed(4)}`;
  }
}

export const registerFromCorrelations = (rs: number[]): APQB[] => rs.map((r) => APQB.fromR(r));
