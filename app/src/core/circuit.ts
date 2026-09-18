/** Circuit builder: an ordered list of instructions, serializable to JSON. */
import { APQB } from './apqb';
import * as G from './gates';

export interface Instruction {
  name: string;
  targets: number[];
  params: number[];
}

export interface CircuitJSON {
  name: string;
  num_qubits: number;
  instructions: Array<{ gate: string; targets: number[]; params?: number[] }>;
  initial_thetas?: number[];
  initial_correlations?: number[];
}

const CTRL_NAMES = new Set(['cx', 'cnot', 'cy', 'cz', 'ch', 'crx', 'cry', 'crz', 'cp', 'capqb', 'ccx', 'toffoli', 'cswap', 'fredkin']);

export class Circuit {
  readonly numQubits: number;
  name: string;
  instructions: Instruction[] = [];
  initialAPQBs: APQB[] | null = null;

  constructor(numQubits: number, name = 'circuit') {
    if (numQubits < 1) throw new Error('a circuit needs at least one qubit');
    this.numQubits = numQubits;
    this.name = name;
  }

  append(name: string, targets: number[], params: number[] = []): this {
    const key = name.toLowerCase();
    for (const t of targets) if (t < 0 || t >= this.numQubits) throw new Error(`qubit ${t} out of range (circuit has ${this.numQubits})`);
    if (key !== 'measure' && key !== 'barrier') {
      if (!(key in G.GATE_ARITY)) throw new Error(`unknown gate '${name}'`);
      if (G.GATE_ARITY[key] !== targets.length) throw new Error(`gate '${name}' acts on ${G.GATE_ARITY[key]} qubit(s), got ${targets.length}`);
      if (new Set(targets).size !== targets.length) throw new Error('targets must be distinct');
      G.resolve(key, params);
    }
    this.instructions.push({ name: key, targets: [...targets], params: [...params] });
    return this;
  }

  get length(): number {
    return this.instructions.length;
  }

  prepare(apqbs: APQB[]): this {
    if (apqbs.length !== this.numQubits) throw new Error('need one APQB per qubit');
    this.initialAPQBs = [...apqbs];
    return this;
  }

  prepareFromCorrelations(rs: number[]): this {
    return this.prepare(rs.map((r) => APQB.fromR(r)));
  }

  apqb(q: number, theta: number): this { return this.append('apqb', [q], [theta]); }
  apqbR(q: number, r: number): this { return this.append('apqb_r', [q], [r]); }
  apqbA(q: number, a: number): this { return this.append('apqb_a', [q], [a]); }
  capqb(c: number, t: number, theta: number): this { return this.append('capqb', [c, t], [theta]); }
  i(q: number): this { return this.append('i', [q]); }
  x(q: number): this { return this.append('x', [q]); }
  y(q: number): this { return this.append('y', [q]); }
  z(q: number): this { return this.append('z', [q]); }
  h(q: number): this { return this.append('h', [q]); }
  s(q: number): this { return this.append('s', [q]); }
  sdg(q: number): this { return this.append('sdg', [q]); }
  t(q: number): this { return this.append('t', [q]); }
  tdg(q: number): this { return this.append('tdg', [q]); }
  sx(q: number): this { return this.append('sx', [q]); }
  rx(q: number, a: number): this { return this.append('rx', [q], [a]); }
  ry(q: number, a: number): this { return this.append('ry', [q], [a]); }
  rz(q: number, a: number): this { return this.append('rz', [q], [a]); }
  p(q: number, a: number): this { return this.append('p', [q], [a]); }
  u(q: number, a: number, b: number, c: number): this { return this.append('u', [q], [a, b, c]); }
  cx(c: number, t: number): this { return this.append('cx', [c, t]); }
  cy(c: number, t: number): this { return this.append('cy', [c, t]); }
  cz(c: number, t: number): this { return this.append('cz', [c, t]); }
  ch(c: number, t: number): this { return this.append('ch', [c, t]); }
  swap(a: number, b: number): this { return this.append('swap', [a, b]); }
  iswap(a: number, b: number): this { return this.append('iswap', [a, b]); }
  crx(c: number, t: number, a: number): this { return this.append('crx', [c, t], [a]); }
  cry(c: number, t: number, a: number): this { return this.append('cry', [c, t], [a]); }
  crz(c: number, t: number, a: number): this { return this.append('crz', [c, t], [a]); }
  cp(c: number, t: number, a: number): this { return this.append('cp', [c, t], [a]); }
  rxx(a: number, b: number, t: number): this { return this.append('rxx', [a, b], [t]); }
  rzz(a: number, b: number, t: number): this { return this.append('rzz', [a, b], [t]); }
  ccx(a: number, b: number, t: number): this { return this.append('ccx', [a, b, t]); }
  cswap(c: number, a: number, b: number): this { return this.append('cswap', [c, a, b]); }

  measure(...qubits: number[]): this {
    const qs = qubits.length ? qubits : [...Array(this.numQubits).keys()];
    return this.append('measure', qs);
  }

  barrier(): this {
    return this.append('barrier', []);
  }

  compose(other: Circuit, qubits?: number[]): this {
    const map = qubits ?? [...Array(other.numQubits).keys()];
    if (map.length !== other.numQubits) throw new Error('qubit map must cover every qubit of the sub-circuit');
    for (const ins of other.instructions) this.append(ins.name, ins.targets.map((t) => map[t]), ins.params);
    return this;
  }

  inverse(): Circuit {
    const inv = new Circuit(this.numQubits, `${this.name}_dg`);
    const adj: Record<string, string> = { s: 'sdg', sdg: 's', t: 'tdg', tdg: 't' };
    for (const ins of [...this.instructions].reverse()) {
      if (ins.name === 'measure' || ins.name === 'barrier') continue;
      if (ins.name in adj) inv.append(adj[ins.name], ins.targets);
      else if (ins.name === 'sx' || ins.name === 'iswap') for (let k = 0; k < 3; k++) inv.append(ins.name, ins.targets);
      else if (ins.params.length) {
        const p = ins.name === 'u' ? [-ins.params[0], -ins.params[2], -ins.params[1]] : ins.params.map((v) => -v);
        inv.append(ins.name, ins.targets, p);
      } else inv.append(ins.name, ins.targets);
    }
    return inv;
  }

  get measuredQubits(): number[] {
    const out: number[] = [];
    for (const ins of this.instructions) if (ins.name === 'measure') for (const t of ins.targets) if (!out.includes(t)) out.push(t);
    return out;
  }

  get depth(): number {
    const layer = new Array(this.numQubits).fill(0);
    let d = 0;
    for (const ins of this.instructions) {
      if (ins.name === 'barrier') continue;
      const level = Math.max(0, ...ins.targets.map((t) => layer[t])) + 1;
      for (const t of ins.targets) layer[t] = level;
      d = Math.max(d, level);
    }
    return d;
  }

  toJSON(): CircuitJSON {
    const d: CircuitJSON = {
      name: this.name,
      num_qubits: this.numQubits,
      instructions: this.instructions.map((ins) => (ins.params.length ? { gate: ins.name, targets: ins.targets, params: ins.params } : { gate: ins.name, targets: ins.targets })),
    };
    if (this.initialAPQBs) d.initial_thetas = this.initialAPQBs.map((q) => q.theta);
    return d;
  }

  toJSONString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  static fromJSON(d: CircuitJSON): Circuit {
    const c = new Circuit(Number(d.num_qubits), d.name ?? 'circuit');
    if (d.initial_thetas) c.prepare(d.initial_thetas.map((t) => new APQB(Number(t))));
    else if (d.initial_correlations) c.prepareFromCorrelations(d.initial_correlations.map(Number));
    for (const raw of d.instructions ?? []) {
      const r = raw as { gate?: string; name?: string; targets?: number[] | number; qubits?: number[]; params?: number[] };
      const name = r.gate ?? r.name;
      if (!name) throw new Error("instruction needs a 'gate' field");
      const t = r.targets ?? r.qubits ?? [];
      c.append(name, (Array.isArray(t) ? t : [t]).map(Number), (r.params ?? []).map(Number));
    }
    return c;
  }

  static fromJSONString(text: string): Circuit {
    return Circuit.fromJSON(JSON.parse(text) as CircuitJSON);
  }

  /** ASCII diagram (qubit 0 on top). */
  draw(): string {
    const center = (s: string, w: number) => {
      const pad = Math.max(0, w - s.length);
      const left = Math.floor(pad / 2);
      return '─'.repeat(left) + s + '─'.repeat(pad - left);
    };
    const cols: string[][] = [];
    for (const ins of this.instructions) {
      let col: string[] = new Array(this.numQubits).fill('─'.repeat(7));
      if (ins.name === 'barrier') col = new Array(this.numQubits).fill('──░────');
      else if (ins.name === 'measure') for (const t of ins.targets) col[t] = '──[M]──';
      else {
        let label = ins.name.toUpperCase();
        if (ins.params.length) label += '(' + ins.params.map((p) => p.toFixed(2)).join(',') + ')';
        const width = Math.max(label.length + 2, 7);
        col = new Array(this.numQubits).fill('─'.repeat(width));
        if (CTRL_NAMES.has(ins.name)) {
          const nCtrl = ins.name === 'ccx' || ins.name === 'toffoli' ? 2 : 1;
          let body = label.slice(1);
          if (['cnot', 'ccx', 'toffoli'].includes(ins.name)) body = 'X';
          if (['cswap', 'fredkin'].includes(ins.name)) body = 'SWAP';
          const lo = Math.min(...ins.targets);
          const hi = Math.max(...ins.targets);
          for (let q = lo; q <= hi; q++) col[q] = '───┼' + '─'.repeat(width - 4);
          for (const c of ins.targets.slice(0, nCtrl)) col[c] = '───●' + '─'.repeat(width - 4);
          for (const t of ins.targets.slice(nCtrl)) col[t] = center('[' + body + ']', width);
        } else if (['swap', 'iswap', 'rxx', 'rzz'].includes(ins.name)) {
          const lo = Math.min(...ins.targets);
          const hi = Math.max(...ins.targets);
          for (let q = lo; q <= hi; q++) col[q] = '───┼' + '─'.repeat(width - 4);
          for (const t of ins.targets) col[t] = center('[' + label + ']', width);
        } else for (const t of ins.targets) col[t] = center('[' + label + ']', width);
      }
      cols.push(col);
    }
    const lines: string[] = [];
    for (let q = 0; q < this.numQubits; q++) {
      const init = this.initialAPQBs ? `|APQB θ=${this.initialAPQBs[q].theta.toFixed(2)}>` : '|0>';
      lines.push(`q${q}: ${init.padStart(14)} ` + cols.map((c) => c[q]).join(''));
    }
    return lines.join('\n');
  }
}
