/** QVM: a bounded, classical 32/64-bit interpreter with an APQB coprocessor.
 * This is our own ISA, not ARM/x86, and does not execute Mach-O or macOS apps.
 */
import { StateVector } from './state';
import { APQB } from './apqb';
import * as G from './gates';
import { Rng } from './rng';

export interface VMResult {
  wordBits: 32 | 64;
  steps: number;
  registers: string[]; // Decimal strings preserve all 64 bits in JSON.
  output: string[];
  halted: boolean;
}
/** Motherboard ports. Kernel-owned allocations share the OS's finite APQB pool. */
export interface VMBus {
  allocate(qubits: number): StateVector;
  release(): void;
  readWord(path: string): string;
  writeWord(path: string, value: string): void;
}
type Instruction = { op: string; args: string[]; line: number };
const ARITY: Record<string, number> = {
  MOV: 2, ADD: 2, SUB: 2, MUL: 2, DIV: 2, MOD: 2, LOAD: 2, STORE: 2,
  JMP: 1, JNZ: 2, PRINT: 1, HALT: 0, READ: 2, WRITE: 2,
  QALLOC: 1, QPREP: 2, QH: 1, QX: 1, QCX: 2, QMEASURE: 2, QFREE: 0,
};

export const BOOT_ROM = `# QVM power-on test: integer arithmetic and deterministic APQB readout
MOV R0 6
MUL R0 7
STORE 0 R0
LOAD R1 0
QALLOC 1
QPREP 0 1.5707963267948966
QMEASURE R2 0
QFREE
HALT
`;

export const BELL_ASSEMBLY = `# APQB Bell pair: cos(theta)|00> + sin(theta)|11>
# theta = pi/4. Repeat Run to sample either 00 or 11.
QALLOC 2
QPREP 0 0.7853981633974483
QCX 0 1
QMEASURE R0 0
QMEASURE R1 1
PRINT R0
PRINT R1
QFREE
HALT
`;

export const PC_EXAMPLE = `# CPU + RAM + shared APQB + disk, all through QubitOS
MOV R0 6
MUL R0 7
STORE 100 R0
LOAD R1 100
QALLOC 1
QPREP 0 1.5707963267948966
QMEASURE R2 0
QFREE
ADD R1 R2
WRITE /home/user/Documents/pc-result.txt R1
READ R3 /home/user/Documents/pc-result.txt
PRINT R3
HALT
`;

function assemble(source: string): { code: Instruction[]; labels: Map<string, number> } {
  if (source.length > 100000) throw new Error('QVM source exceeds 100 KB');
  const code: Instruction[] = [];
  const labels = new Map<string, number>();
  source.split('\n').forEach((raw, i) => {
    let text = raw.replace(/#.*/, '').trim();
    const label = text.match(/^([A-Za-z_]\w*):\s*/);
    if (label) {
      if (labels.has(label[1])) throw new Error(`line ${i + 1}: duplicate label ${label[1]}`);
      labels.set(label[1], code.length);
      text = text.slice(label[0].length);
    }
    if (!text) return;
    const [op, ...args] = text.replace(/,/g, ' ').split(/\s+/);
    const name = op.toUpperCase();
    if (!Object.hasOwn(ARITY, name) || args.length !== ARITY[name]) throw new Error(`line ${i + 1}: invalid instruction ${text}`);
    code.push({ op: name, args, line: i + 1 });
  });
  if (!code.length) throw new Error('QVM program is empty');
  return { code, labels };
}

export class VirtualMachine {
  readonly wordBits: 32 | 64;
  readonly registers: bigint[] = Array(16).fill(BigInt(0));
  readonly memory: bigint[] = Array(4096).fill(BigInt(0));
  private quantum: StateVector | null = null;
  constructor(wordBits: number = 64) {
    if (wordBits !== 32 && wordBits !== 64) throw new Error('QVM word size must be 32 or 64');
    this.wordBits = wordBits;
  }

  reset(): void {
    this.registers.fill(BigInt(0));
    this.memory.fill(BigInt(0));
    this.quantum = null;
  }

  run(source: string, seed?: number, bus?: VMBus): VMResult {
    this.reset();
    const { code, labels } = assemble(source);
    const rng = new Rng(seed);
    const output: string[] = [];
    let pc = 0, steps = 0, work = 0, halted = false;
    const reg = (s: string) => {
      if (!/^R(?:[0-9]|1[0-5])$/i.test(s)) throw new Error(`invalid register ${s}`);
      return Number(s.slice(1));
    };
    const value = (s: string): bigint => {
      if (/^R/i.test(s)) return this.registers[reg(s)];
      if (!/^-?\d+$/.test(s) && !/^0x[\da-f]+$/i.test(s)) throw new Error(`invalid integer ${s}`);
      if (s.length > 22) throw new Error('integer literal exceeds the QVM word range');
      return BigInt(s);
    };
    const index = (s: string, max: number) => {
      const n = value(s);
      if (n < BigInt(0) || n >= BigInt(max)) throw new Error(`index ${s} outside 0..${max - 1}`);
      return Number(n);
    };
    const put = (s: string, v: bigint) => { this.registers[reg(s)] = BigInt.asUintN(this.wordBits, v); };
    const jump = (s: string) => {
      if (!labels.has(s) || labels.get(s)! >= code.length) throw new Error(`invalid jump label ${s}`);
      return labels.get(s)!;
    };
    const state = () => {
      if (!this.quantum) throw new Error('QALLOC is required');
      work += this.quantum.dim;
      if (work > 2000000) throw new Error('APQB operation budget exceeded');
      return this.quantum;
    };
    const release = () => {
      if (this.quantum) {
        this.quantum = null;
        bus?.release();
      }
    };
    try {
      while (!halted) {
        if (++steps > 20000) throw new Error('QVM instruction budget exceeded (20000)');
        if (pc >= code.length) throw new Error('program ended without HALT');
        const ins = code[pc++];
        const [a, b] = ins.args;
        try {
          switch (ins.op) {
            case 'MOV': put(a, value(b)); break;
            case 'ADD': put(a, value(a) + value(b)); break;
            case 'SUB': put(a, value(a) - value(b)); break;
            case 'MUL': put(a, value(a) * value(b)); break;
            case 'DIV': put(a, value(a) / value(b)); break;
            case 'MOD': put(a, value(a) % value(b)); break;
            case 'LOAD': put(a, this.memory[index(b, this.memory.length)]); break;
            case 'STORE': this.memory[index(a, this.memory.length)] = BigInt.asUintN(this.wordBits, value(b)); break;
            case 'READ': {
              reg(a);
              if (!bus) throw new Error('READ requires a QubitOS storage bus');
              const word = bus.readWord(b).trim();
              if (!/^\d{1,20}$/.test(word) || BigInt(word) > BigInt('18446744073709551615')) throw new Error('file must contain one unsigned 64-bit decimal integer');
              put(a, BigInt(word)); break;
            }
            case 'WRITE':
              if (!bus) throw new Error('WRITE requires a QubitOS storage bus');
              bus.writeWord(a, BigInt.asUintN(this.wordBits, value(b)).toString()); break;
            case 'JMP': pc = jump(a); break;
            case 'JNZ': if (value(a) !== BigInt(0)) pc = jump(b); break;
            case 'PRINT':
              if (output.length >= 1000) throw new Error('QVM output limit exceeded');
              output.push(value(a).toString()); break;
            case 'HALT': halted = true; break;
            case 'QALLOC': {
              const n = Number(value(a));
              if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error('QVM supports 1..12 simulated qubits');
              if (this.quantum) throw new Error('QFREE the current register first');
              work += 2 ** n;
              if (work > 2000000) throw new Error('APQB operation budget exceeded');
              this.quantum = bus ? bus.allocate(n) : new StateVector(n); break;
            }
            case 'QPREP': {
              const sv = state();
              const theta = Number(b);
              // APQB(theta) = RY(2 theta). It rotates an existing qubit; it is not a reset.
              new APQB(theta);
              if (!Number.isFinite(theta)) throw new Error('theta must be finite');
              sv.apply(G.resolve('apqb', [theta]), [index(a, sv.n)]); break;
            }
            case 'QH': case 'QX': {
              const sv = state(); sv.apply(G.resolve(ins.op === 'QH' ? 'h' : 'x'), [index(a, sv.n)]); break;
            }
            case 'QCX': {
              const sv = state(); sv.apply(G.resolve('cx'), [index(a, sv.n), index(b, sv.n)]); break;
            }
            case 'QMEASURE': {
              const sv = state(); reg(a); put(a, BigInt(sv.measure([index(b, sv.n)], rng, true))); break;
            }
            case 'QFREE': release(); break;
          }
        } catch (e) { throw new Error(`line ${ins.line}: ${(e as Error).message}`); }
      }
      return { wordBits: this.wordBits, steps, registers: this.registers.map(String), output, halted };
    } finally {
      release();
    }
  }
}
