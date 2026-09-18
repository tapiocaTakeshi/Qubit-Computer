/** QubitOS program table (/bin). */
import * as A from '../core/algorithms';
import { Circuit } from '../core/circuit';
import * as Q from '../core/qbnn';
import type { Kernel, Process } from './kernel';

export interface ParsedArgs {
  pos: string[];
  opts: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const pos: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2).replace(/-/g, '_');
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else pos.push(tok);
  }
  return { pos, opts };
}

export function num(s: string | true | undefined, fallback?: number): number {
  if (s === undefined || s === true) {
    if (fallback !== undefined) return fallback;
    throw new Error('missing numeric argument');
  }
  const t = s.trim();
  const v = t.endsWith('pi') ? parseFloat(t.slice(0, -2) || '1') * Math.PI : parseFloat(t);
  if (Number.isNaN(v)) throw new Error(`not a number: ${s}`);
  return v;
}

export interface ProgramParam {
  name: string;
  label: string;
  default: string;
  kind: 'number' | 'int' | 'string' | 'bits';
  flag?: string;
}

export interface Program {
  name: string;
  description: string;
  usage: string;
  params: ProgramParam[];
  circuit?: (argv: string[]) => Circuit;
  job?: (kernel: Kernel, proc: Process, argv: string[]) => unknown;
}

export const programKind = (p: Program): 'circuit' | 'job' => (p.circuit ? 'circuit' : 'job');

function qbnnTrain(kernel: Kernel, proc: Process, argv: string[]) {
  const a = parseArgs(argv);
  const task = a.pos[0] ?? 'xor';
  const K = Math.round(num(a.opts.K ?? a.opts.k, 2));
  const lam = num(a.opts.lam, 1);
  const epochs = Math.round(num(a.opts.epochs, 150));
  const lr = num(a.opts.lr, 0.2);
  const hidden = Math.round(num(a.opts.hidden, 4));
  const seed = Math.round(num(a.opts.seed, 1));
  let data: Q.Sample[];
  let nIn: number;
  if (task === 'xor') {
    data = Q.xorDataset();
    nIn = 2;
  } else if (task === 'parity') {
    nIn = Math.round(num(a.pos[1], 3));
    data = Q.parityDataset(nIn);
  } else throw new Error("task must be 'xor' or 'parity N'");
  const net = new Q.QBNN([nIn, hidden, 1], K, lam, 'tanh', 'identity', seed);
  proc.log(`QBNN dims=[${net.dims}] K=${K} lam=${lam} params=${net.numParameters()} task=${task}`);
  const history = Q.train(net, data, { epochs, lr, log: (l) => proc.log(l), logEvery: Math.max(1, Math.floor(epochs / 5)) });
  const acc = Q.accuracy(net, data);
  const path = typeof a.opts.save === 'string' ? a.opts.save : `/lib/qbnn/${task}${task === 'xor' ? '' : nIn}_K${K}.json`;
  kernel.fs.writeJSON(path, net.toJSON());
  proc.log(`saved weights to ${path}`);
  const etas = net.uncertainties();
  return { task, K, lam, final_loss: history[history.length - 1], accuracy: acc, epochs, weights: path, eta_hidden: etas[0], temperature_hidden: etas[0].map((e) => Q.controlSignal(e, 0.1, 1)) };
}

function qbnnEval(kernel: Kernel, proc: Process, argv: string[]) {
  const a = parseArgs(argv);
  if (!a.pos.length) throw new Error('usage: qbnn_eval <weights.json> x1 x2 ...');
  const net = Q.QBNN.fromJSON(kernel.fs.readJSON<Q.QBNNJSON>(a.pos[0]));
  const x = a.pos.slice(1).map((v) => num(v));
  const out = net.forward(x);
  proc.log(`QBNN([${x}]) = [${out.map((v) => v.toFixed(4))}]`);
  return { input: x, output: out, eta: net.uncertainties() };
}

function features(kernel: Kernel, proc: Process, argv: string[]) {
  const a = parseArgs(argv);
  const thetas = a.pos.map((v) => num(v));
  if (!thetas.length) throw new Error('usage: features theta1 theta2 ... [--K k]');
  const K = a.opts.K !== undefined ? Math.round(num(a.opts.K)) : undefined;
  const rs = thetas.map((t) => Math.cos(2 * t));
  const phi = Q.subsetFeatures(rs, K);
  const Phi = Q.complexSubsetFeatures(thetas, K);
  for (const [S, v] of phi) {
    const z = Phi.get(S)!;
    proc.log(`S={${S}}: phi_S=${v >= 0 ? '+' : ''}${v.toFixed(4)}  Phi_S=${z.re >= 0 ? '+' : ''}${z.re.toFixed(4)}${z.im >= 0 ? '+' : ''}${z.im.toFixed(4)}i`);
  }
  proc.log(`${phi.size} subset features (2^n = ${2 ** thetas.length} when K = n)`);
  return { r: rs, count: phi.size, phi: Object.fromEntries(phi) };
}

const theta = (a: ParsedArgs, i = 0, d = Math.PI / 4) => num(a.pos[i], d);

export const PROGRAMS: Record<string, Program> = {
  bell: { name: 'bell', description: 'Bell pair (H, CX)', usage: 'bell', params: [], circuit: () => A.bell() },
  bell_apqb: { name: 'bell_apqb', description: '|Ψ2(θ)> = cosθ|00> + sinθ|11>  (paper Eq. 12)', usage: 'bell_apqb <theta>', params: [{ name: 'theta', label: 'θ', default: '0.4', kind: 'number' }], circuit: (argv) => A.bellAPQB(theta(parseArgs(argv))) },
  ghz: { name: 'ghz', description: 'GHZ state on n qubits', usage: 'ghz [n]', params: [{ name: 'n', label: 'n', default: '3', kind: 'int' }], circuit: (argv) => A.ghz(Math.round(num(parseArgs(argv).pos[0], 3))) },
  ghz_apqb: { name: 'ghz_apqb', description: '|Ψ3(θ)> = cosθ|000> + sinθ|111>  (paper Eq. 15)', usage: 'ghz_apqb <theta> [n]', params: [{ name: 'theta', label: 'θ', default: '0.4', kind: 'number' }, { name: 'n', label: 'n', default: '3', kind: 'int' }], circuit: (argv) => { const a = parseArgs(argv); return A.ghzAPQB(theta(a), Math.round(num(a.pos[1], 3))); } },
  encode: { name: 'encode', description: 'APQB register from correlation coefficients r_i (Eq. 18)', usage: 'encode r1 r2 ...', params: [{ name: 'rs', label: 'r₁ r₂ …', default: '0.9 0.0 -0.6', kind: 'string' }], circuit: (argv) => { const rs = parseArgs(argv).pos.map((v) => num(v)); return A.correlationRegister(rs.length ? rs : [0.9, 0, -0.6]); } },
  teleport: { name: 'teleport', description: 'Teleport an APQB |ψ(θ)> from q0 to q2', usage: 'teleport <theta>', params: [{ name: 'theta', label: 'θ', default: '0.7', kind: 'number' }], circuit: (argv) => A.teleportation(theta(parseArgs(argv), 0, 0.3)) },
  superdense: { name: 'superdense', description: 'Superdense coding of two classical bits', usage: 'superdense <2 bits>', params: [{ name: 'bits', label: 'bits', default: '10', kind: 'bits' }], circuit: (argv) => A.superdenseCoding(parseArgs(argv).pos[0] ?? '10') },
  deutsch_jozsa: { name: 'deutsch_jozsa', description: 'Deutsch-Jozsa (constant0|constant1|balanced)', usage: 'deutsch_jozsa [n] [oracle]', params: [{ name: 'n', label: 'n', default: '3', kind: 'int' }, { name: 'oracle', label: 'oracle', default: 'balanced', kind: 'string' }], circuit: (argv) => { const a = parseArgs(argv); return A.deutschJozsa(Math.round(num(a.pos[0], 3)), (a.pos[1] as 'balanced') ?? 'balanced'); } },
  grover: { name: 'grover', description: 'Grover search for a bitstring', usage: 'grover <bits> [--iterations k]', params: [{ name: 'bits', label: 'marked', default: '101', kind: 'bits' }], circuit: (argv) => { const a = parseArgs(argv); const m = a.pos[0] ?? '101'; return A.grover(m.length, m, a.opts.iterations !== undefined ? Math.round(num(a.opts.iterations)) : undefined); } },
  qft: { name: 'qft', description: 'Quantum Fourier transform', usage: 'qft [n] [--input bits]', params: [{ name: 'n', label: 'n', default: '3', kind: 'int' }, { name: 'input', label: 'input bits', default: '', kind: 'bits', flag: '--input' }], circuit: (argv) => { const a = parseArgs(argv); const n = Math.round(num(a.pos[0], 3)); let c = A.qft(n); if (typeof a.opts.input === 'string' && a.opts.input) { const pre = new Circuit(n, `qft${n}`); [...a.opts.input].forEach((b, q) => { if (b === '1') pre.x(q); }); c = pre.compose(c); } return c; } },
  qbnn_train: { name: 'qbnn_train', description: 'Train a QBNN (Eq. 23-30) on xor / parity', usage: 'qbnn_train xor|parity [n] [--K 2 --lam 1 --epochs 150 --lr 0.2 --hidden 4 --seed 1]', params: [{ name: 'task', label: 'task', default: 'xor', kind: 'string' }, { name: 'K', label: 'K', default: '2', kind: 'int', flag: '--K' }, { name: 'epochs', label: 'epochs', default: '80', kind: 'int', flag: '--epochs' }], job: qbnnTrain },
  qbnn_eval: { name: 'qbnn_eval', description: 'Evaluate saved QBNN weights', usage: 'qbnn_eval <weights.json> x1 x2 ...', params: [{ name: 'args', label: 'weights x₁ x₂', default: '/lib/qbnn/xor_K2.json 1 -1', kind: 'string' }], job: qbnnEval },
  features: { name: 'features', description: 'Subset-product APQB features φ_S / Φ_S (Eq. 19, 22)', usage: 'features theta1 theta2 ... [--K k]', params: [{ name: 'thetas', label: 'θ₁ θ₂ …', default: '0.2 0.5 0.9', kind: 'string' }], job: features },
};
