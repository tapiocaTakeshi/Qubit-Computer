/**
 * QubitOS kernel: hardware abstraction, qubit memory segments, processes,
 * the APQB scheduler (exploration rate eps = p_min + (p_max - p_min) * eta of
 * the system APQB), syscalls, filesystem and dmesg.
 */
import { VirtualMachine, BOOT_ROM, BELL_ASSEMBLY, VMResult } from '../core/vm';
import { APQB, thetaFromR } from '../core/apqb';
import { availableBackends, BackendInfo, resolveBackend } from '../core/backend';
import { Circuit } from '../core/circuit';
import { QubitComputer, Result } from '../core/computer';
import * as G from '../core/gates';
import { Rng } from '../core/rng';
import { APQBReadout, StateVector } from '../core/state';
import { FSDir, FSError, QubitFS } from './fs';
import { NetStack } from './net';
import { DEFAULT_REGISTRIES, PackageManager } from './pkg';
import { PROGRAMS, Program, programKind } from './programs';
import { WebInstaller } from './webinstall';
import { APQBPersonalComputer } from './hardware';
import { KernelError, entanglementOf, isResult } from './util';
import type { WindowManager } from './wm';

export { KernelError, isResult, entanglementOf };

export const OS_NAME = 'QubitOS';
export const OS_VERSION = '0.2.0';

export type ProcState = 'new' | 'ready' | 'running' | 'done' | 'failed' | 'killed';

export interface Segment {
  sid: number;
  name: string;
  qubits: number[];
  state: StateVector;
  owner: number | null;
  created: number;
  history: string[];
}

export class Process {
  pid: number;
  name: string;
  argv: string[];
  program: Program;
  priority: number;
  state: ProcState = 'new';
  created = Date.now();
  started: number | null = null;
  finished: number | null = null;
  result: unknown = null;
  error: string | null = null;
  logs: string[] = [];
  shots: number;
  seed?: number;
  circuit: Circuit | null = null;

  constructor(pid: number, name: string, argv: string[], program: Program, priority: number, shots: number, seed?: number) {
    this.pid = pid;
    this.name = name;
    this.argv = argv;
    this.program = program;
    this.priority = priority;
    this.shots = shots;
    this.seed = seed;
  }

  log(line: string): void {
    this.logs.push(line);
  }

  get elapsedMs(): number | null {
    return this.started === null ? null : (this.finished ?? Date.now()) - this.started;
  }

  row(): string {
    const el = this.elapsedMs !== null ? `${(this.elapsedMs / 1000).toFixed(3)}s` : '-';
    return `${String(this.pid).padStart(4)}  ${this.state.padEnd(8)} ${String(this.priority).padStart(3)}  ${el.padStart(8)}  ${this.name} ${this.argv.join(' ')}`;
  }
}

export interface KernelOptions {
  numQubits?: number;
  seed?: number;
  theta?: number;
  fsSnapshot?: FSDir;
  /** Injectable for tests; defaults to the browser (or a no-op installer off the web). */
  webInstall?: WebInstaller;
  backend?: string;
}

export type SysctlValue = number | string | boolean;

export class Kernel {
  readonly bootTime = Date.now();
  hw: QubitComputer;
  numQubits: number;
  fs: QubitFS;
  rng: Rng;
  seed?: number;
  private dmesgBuf: string[] = [];
  sysctl: Record<string, SysctlValue>;
  freeQubits: number[];
  segments = new Map<number, Segment>();
  processes = new Map<number, Process>();
  private nextSid = 1;
  private nextPid = 1;
  lastResult: Result | null = null;
  programs: Record<string, Program> = { ...PROGRAMS };
  /** Observers notified after any state change (used by the UI). */
  listeners = new Set<() => void>();
  /** Attached by the desktop's WindowManager, if a GUI is running. */
  wm: WindowManager | null = null;
  net: NetStack;
  pkg: PackageManager;
  /** Installing QubitOS itself as an app from the browser (web builds only). */
  webInstall: WebInstaller;
  backendInfo: BackendInfo;
  readonly bootReport: VMResult;
  /** The assembled motherboard, CPU, APQB-RAM, GPU/NPU, SSD, PSU and cooling model. */
  pc: APQBPersonalComputer;

  constructor(opts: KernelOptions = {}) {
    this.bootReport = new VirtualMachine(64).run(BOOT_ROM, 0);
    if (this.bootReport.registers[1] !== '42' || this.bootReport.registers[2] !== '1') throw new KernelError('QVM power-on self-test failed');
    this.log('QVM64: integer, RAM and APQB self-tests passed; starting hosted QubitOS');
    const numQubits = opts.numQubits ?? 16;
    if (!Number.isInteger(numQubits) || numQubits < 1 || numQubits > 20) throw new KernelError('simulator supports 1..20 qubits');
    const theta = opts.theta ?? 0.2;
    this.backendInfo = resolveBackend(opts.backend ?? 'cpu', (msg) => this.log(msg));
    this.hw = new QubitComputer(numQubits);
    this.numQubits = numQubits;
    this.pc = new APQBPersonalComputer(numQubits);
    this.fs = new QubitFS(opts.fsSnapshot);
    this.rng = new Rng(opts.seed);
    this.seed = opts.seed;
    this.sysctl = { 'apqb.theta': theta, 'sched.p_min': 0, 'sched.p_max': 0.5, 'hw.num_qubits': numQubits, 'run.shots': 1024, 'net.enabled': true, 'net.timeout_ms': 15000, 'net.retries': 2, 'net.registry': DEFAULT_REGISTRIES.join(','), 'hardware.backend': this.backendInfo.name };
    this.freeQubits = [...Array(numQubits).keys()];
    this.log(`${OS_NAME} ${OS_VERSION} booting on APQB hardware: ${numQubits} simulated qubits`);
    this.log(`hardware backend: ${this.backendInfo.name} (engine=${this.backendInfo.engine}) - ${this.backendInfo.detail}`);
    this.log(`system APQB theta=${theta.toFixed(3)} -> r=${Math.cos(2 * theta) >= 0 ? '+' : ''}${Math.cos(2 * theta).toFixed(3)} eta=${Math.abs(Math.sin(2 * theta)).toFixed(3)} (scheduler exploration eps=${this.explorationRate().toFixed(3)})`);
    this.log(`fs: ${opts.fsSnapshot ? 'restored snapshot' : 'fresh'}; ${Object.keys(this.programs).length} programs in /bin`);
    for (const dir of ['/home/user/Documents', '/home/user/Desktop', '/home/user/Downloads', '/home/user/Examples']) this.fs.mkdir(dir);
    if (!this.fs.exists('/home/user/Examples/bell.qasm')) this.fs.write('/home/user/Examples/bell.qasm', BELL_ASSEMBLY);
    this.fs.write('/etc/qvm-boot.json', JSON.stringify(this.bootReport, null, 2));
    this.programs.qvm = {
      name: 'qvm', description: 'Run QVM assembly with a simulated APQB coprocessor',
      usage: 'qvm <file.qasm> [32|64]', params: [{ name: 'file', label: 'Assembly file', default: '/home/user/Examples/bell.qasm', kind: 'string' }],
      job: (k, proc, args) => {
        if (!args[0]) throw new Error('usage: qvm <file.qasm> [32|64]');
        const result = new VirtualMachine(args[1] === undefined ? 64 : Number(args[1])).run(k.fs.read(args[0]), proc.seed);
        for (const line of result.output) proc.log(line);
        return result;
      },
    };
    this.refreshBin();
    this.net = new NetStack(this);
    this.pkg = new PackageManager(this);
    this.log(`net: ${this.net.enabled ? 'online' : 'offline'}; qpm: ${Object.keys(this.pkg.installed).length} installed app(s)`);
    this.webInstall = opts.webInstall ?? WebInstaller.fromGlobal();
    this.webInstall.subscribe(() => {
      this.log(this.webInstall.summary());
      this.notify();
    });
    this.log(this.webInstall.summary());
  }

  // ------------------------------------------------------------ events
  notify(): void {
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------ logging
  log(line: string): void {
    const t = (Date.now() - this.bootTime) / 1000;
    this.dmesgBuf.push(`[${t.toFixed(3).padStart(9)}] ${line}`);
  }

  sysDmesg(n = 50): string[] {
    return this.dmesgBuf.slice(-n);
  }

  sysUname() {
    return { os: OS_NAME, version: OS_VERSION, hardware: 'APQB state-vector', backend: this.backendInfo.name, numQubits: this.numQubits, uptimeMs: Date.now() - this.bootTime, programs: Object.keys(this.programs).sort() };
  }

  sysHardware() {
    return this.pc.report(this);
  }

  // ------------------------------------------------------------ backend
  /** `sysBackend()`: report current + available backends. `sysBackend(name)`: switch. */
  sysBackend(name?: string): unknown {
    if (name === undefined) {
      return { current: this.backendInfo.name, engine: this.backendInfo.engine, detail: this.backendInfo.detail, available: availableBackends() };
    }
    return this.sysSysctl('hardware.backend', name);
  }

  // ------------------------------------------------------- sysctl/APQB
  systemAPQB(): APQB {
    return new APQB(Number(this.sysctl['apqb.theta']));
  }

  /** eps = p_min + (p_max - p_min) * eta (paper Eq. 11 / 32). */
  explorationRate(): number {
    const eta = this.systemAPQB().T;
    const lo = Number(this.sysctl['sched.p_min']);
    const hi = Number(this.sysctl['sched.p_max']);
    return lo + (hi - lo) * eta;
  }

  sysSysctl(key?: string, value?: string): SysctlValue | Record<string, SysctlValue> {
    if (key === undefined) return { ...this.sysctl };
    let k = key;
    if (k === 'apqb.r' && value !== undefined) {
      value = String(thetaFromR(parseFloat(value)));
      k = 'apqb.theta';
    }
    if (!(k in this.sysctl)) throw new KernelError(`unknown sysctl key '${key}'`);
    if (value === undefined) return this.sysctl[k];
    if (k === 'hw.num_qubits') throw new KernelError('hw.num_qubits is read-only');
    const old = this.sysctl[k];
    if (k === 'hardware.backend') {
      const info = resolveBackend(value, (msg) => this.log(msg));
      this.backendInfo = info;
      this.sysctl[k] = info.name;
      this.log(`sysctl ${k}: ${old} -> ${info.name} (engine=${info.engine})`);
      this.notify();
      return info.name;
    }
    let nv: SysctlValue;
    if (typeof old === 'boolean') nv = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    else if (typeof old === 'number') {
      const t = value.trim();
      nv = t.endsWith('pi') ? parseFloat(t.slice(0, -2) || '1') * Math.PI : parseFloat(t);
      if (!Number.isFinite(nv)) throw new KernelError(`not a finite number: ${value}`);
    } else nv = value;
    if (k === 'apqb.theta' && (Number(nv) < 0 || Number(nv) > Math.PI / 2)) throw new KernelError('apqb.theta must lie in [0, pi/2]');
    if (k === 'run.shots' && (!Number.isInteger(nv) || Number(nv) < 1 || Number(nv) > 16384)) throw new KernelError('run.shots must be 1..16384');
    if (k === 'net.retries' && (!Number.isInteger(nv) || Number(nv) < 0 || Number(nv) > 5)) throw new KernelError('net.retries must be 0..5');
    if (k === 'net.timeout_ms' && (Number(nv) < 100 || Number(nv) > 60000)) throw new KernelError('net.timeout_ms must be 100..60000');
    this.sysctl[k] = nv;
    this.log(`sysctl ${k}: ${old} -> ${nv}`);
    this.notify();
    return nv;
  }

  // ------------------------------------------------------------ memory
  sysAlloc(size: number, name = '', apqbs?: APQB[], owner: number | null = null): Segment {
    if (!Number.isInteger(size) || size < 1) throw new KernelError('segment size must be an integer >= 1');
    if (size > this.freeQubits.length) throw new KernelError(`out of qubits: requested ${size}, free ${this.freeQubits.length}`);
    if (apqbs && apqbs.length !== size) throw new KernelError(`expected ${size} initial APQBs, got ${apqbs.length}`);
    const state = apqbs ? StateVector.fromAPQBs(apqbs) : new StateVector(size);
    const qubits = this.freeQubits.splice(0, size);
    const sid = this.nextSid++;
    const seg: Segment = { sid, name: name || `seg${sid}`, qubits, state, owner, created: Date.now(), history: [] };
    this.segments.set(sid, seg);
    this.log(`alloc sid=${sid} '${seg.name}' qubits=[${qubits}]`);
    this.notify();
    return seg;
  }

  sysFree(sid: number): void {
    const seg = this.segment(sid);
    this.freeQubits.push(...seg.qubits);
    this.freeQubits.sort((a, b) => a - b);
    this.segments.delete(seg.sid);
    this.log(`free sid=${sid} '${seg.name}' -> ${this.freeQubits.length} free qubits`);
    this.notify();
  }

  sysMem() {
    const used = this.numQubits - this.freeQubits.length;
    return { total: this.numQubits, used, free: this.freeQubits.length, segments: [...this.segments.values()].map((s) => ({ sid: s.sid, name: s.name, qubits: s.qubits, owner: s.owner, ops: s.history.length })) };
  }

  segment(sid: number): Segment {
    const seg = this.segments.get(Number(sid));
    if (!seg) throw new KernelError(`no such segment: ${sid}`);
    return seg;
  }

  // ------------------------------------------------------- register ops
  sysApply(sid: number, gate: string, targets: number[], params: number[] = []): Segment {
    const seg = this.segment(sid);
    const key = gate.toLowerCase();
    if (!(key in G.GATE_ARITY)) throw new KernelError(`unknown gate '${gate}'`);
    if (G.GATE_ARITY[key] !== targets.length) throw new KernelError(`gate '${gate}' needs ${G.GATE_ARITY[key]} target(s)`);
    seg.state.apply(G.resolve(key, params), targets);
    seg.history.push(`${key}${params.length ? `(${params.map((p) => +p.toFixed(3))})` : ''} [${targets}]`);
    this.notify();
    return seg;
  }

  sysMeasure(sid: number, qubits?: number[], shots = 1, collapse = true): { outcome?: string; counts?: Record<string, number>; qubits: number[]; shots: number; collapsed: boolean } {
    if (!Number.isInteger(shots) || shots < 1 || shots > 16384) throw new KernelError('shots must be 1..16384');
    const seg = this.segment(sid);
    const qs = qubits && qubits.length ? qubits : [...Array(seg.state.n).keys()];
    if (shots <= 1) {
      const outcome = seg.state.measure(qs, this.rng, collapse);
      seg.history.push(`measure [${qs}] -> ${outcome}`);
      this.notify();
      return { outcome, qubits: qs, shots: 1, collapsed: collapse };
    }
    return { counts: seg.state.sample(shots, qs, this.rng), qubits: qs, shots, collapsed: false };
  }

  sysReadout(sid: number): APQBReadout[] {
    return this.segment(sid).state.apqbReadouts();
  }

  sysReset(sid: number, apqbs?: APQB[]): Segment {
    const seg = this.segment(sid);
    seg.state = apqbs ? StateVector.fromAPQBs(apqbs) : new StateVector(seg.qubits.length);
    seg.history.push('reset');
    this.notify();
    return seg;
  }

  sysEntanglement(sid: number) {
    return Kernel.entanglementOf(this.segment(sid).state);
  }

  static entanglementOf(sv: StateVector) {
    return entanglementOf(sv);
  }

  // ---------------------------------------------------------- processes
  sysSpawn(name: string, argv: string[] = [], priority = 5, shots?: number, seed?: number): Process {
    const prog = this.programs[name];
    if (!prog) throw new KernelError(`no such program: ${name} (see 'ls /bin')`);
    const pid = this.nextPid++;
    const proc = new Process(pid, name, [...argv], prog, priority, shots ?? Number(this.sysctl['run.shots']), seed);
    proc.state = 'ready';
    this.processes.set(pid, proc);
    this.log(`spawn pid=${pid} ${name} ${argv.join(' ')} prio=${priority}`);
    this.notify();
    return proc;
  }

  /** Spawn a long-lived service process (GUI window, daemon) that stays "running" until killed. */
  spawnService(name: string, argv: string[] = [], priority = 5): Process {
    const program: Program = { name, description: 'service', usage: name, params: [] };
    const pid = this.nextPid++;
    const proc = new Process(pid, name, [...argv], program, priority, 0);
    proc.state = 'running';
    proc.started = Date.now();
    this.processes.set(pid, proc);
    this.log(`service pid=${pid} ${name} ${argv.join(' ')}`);
    this.notify();
    return proc;
  }

  sysKill(pid: number): Process {
    const proc = this.process(pid);
    if (proc.state === 'ready' || proc.state === 'new' || proc.state === 'running') {
      proc.state = 'killed';
      proc.finished = Date.now();
      this.log(`kill pid=${pid}`);
      this.notify();
    }
    return proc;
  }

  sysPs(): Process[] {
    return [...this.processes.values()];
  }

  process(pid: number): Process {
    const p = this.processes.get(Number(pid));
    if (!p) throw new KernelError(`no such process: ${pid}`);
    return p;
  }

  readyQueue(): Process[] {
    return this.sysPs().filter((p) => p.state === 'ready');
  }

  /** APQB scheduler: explore with probability eps, else pick the highest priority. */
  pickNext(): Process | null {
    const ready = this.readyQueue();
    if (!ready.length) return null;
    const eps = this.explorationRate();
    if (this.rng.random() < eps) {
      const choice = this.rng.choice(ready);
      this.log(`sched: explore -> pid=${choice.pid} (eps=${eps.toFixed(3)})`);
      return choice;
    }
    ready.sort((a, b) => b.priority - a.priority || a.pid - b.pid);
    return ready[0];
  }

  execute(proc: Process): Process {
    proc.state = 'running';
    proc.started = Date.now();
    try {
      if (proc.program.circuit) {
        const circuit = proc.program.circuit(proc.argv);
        proc.circuit = circuit;
        if (circuit.numQubits > this.numQubits) throw new KernelError(`circuit needs ${circuit.numQubits} qubits, machine has ${this.numQubits}`);
        const result = this.hw.run(circuit, proc.shots, proc.seed);
        proc.result = result;
        this.lastResult = result;
        proc.log(`ran '${circuit.name}' (${circuit.numQubits} qubits, depth ${circuit.depth}) shots=${proc.shots} in ${result.elapsedMs} ms`);
      } else if (proc.program.job) {
        proc.result = proc.program.job(this, proc, proc.argv);
      }
      proc.state = 'done';
    } catch (e) {
      proc.state = 'failed';
      proc.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    proc.finished = Date.now();
    this.log(`pid=${proc.pid} ${proc.name} -> ${proc.state}${proc.error ? ` (${proc.error})` : ''}`);
    this.saveResult(proc);
    this.notify();
    return proc;
  }

  sysSchedule(maxSteps?: number): Process[] {
    const done: Process[] = [];
    while (maxSteps === undefined || done.length < maxSteps) {
      const p = this.pickNext();
      if (!p) break;
      done.push(this.execute(p));
    }
    return done;
  }

  sysRun(name: string, argv: string[] = [], shots?: number, seed?: number, priority = 5): Process {
    return this.execute(this.sysSpawn(name, argv, priority, shots, seed));
  }

  sysExecCircuit(circuit: Circuit, shots?: number, seed?: number): Result {
    const result = this.hw.run(circuit, shots ?? Number(this.sysctl['run.shots']), seed);
    this.lastResult = result;
    this.log(`exec circuit '${circuit.name}' (${circuit.numQubits} qubits) shots=${result.shots}`);
    this.notify();
    return result;
  }

  private saveResult(proc: Process): void {
    const payload: Record<string, unknown> = { pid: proc.pid, program: proc.name, argv: proc.argv, state: proc.state, error: proc.error, logs: proc.logs };
    if (isResult(proc.result)) {
      const r = proc.result;
      payload.result = { counts: r.counts, shots: r.shots, seed: r.seed, apqb: r.apqb, state: r.state.nonzero().map(([b, a]) => ({ basis: b, re: a.re, im: a.im })) };
    } else if (proc.result !== null) payload.result = proc.result;
    try {
      this.fs.writeJSON(`/var/results/${proc.pid}_${proc.name}.json`, payload);
    } catch (e) {
      if (!(e instanceof FSError)) throw e;
    }
  }

  private refreshBin(): void {
    for (const p of Object.values(this.programs)) this.fs.write(`/bin/${p.name}`, `#!qubitos ${programKind(p)}\n# ${p.description}\n# usage: ${p.usage}\n`);
  }

  registerProgram(p: Program): void {
    this.programs[p.name] = p;
    this.refreshBin();
    this.log(`registered program '${p.name}'`);
  }
}
