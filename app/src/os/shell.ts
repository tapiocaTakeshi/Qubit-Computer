/** qsh -- the QubitOS shell. Every command maps onto kernel syscalls. */
import { APQB } from '../core/apqb';
import { Circuit, CircuitJSON } from '../core/circuit';
import { Result, resultSummary } from '../core/computer';
import { APQBReadout } from '../core/state';
import { FSError } from './fs';
import { isResult, Kernel, KernelError, Process } from './kernel';
import { num, parseArgs, ParsedArgs } from './programs';

export type Out = (line: string) => void;

/** POSIX-ish tokenizer with single/double quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quote) throw new Error('unterminated quote');
  if (cur || has) out.push(cur);
  return out;
}

export function splitCommands(line: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ';') {
      parts.push(buf);
      buf = '';
    } else buf += ch;
  }
  parts.push(buf);
  return parts.filter((p) => p.trim());
}

export const HELP_GROUPS: Array<[string, string]> = [
  ['system', 'help uname uptime dmesg sysctl [key [value]] motd echo clear'],
  ['processes', 'run <prog> [args] [--shots N --seed S --prio P] | spawn <prog> [args] | sched | ps | kill <pid> | log <pid> | result <pid|last> | draw <prog> [args]'],
  ['memory', 'alloc <n> [--name x --theta t1,t2,.. | --r r1,r2,..] | free <sid> | mem | reset <sid>'],
  ['registers', 'gate <sid> <gate> <q..> [--p a,b] | measure <sid> [q..] [--shots N] | readout <sid> | state <sid> | ent <sid|last|pid>'],
  ['apqb', 'apqb <theta> | apqb --r <r> | apqb --a <latent> | apqb --p1 <prob>  [--K k]'],
  ['files', 'ls cat cd pwd mkdir rm write <path> <text> tree save <pid|last> <path> exec <circuit.json> sh <script.qsh>'],
];

export class Shell {
  k: Kernel;
  out: Out;
  lastStatus = 0;
  onClear: (() => void) | null = null;
  commands: Record<string, (args: string[]) => void>;

  constructor(kernel: Kernel, out: Out) {
    this.k = kernel;
    this.out = out;
    this.commands = {
      help: (a) => this.cmdHelp(a), '?': (a) => this.cmdHelp(a), uname: () => this.cmdUname(), uptime: () => this.cmdUptime(),
      dmesg: (a) => this.cmdDmesg(a), sysctl: (a) => this.cmdSysctl(a), echo: (a) => this.out(a.join(' ')), motd: () => this.cmdMotd(),
      clear: () => this.onClear?.(),
      run: (a) => this.cmdRun(a), spawn: (a) => this.cmdSpawn(a), sched: (a) => this.cmdSched(a), ps: () => this.cmdPs(),
      kill: (a) => this.cmdKill(a), log: (a) => this.cmdLog(a), result: (a) => this.cmdResult(a), draw: (a) => this.cmdDraw(a),
      alloc: (a) => this.cmdAlloc(a), free: (a) => this.cmdFree(a), mem: () => this.cmdMem(), regs: () => this.cmdMem(),
      gate: (a) => this.cmdGate(a), measure: (a) => this.cmdMeasure(a), readout: (a) => this.cmdReadout(a),
      state: (a) => this.cmdState(a), reset: (a) => this.cmdReset(a), ent: (a) => this.cmdEnt(a),
      apqb: (a) => this.cmdApqb(a), exec: (a) => this.cmdExec(a),
      ls: (a) => this.cmdLs(a), cat: (a) => this.cmdCat(a), cd: (a) => this.k.fs.cd(a[0] ?? '/home/user'), pwd: () => this.out(this.k.fs.cwd),
      mkdir: (a) => a.forEach((p) => this.k.fs.mkdir(p)), rm: (a) => this.cmdRm(a), write: (a) => this.cmdWrite(a), tree: (a) => this.cmdTree(a),
      save: (a) => this.cmdSave(a), sh: (a) => this.cmdSh(a),
    };
  }

  prompt(): string {
    return `qubitos:${this.k.fs.cwd}$ `;
  }

  executeLine(line: string): number {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return 0;
    for (const part of splitCommands(trimmed)) {
      let argv: string[];
      try {
        argv = tokenize(part);
      } catch (e) {
        this.out(`qsh: parse error: ${(e as Error).message}`);
        this.lastStatus = 2;
        continue;
      }
      if (!argv.length) continue;
      let [name, ...args] = argv;
      let fn = this.commands[name];
      if (!fn && name in this.k.programs) {
        fn = this.commands.run;
        args = [name, ...args];
      }
      if (!fn) {
        this.out(`qsh: command not found: ${name} (try 'help')`);
        this.lastStatus = 127;
        continue;
      }
      try {
        fn(args);
        this.lastStatus = 0;
      } catch (e) {
        if (e instanceof KernelError || e instanceof FSError || e instanceof Error) {
          this.out(`qsh: ${name}: ${e.message}`);
          this.lastStatus = 1;
        } else throw e;
      }
    }
    this.k.notify();
    return this.lastStatus;
  }

  runScript(text: string): number {
    let status = 0;
    for (const line of text.split('\n')) status = this.executeLine(line);
    return status;
  }

  // ---------------------------------------------------------- helpers
  private resultOf(token: string): Result {
    if (token === 'last' || token === '-') {
      if (!this.k.lastResult) throw new KernelError('no result yet');
      return this.k.lastResult;
    }
    const proc = this.k.process(Number(token));
    if (!isResult(proc.result)) throw new KernelError(`pid ${token} has no circuit result`);
    return proc.result;
  }

  private printReadouts(readouts: APQBReadout[]): void {
    this.out('  qubit    r=<Z>      T=|<X>|    theta      p1       S_vn');
    for (const ro of readouts) {
      this.out(`  q${String(ro.qubit).padEnd(5)} ${ro.r >= 0 ? '+' : ''}${ro.r.toFixed(4)}   ${ro.T.toFixed(4)}    ${ro.theta.toFixed(4)}   ${ro.p1.toFixed(4)}   ${ro.vonNeumann.toFixed(4)}${ro.vonNeumann > 1e-9 ? '  entangled' : ''}`);
    }
  }

  private showProcess(proc: Process, brief = false): void {
    for (const l of proc.logs) this.out(l);
    if (proc.state === 'failed') {
      this.out(`pid ${proc.pid} failed: ${proc.error}`);
      return;
    }
    if (isResult(proc.result)) this.out(resultSummary(proc.result));
    else if (proc.result !== null && !brief) this.out(JSON.stringify(proc.result, null, 2));
  }

  private runOpts(args: string[]): { argv: string[]; shots?: number; seed?: number; prio: number } {
    const parsed = parseArgs(args);
    const o = parsed.opts;
    const shots = o.shots !== undefined ? Math.round(num(o.shots)) : undefined;
    const seed = o.seed !== undefined ? Math.round(num(o.seed)) : undefined;
    const prio = o.prio !== undefined ? Math.round(num(o.prio)) : 5;
    const argv = [...parsed.pos];
    for (const [k, v] of Object.entries(o)) {
      if (k === 'shots' || k === 'seed' || k === 'prio') continue;
      argv.push('--' + k);
      if (v !== true) argv.push(v);
    }
    return { argv, shots, seed, prio };
  }

  private apqbsFromOpts(opts: ParsedArgs['opts'], n: number): APQB[] | undefined {
    let apqbs: APQB[];
    if (typeof opts.theta === 'string') apqbs = opts.theta.split(',').map((v) => new APQB(num(v)));
    else if (typeof opts.r === 'string') apqbs = opts.r.split(',').map((v) => APQB.fromR(num(v)));
    else if (typeof opts.a === 'string') apqbs = opts.a.split(',').map((v) => APQB.fromLatent(num(v)));
    else return undefined;
    if (apqbs.length !== n) throw new Error(`expected ${n} initial values, got ${apqbs.length}`);
    return apqbs;
  }

  // ----------------------------------------------------------- system
  private cmdHelp(_a: string[]): void {
    this.out('QubitOS shell (qsh) commands:');
    for (const [g, t] of HELP_GROUPS) this.out(`  ${g.padEnd(10)} ${t}`);
    this.out('programs in /bin: ' + Object.keys(this.k.programs).sort().join(', '));
    this.out("angles accept 'pi' suffix (0.25pi). Bitstrings print qubit 0 on the left.");
  }

  private cmdUname(): void {
    const u = this.k.sysUname();
    this.out(`${u.os} ${u.version} apqb-statevector ${u.numQubits}q`);
  }

  private cmdUptime(): void {
    const u = this.k.sysUname();
    const m = this.k.sysMem();
    this.out(`up ${(u.uptimeMs / 1000).toFixed(1)}s, ${this.k.processes.size} processes, ${m.used}/${m.total} qubits allocated, sched eps=${this.k.explorationRate().toFixed(3)}`);
  }

  private cmdDmesg(a: string[]): void {
    for (const l of this.k.sysDmesg(a[0] ? Math.round(num(a[0])) : 50)) this.out(l);
  }

  private cmdSysctl(a: string[]): void {
    if (!a.length) {
      for (const [k, v] of Object.entries(this.k.sysSysctl() as Record<string, unknown>)) this.out(`${k} = ${v}`);
      const q = this.k.systemAPQB();
      this.out(`system APQB: r=${q.r >= 0 ? '+' : ''}${q.r.toFixed(4)} eta=${q.T.toFixed(4)} -> exploration eps=${this.k.explorationRate().toFixed(4)}`);
      return;
    }
    let [key, val] = a;
    if (key.includes('=') && a.length === 1) [key, val] = key.split('=', 2) as [string, string];
    this.out(`${key} = ${this.k.sysSysctl(key, val)}`);
  }

  private cmdMotd(): void {
    try {
      this.out(this.k.fs.read('/etc/motd').trimEnd());
    } catch {
      /* no motd */
    }
  }

  // -------------------------------------------------------- processes
  private cmdRun(a: string[]): void {
    if (!a.length) throw new Error('usage: run <program> [args] [--shots N --seed S]');
    const { argv, shots, seed, prio } = this.runOpts(a.slice(1));
    this.showProcess(this.k.sysRun(a[0], argv, shots, seed, prio));
  }

  private cmdSpawn(a: string[]): void {
    if (!a.length) throw new Error('usage: spawn <program> [args] [--prio P]');
    const { argv, shots, seed, prio } = this.runOpts(a.slice(1));
    const p = this.k.sysSpawn(a[0], argv, prio, shots, seed);
    this.out(`[${p.pid}] ${p.name} ready (prio ${prio})`);
  }

  private cmdSched(a: string[]): void {
    const done = this.k.sysSchedule(a[0] ? Math.round(num(a[0])) : undefined);
    if (!done.length) this.out('scheduler: nothing to run');
    for (const p of done) {
      this.out(`--- pid ${p.pid} (${p.name}) -> ${p.state}`);
      this.showProcess(p, true);
    }
  }

  private cmdPs(): void {
    this.out(' PID  STATE    PRI   ELAPSED  COMMAND');
    for (const p of this.k.sysPs()) this.out(p.row());
  }

  private cmdKill(a: string[]): void {
    const p = this.k.sysKill(Math.round(num(a[0])));
    this.out(`pid ${p.pid} -> ${p.state}`);
  }

  private cmdLog(a: string[]): void {
    const p = this.k.process(Math.round(num(a[0])));
    for (const l of p.logs) this.out(l);
    if (p.error) this.out(`error: ${p.error}`);
  }

  private cmdResult(a: string[]): void {
    this.out(resultSummary(this.resultOf(a[0] ?? 'last')));
  }

  private cmdDraw(a: string[]): void {
    if (!a.length) throw new Error('usage: draw <program> [args]');
    const prog = this.k.programs[a[0]];
    if (!prog?.circuit) throw new KernelError(`'${a[0]}' is not a circuit program`);
    const c = prog.circuit(a.slice(1));
    this.out(`${c.name}: ${c.numQubits} qubits, ${c.length} instructions, depth ${c.depth}`);
    this.out(c.draw());
  }

  // ----------------------------------------------------------- memory
  private cmdAlloc(a: string[]): void {
    const parsed = parseArgs(a);
    if (!parsed.pos.length) throw new Error('usage: alloc <n> [--name x] [--theta t1,t2 | --r r1,r2 | --a a1,a2]');
    const n = Math.round(num(parsed.pos[0]));
    const seg = this.k.sysAlloc(n, typeof parsed.opts.name === 'string' ? parsed.opts.name : '', this.apqbsFromOpts(parsed.opts, n));
    this.out(`segment ${seg.sid} '${seg.name}': physical qubits [${seg.qubits}]`);
    this.out(`state: ${seg.state}`);
  }

  private cmdFree(a: string[]): void {
    this.k.sysFree(Math.round(num(a[0])));
    this.out(`segment ${a[0]} freed`);
  }

  private cmdMem(): void {
    const m = this.k.sysMem();
    this.out(`qubits: total ${m.total}  used ${m.used}  free ${m.free}`);
    for (const s of m.segments) this.out(`  sid ${String(s.sid).padEnd(3)} ${s.name.padEnd(12)} qubits=[${s.qubits}] ops=${s.ops}`);
  }

  private cmdReset(a: string[]): void {
    const parsed = parseArgs(a);
    const sid = Math.round(num(parsed.pos[0]));
    const seg = this.k.segment(sid);
    this.k.sysReset(sid, this.apqbsFromOpts(parsed.opts, seg.qubits.length));
    this.out(`state: ${seg.state}`);
  }

  // -------------------------------------------------------- registers
  private cmdGate(a: string[]): void {
    const parsed = parseArgs(a);
    if (parsed.pos.length < 3) throw new Error('usage: gate <sid> <gate> <q...> [--p a,b]');
    const [sid, gate, ...rest] = parsed.pos;
    const params = typeof parsed.opts.p === 'string' ? parsed.opts.p.split(',').map((v) => num(v)) : [];
    const seg = this.k.sysApply(Math.round(num(sid)), gate, rest.map((q) => Math.round(num(q))), params);
    this.out(`state: ${seg.state}`);
  }

  private cmdMeasure(a: string[]): void {
    const parsed = parseArgs(a);
    const sid = Math.round(num(parsed.pos[0]));
    const qs = parsed.pos.slice(1).map((q) => Math.round(num(q)));
    const shots = parsed.opts.shots !== undefined ? Math.round(num(parsed.opts.shots)) : 1;
    const res = this.k.sysMeasure(sid, qs, shots);
    if (res.outcome !== undefined) {
      this.out(`outcome ${res.outcome} on qubits [${res.qubits}] (register collapsed)`);
      this.out(`state: ${this.k.segment(sid).state}`);
    } else if (res.counts) {
      for (const [k, v] of Object.entries(res.counts)) this.out(`  ${k}  ${String(v).padStart(6)}  ${((100 * v) / res.shots).toFixed(1).padStart(5)}% ${'█'.repeat(Math.floor((40 * v) / res.shots))}`);
    }
  }

  private cmdReadout(a: string[]): void {
    this.printReadouts(this.k.sysReadout(Math.round(num(a[0]))));
  }

  private cmdState(a: string[]): void {
    const seg = this.k.segment(Math.round(num(a[0])));
    this.out(`segment ${seg.sid} '${seg.name}': ${seg.state}`);
    seg.state.probabilities().forEach((p, i) => {
      if (p > 1e-12) this.out(`  |${seg.state.indexToBits(i)}>  p=${p.toFixed(4)}`);
    });
  }

  private cmdEnt(a: string[]): void {
    const token = a[0] ?? 'last';
    let info;
    if (/^\d+$/.test(token) && this.k.segments.has(Number(token))) info = this.k.sysEntanglement(Number(token));
    else info = Kernel.entanglementOf(this.resultOf(token).state);
    this.out(`  num_qubits: ${info.numQubits}`);
    this.out(`  von_neumann: ${info.vonNeumann.map((v) => v.toFixed(4)).join(', ')}`);
    this.out(`  r: ${info.r.map((v) => (v >= 0 ? '+' : '') + v.toFixed(4)).join(', ')}`);
    if (info.concurrence !== undefined) {
      this.out(`  concurrence: ${info.concurrence.toFixed(6)}`);
      this.out(`  C2^2 + r^2: ${info.c2Check!.toFixed(6)}`);
      this.out(`  (paper Eq. 13-14: C2 = η and C2² + r² = 1 hold for the |Ψ2(θ)> family -- ${Math.abs(info.c2Check! - 1) < 1e-9 ? 'satisfied' : 'this state is outside that family'})`);
    }
    if (info.threeTangle !== undefined) {
      this.out(`  three_tangle: ${info.threeTangle.toFixed(6)}`);
      this.out(`  tau3 + r^2: ${info.tau3Check!.toFixed(6)}`);
      this.out(`  (paper Eq. 16-17: τ3 = η² and τ3 + r² = 1 hold for the |Ψ3(θ)> family -- ${Math.abs(info.tau3Check! - 1) < 1e-9 ? 'satisfied' : 'this state is outside that family'})`);
    }
  }

  // ------------------------------------------------------------- apqb
  private cmdApqb(a: string[]): void {
    const parsed = parseArgs(a);
    const o = parsed.opts;
    let q: APQB;
    if (o.r !== undefined) q = APQB.fromR(num(o.r));
    else if (o.a !== undefined) q = APQB.fromLatent(num(o.a));
    else if (o.p1 !== undefined) q = APQB.fromProbability(num(o.p1));
    else if (parsed.pos.length) q = new APQB(num(parsed.pos[0]));
    else {
      q = this.k.systemAPQB();
      this.out('(system APQB)');
    }
    const [c, s] = q.amplitudes;
    const [p0, p1] = q.probabilities;
    this.out(`|ψ(θ)> = ${c.toFixed(4)}|0> + ${s.toFixed(4)}|1>   θ = ${q.theta.toFixed(4)} rad (${((q.theta * 180) / Math.PI).toFixed(1)}°)`);
    this.out(`r = cos2θ = ${q.r >= 0 ? '+' : ''}${q.r.toFixed(4)}   η = T = |sin2θ| = ${q.T.toFixed(4)}   r²+η² = ${q.constraint().toFixed(6)}`);
    this.out(`P(0) = ${p0.toFixed(4)}   P(1) = ${p1.toFixed(4)}   H_Z = ${q.entropy.toFixed(4)} bit`);
    this.out(`z = e^(i2θ) = ${q.z.re >= 0 ? '+' : ''}${q.z.re.toFixed(4)}${q.z.im >= 0 ? '+' : ''}${q.z.im.toFixed(4)}i   Bloch = (${q.bloch.map((v) => v.toFixed(4)).join(', ')})`);
    const K = o.K !== undefined ? Math.round(num(o.K)) : 3;
    const [re, im] = q.features(K);
    this.out('Chebyshev features Re z^k = T_k(r): ' + re.map((v) => (v >= 0 ? '+' : '') + v.toFixed(4)).join(', '));
    this.out('                   Im z^k = η U_k-1(r): ' + im.map((v) => (v >= 0 ? '+' : '') + v.toFixed(4)).join(', '));
    this.out(`temperature control τ(η) on [0.1, 1.0]: ${(0.1 + 0.9 * q.T).toFixed(4)}`);
  }

  // ------------------------------------------------------------ files
  private cmdLs(a: string[]): void {
    for (const n of this.k.fs.ls(a[0] ?? '')) this.out(n);
  }

  private cmdCat(a: string[]): void {
    for (const p of a) this.out(this.k.fs.read(p).replace(/\n+$/, ''));
  }

  private cmdRm(a: string[]): void {
    const recursive = a.includes('-r');
    for (const p of a) if (p !== '-r') this.k.fs.rm(p, recursive);
  }

  private cmdWrite(a: string[]): void {
    if (a.length < 2) throw new Error('usage: write <path> <text...>');
    this.k.fs.write(a[0], a.slice(1).join(' ') + '\n');
  }

  private cmdTree(a: string[]): void {
    const p = a[0] ?? '/';
    this.out(p);
    for (const l of this.k.fs.tree(p)) this.out(l);
  }

  private cmdSave(a: string[]): void {
    if (a.length < 2) throw new Error('usage: save <pid|last> <path>');
    let proc: Process | undefined;
    if (a[0] === 'last') proc = [...this.k.processes.values()].filter((p) => p.circuit).pop();
    else proc = this.k.process(Math.round(num(a[0])));
    if (!proc?.circuit) throw new KernelError('no circuit to save');
    this.k.fs.write(a[1], proc.circuit.toJSONString());
    this.out(`saved circuit '${proc.circuit.name}' to ${a[1]}`);
  }

  private cmdExec(a: string[]): void {
    const parsed = parseArgs(a);
    if (!parsed.pos.length) throw new Error('usage: exec <circuit.json> [--shots N --seed S]');
    const circuit = Circuit.fromJSON(this.k.fs.readJSON<CircuitJSON>(parsed.pos[0]));
    const shots = parsed.opts.shots !== undefined ? Math.round(num(parsed.opts.shots)) : undefined;
    const seed = parsed.opts.seed !== undefined ? Math.round(num(parsed.opts.seed)) : undefined;
    this.out(circuit.draw());
    this.out(resultSummary(this.k.sysExecCircuit(circuit, shots, seed)));
  }

  private cmdSh(a: string[]): void {
    if (!a.length) throw new Error('usage: sh <script.qsh>');
    this.runScript(this.k.fs.read(a[0]));
  }
}
