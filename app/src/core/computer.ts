/** QubitComputer: executes circuits on the APQB state-vector backend. */
import { APQB } from './apqb';
import { Circuit } from './circuit';
import * as G from './gates';
import { Rng } from './rng';
import { APQBReadout, StateVector } from './state';

export interface Result {
  circuitName: string;
  numQubits: number;
  shots: number;
  counts: Record<string, number>;
  measuredQubits: number[];
  state: StateVector;
  apqb: APQBReadout[];
  elapsedMs: number;
  seed?: number;
  memory: string[];
}

export function mostCommon(res: Result): string | null {
  const entries = Object.entries(res.counts);
  if (!entries.length) return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

export function resultSummary(res: Result): string {
  const lines = [`== ${res.circuitName}: ${res.numQubits} qubits, ${res.shots} shots` + (res.seed !== undefined ? `, seed=${res.seed}` : '')];
  lines.push(`state : ${res.state.toString()}`);
  const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const width = Math.max(...Object.keys(res.counts).map((k) => k.length));
    for (const [k, v] of Object.entries(res.counts)) {
      lines.push(`  ${k.padEnd(width)}  ${String(v).padStart(6)}  ${((100 * v) / total).toFixed(1).padStart(5)}% ${'█'.repeat(Math.floor((40 * v) / total))}`);
    }
  }
  lines.push('APQB readout per qubit (r=<Z> confidence, T=|<X>| fluctuation):');
  for (const a of res.apqb) {
    lines.push(`  q${a.qubit}: r=${a.r >= 0 ? '+' : ''}${a.r.toFixed(4)} T=${a.T.toFixed(4)} theta=${a.theta.toFixed(4)} p1=${a.p1.toFixed(4)} S_vn=${a.vonNeumann.toFixed(4)}${a.vonNeumann > 1e-9 ? ' entangled' : ''}`);
  }
  return lines.join('\n');
}

export class QubitComputer {
  maxQubits: number;

  constructor(maxQubits = 20) {
    this.maxQubits = maxQubits;
  }

  initialState(circuit: Circuit): StateVector {
    return circuit.initialAPQBs ? StateVector.fromAPQBs(circuit.initialAPQBs) : new StateVector(circuit.numQubits);
  }

  statevector(circuit: Circuit, rng?: Rng, memory?: string[]): StateVector {
    if (circuit.numQubits > this.maxQubits) throw new Error(`circuit has ${circuit.numQubits} qubits > maxQubits=${this.maxQubits}`);
    const sv = this.initialState(circuit);
    for (const ins of circuit.instructions) {
      if (ins.name === 'barrier') continue;
      if (ins.name === 'measure') {
        const out = sv.measure(ins.targets, rng ?? new Rng(), true);
        memory?.push(out);
        continue;
      }
      sv.apply(G.resolve(ins.name, ins.params), ins.targets);
    }
    return sv;
  }

  run(circuit: Circuit, shots = 1024, seed?: number): Result {
    const t0 = Date.now();
    const rng = new Rng(seed);
    const measured = circuit.measuredQubits.length ? circuit.measuredQubits : [...Array(circuit.numQubits).keys()];
    let hasMid = false;
    let seen = false;
    for (const ins of circuit.instructions) {
      if (ins.name === 'measure') seen = true;
      else if (seen && ins.name !== 'barrier') {
        hasMid = true;
        break;
      }
    }
    let counts: Record<string, number> = {};
    const memory: string[] = [];
    let sv: StateVector;
    if (hasMid) {
      sv = this.initialState(circuit);
      for (let s = 0; s < shots; s++) {
        const shotMem: string[] = [];
        sv = this.statevector(circuit, rng, shotMem);
        const outcome = QubitComputer.combine(circuit, shotMem, measured);
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        memory.push(outcome);
      }
      counts = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
    } else {
      const unitary = new Circuit(circuit.numQubits, circuit.name);
      if (circuit.initialAPQBs) unitary.prepare(circuit.initialAPQBs);
      for (const ins of circuit.instructions) if (ins.name !== 'measure') unitary.append(ins.name, ins.targets, ins.params);
      sv = this.statevector(unitary);
      if (shots > 0) counts = sv.sample(shots, measured, rng);
    }
    return {
      circuitName: circuit.name, numQubits: circuit.numQubits, shots, counts, measuredQubits: measured,
      state: sv, apqb: sv.apqbReadouts(), elapsedMs: Date.now() - t0, seed, memory,
    };
  }

  private static combine(circuit: Circuit, shotMem: string[], measured: number[]): string {
    const latest: Record<number, string> = {};
    let k = 0;
    for (const ins of circuit.instructions) {
      if (ins.name === 'measure') {
        const out = shotMem[k++];
        ins.targets.forEach((q, i) => (latest[q] = out[i]));
      }
    }
    return measured.map((q) => latest[q] ?? '0').join('');
  }

  prepare(apqbs: APQB[]): StateVector {
    return StateVector.fromAPQBs(apqbs);
  }

  readout(circuit: Circuit): APQBReadout[] {
    return this.statevector(circuit).apqbReadouts();
  }
}
