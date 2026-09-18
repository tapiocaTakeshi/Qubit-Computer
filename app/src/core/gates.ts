/** Gate library. Matrices are row-major arrays of Complex. */
import { C, Complex, cexp, cmul, conj } from './complex';
import { thetaFromLatent, thetaFromR } from './apqb';

export type Matrix = Complex[][];

const S2 = 1 / Math.SQRT2;
const c = C;

export const I: Matrix = [[c(1), c(0)], [c(0), c(1)]];
export const X: Matrix = [[c(0), c(1)], [c(1), c(0)]];
export const Y: Matrix = [[c(0), c(0, -1)], [c(0, 1), c(0)]];
export const Z: Matrix = [[c(1), c(0)], [c(0), c(-1)]];
export const H: Matrix = [[c(S2), c(S2)], [c(S2), c(-S2)]];
export const S: Matrix = [[c(1), c(0)], [c(0), c(0, 1)]];
export const SDG: Matrix = [[c(1), c(0)], [c(0), c(0, -1)]];
export const T: Matrix = [[c(1), c(0)], [c(0), cexp(Math.PI / 4)]];
export const TDG: Matrix = [[c(1), c(0)], [c(0), cexp(-Math.PI / 4)]];
export const SX: Matrix = [[c(0.5, 0.5), c(0.5, -0.5)], [c(0.5, -0.5), c(0.5, 0.5)]];

export const RX = (t: number): Matrix => {
  const co = Math.cos(t / 2);
  const si = Math.sin(t / 2);
  return [[c(co), c(0, -si)], [c(0, -si), c(co)]];
};
export const RY = (t: number): Matrix => {
  const co = Math.cos(t / 2);
  const si = Math.sin(t / 2);
  return [[c(co), c(-si)], [c(si), c(co)]];
};
export const RZ = (t: number): Matrix => [[cexp(-t / 2), c(0)], [c(0), cexp(t / 2)]];
export const P = (lam: number): Matrix => [[c(1), c(0)], [c(0), cexp(lam)]];
export const U = (t: number, phi: number, lam: number): Matrix => {
  const co = Math.cos(t / 2);
  const si = Math.sin(t / 2);
  return [
    [c(co), cmul(cexp(lam), c(-si))],
    [cmul(cexp(phi), c(si)), cmul(cexp(phi + lam), c(co))],
  ];
};

/** APQB preparation gate RY(2 theta): |0> -> cos(theta)|0> + sin(theta)|1>. */
export const APQB = (theta: number): Matrix => RY(2 * theta);
export const APQB_R = (r: number): Matrix => APQB(thetaFromR(r));
export const APQB_A = (a: number): Matrix => APQB(thetaFromLatent(a)[2]);

/** Controlled version of a k-qubit unitary (control = first target). */
export function controlled(u: Matrix): Matrix {
  const n = u.length;
  const dim = 2 * n;
  const m: Matrix = [];
  for (let i = 0; i < dim; i++) {
    const row: Complex[] = [];
    for (let j = 0; j < dim; j++) row.push(c(0));
    m.push(row);
  }
  for (let i = 0; i < n; i++) m[i][i] = c(1);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[n + i][n + j] = u[i][j];
  return m;
}

export const CX = controlled(X);
export const CY = controlled(Y);
export const CZ = controlled(Z);
export const CH = controlled(H);
export const SWAP: Matrix = [
  [c(1), c(0), c(0), c(0)],
  [c(0), c(0), c(1), c(0)],
  [c(0), c(1), c(0), c(0)],
  [c(0), c(0), c(0), c(1)],
];
export const ISWAP: Matrix = [
  [c(1), c(0), c(0), c(0)],
  [c(0), c(0), c(0, 1), c(0)],
  [c(0), c(0, 1), c(0), c(0)],
  [c(0), c(0), c(0), c(1)],
];
export const CRX = (t: number): Matrix => controlled(RX(t));
export const CRY = (t: number): Matrix => controlled(RY(t));
export const CRZ = (t: number): Matrix => controlled(RZ(t));
export const CP = (l: number): Matrix => controlled(P(l));
export const CAPQB = (t: number): Matrix => controlled(APQB(t));
export const RXX = (t: number): Matrix => {
  const co = c(Math.cos(t / 2));
  const si = c(0, -Math.sin(t / 2));
  return [[co, c(0), c(0), si], [c(0), co, si, c(0)], [c(0), si, co, c(0)], [si, c(0), c(0), co]];
};
export const RZZ = (t: number): Matrix => {
  const em = cexp(-t / 2);
  const ep = cexp(t / 2);
  return [[em, c(0), c(0), c(0)], [c(0), ep, c(0), c(0)], [c(0), c(0), ep, c(0)], [c(0), c(0), c(0), em]];
};
export const CCX = controlled(CX);
export const CSWAP = controlled(SWAP);

export const FIXED_GATES: Record<string, Matrix> = {
  i: I, id: I, x: X, y: Y, z: Z, h: H, s: S, sdg: SDG, t: T, tdg: TDG, sx: SX,
  cx: CX, cnot: CX, cy: CY, cz: CZ, ch: CH, swap: SWAP, iswap: ISWAP,
  ccx: CCX, toffoli: CCX, cswap: CSWAP, fredkin: CSWAP,
};

export const PARAM_GATES: Record<string, (...p: number[]) => Matrix> = {
  rx: RX, ry: RY, rz: RZ, p: P, u: U, apqb: APQB, apqb_r: APQB_R, apqb_a: APQB_A,
  crx: CRX, cry: CRY, crz: CRZ, cp: CP, capqb: CAPQB, rxx: RXX, rzz: RZZ,
};

export const GATE_ARITY: Record<string, number> = {};
for (const k of ['i', 'id', 'x', 'y', 'z', 'h', 's', 'sdg', 't', 'tdg', 'sx', 'rx', 'ry', 'rz', 'p', 'u', 'apqb', 'apqb_r', 'apqb_a']) GATE_ARITY[k] = 1;
for (const k of ['cx', 'cnot', 'cy', 'cz', 'ch', 'swap', 'iswap', 'crx', 'cry', 'crz', 'cp', 'capqb', 'rxx', 'rzz']) GATE_ARITY[k] = 2;
for (const k of ['ccx', 'toffoli', 'cswap', 'fredkin']) GATE_ARITY[k] = 3;

export const GATE_PARAM_COUNT: Record<string, number> = { u: 3 };
for (const k of Object.keys(PARAM_GATES)) if (!(k in GATE_PARAM_COUNT)) GATE_PARAM_COUNT[k] = 1;

export function resolve(name: string, params: number[] = []): Matrix {
  const key = name.toLowerCase();
  if (key in FIXED_GATES) {
    if (params.length) throw new Error(`gate '${name}' takes no parameters`);
    return FIXED_GATES[key];
  }
  if (key in PARAM_GATES) {
    const need = GATE_PARAM_COUNT[key];
    if (params.length !== need) throw new Error(`gate '${name}' needs ${need} parameter(s)`);
    return PARAM_GATES[key](...params);
  }
  throw new Error(`unknown gate '${name}'`);
}

export function isUnitary(m: Matrix, tol = 1e-9): boolean {
  const n = m.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < n; k++) {
        const p = cmul(conj(m[k][i]), m[k][j]);
        re += p.re;
        im += p.im;
      }
      if (Math.abs(re - (i === j ? 1 : 0)) > tol || Math.abs(im) > tol) return false;
    }
  }
  return true;
}
