/** Reference circuits and APQB-native routines. */
import { Circuit } from './circuit';

export const bell = (): Circuit => new Circuit(2, 'bell').h(0).cx(0, 1);

/** |Psi2(theta)> = cos(theta)|00> + sin(theta)|11> (paper Eq. 12). */
export const bellAPQB = (theta: number): Circuit => new Circuit(2, `bell_apqb(θ=${theta.toFixed(3)})`).apqb(0, theta).cx(0, 1);

export function ghz(n = 3): Circuit {
  const c = new Circuit(n, `ghz${n}`).h(0);
  for (let q = 1; q < n; q++) c.cx(q - 1, q);
  return c;
}

/** |Psi_n(theta)> = cos(theta)|0..0> + sin(theta)|1..1> (paper Eq. 15). */
export function ghzAPQB(theta: number, n = 3): Circuit {
  const c = new Circuit(n, `ghz_apqb(θ=${theta.toFixed(3)})`).apqb(0, theta);
  for (let q = 1; q < n; q++) c.cx(q - 1, q);
  return c;
}

/** Encode correlation coefficients r_i into an APQB register (Eq. 18). */
export function correlationRegister(rs: number[]): Circuit {
  const c = new Circuit(rs.length, 'correlation_register');
  rs.forEach((r, q) => c.apqbR(q, r));
  return c;
}

/** Teleport |psi(theta)> from q0 to q2 (deferred-measurement form). */
export function teleportation(theta = 0.3): Circuit {
  return new Circuit(3, `teleport(θ=${theta.toFixed(3)})`).apqb(0, theta).h(1).cx(1, 2).cx(0, 1).h(0).cx(1, 2).cz(0, 2);
}

export function superdenseCoding(bits = '10'): Circuit {
  const c = new Circuit(2, `superdense(${bits})`).h(0).cx(0, 1);
  if (bits[1] === '1') c.x(0);
  if (bits[0] === '1') c.z(0);
  return c.cx(0, 1).h(0);
}

export function deutschJozsa(n: number, oracle: 'constant0' | 'constant1' | 'balanced' = 'balanced'): Circuit {
  const c = new Circuit(n + 1, `deutsch_jozsa(${oracle})`);
  const anc = n;
  c.x(anc);
  for (let q = 0; q <= n; q++) c.h(q);
  if (oracle === 'constant1') c.x(anc);
  else if (oracle === 'balanced') for (let q = 0; q < n; q++) c.cx(q, anc);
  else if (oracle !== 'constant0') throw new Error('oracle must be constant0, constant1 or balanced');
  for (let q = 0; q < n; q++) c.h(q);
  return c.measure(...[...Array(n).keys()]);
}

function mcz(c: Circuit, qubits: number[]): void {
  const k = qubits.length;
  if (k === 1) c.z(qubits[0]);
  else if (k === 2) c.cz(qubits[0], qubits[1]);
  else if (k === 3) c.h(qubits[2]).ccx(qubits[0], qubits[1], qubits[2]).h(qubits[2]);
  else mczRec(c, qubits.slice(0, -1), qubits[qubits.length - 1], Math.PI);
}

function mczRec(c: Circuit, controls: number[], target: number, angle: number): void {
  if (controls.length === 1) {
    c.cp(controls[0], target, angle);
    return;
  }
  const last = controls[controls.length - 1];
  const rest = controls.slice(0, -1);
  c.cp(last, target, angle / 2);
  mcxRec(c, rest, last);
  c.cp(last, target, -angle / 2);
  mcxRec(c, rest, last);
  mczRec(c, rest, target, angle / 2);
}

function mcxRec(c: Circuit, controls: number[], target: number): void {
  if (controls.length === 1) c.cx(controls[0], target);
  else if (controls.length === 2) c.ccx(controls[0], controls[1], target);
  else {
    c.h(target);
    mczRec(c, controls, target, Math.PI);
    c.h(target);
  }
}

/** Grover search for `marked` (qubit 0 = leftmost char). */
export function grover(n: number, marked: string, iterations?: number): Circuit {
  if (marked.length !== n) throw new Error('marked bitstring length must equal n');
  const its = iterations ?? Math.max(1, Math.floor((Math.PI / 4) * Math.sqrt(2 ** n)));
  const c = new Circuit(n, `grover(${marked})`);
  const all = [...Array(n).keys()];
  for (const q of all) c.h(q);
  for (let i = 0; i < its; i++) {
    all.forEach((q) => { if (marked[q] === '0') c.x(q); });
    mcz(c, all);
    all.forEach((q) => { if (marked[q] === '0') c.x(q); });
    for (const q of all) c.h(q).x(q);
    mcz(c, all);
    for (const q of all) c.x(q).h(q);
  }
  return c.measure();
}

export function qft(n: number, swap = true): Circuit {
  const c = new Circuit(n, `qft${n}`);
  for (let j = 0; j < n; j++) {
    c.h(j);
    for (let k = j + 1; k < n; k++) c.cp(k, j, Math.PI / 2 ** (k - j));
  }
  if (swap) for (let j = 0; j < Math.floor(n / 2); j++) c.swap(j, n - 1 - j);
  return c;
}

export function inverseQft(n: number, swap = true): Circuit {
  const inv = qft(n, swap).inverse();
  inv.name = `iqft${n}`;
  return inv;
}
