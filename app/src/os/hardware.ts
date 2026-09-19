/** Executable virtual PC services; no invented physical hardware measurements. */
import { BOOT_ROM, VirtualMachine, VMResult } from '../core/vm';
import { availableBackends } from '../core/backend';
import type { Kernel } from './kernel';

export class APQBPersonalComputer {
  readonly cpu = new VirtualMachine(64);
  readonly bootReport: VMResult;
  runs = 0;
  lastRun: VMResult | null = null;
  lastError: string | null = null;
  private running = false;

  constructor(readonly apqbQubits: number) {
    if (!Number.isInteger(apqbQubits) || apqbQubits < 1 || apqbQubits > 20) throw new Error('APQB-PC supports 1..20 simulated qubits');
    this.bootReport = this.cpu.run(BOOT_ROM, 0);
    if (this.bootReport.registers[1] !== '42' || this.bootReport.registers[2] !== '1') throw new Error('QVM power-on self-test failed');
    this.cpu.reset();
  }

  run(kernel: Kernel, source: string, seed?: number, owner: number | null = null): VMResult {
    if (this.running) throw new Error('QVM CPU is busy');
    this.running = true;
    this.lastRun = null;
    this.lastError = null;
    let sid: number | null = null;
    const release = () => {
      if (sid !== null) { const allocated = sid; sid = null; kernel.sysFree(allocated); }
    };
    try {
      const result = this.cpu.run(source, seed, {
        allocate: n => {
          const segment = kernel.sysAlloc(n, 'qvm-apqb', undefined, owner);
          sid = segment.sid;
          return segment.state;
        },
        release,
        readWord: path => kernel.fs.read(path),
        writeWord: (path, word) => kernel.fs.write(path, word),
      });
      this.lastRun = result;
      return result;
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    } finally {
      release();
      this.runs++;
      this.running = false;
      kernel.notify();
    }
  }

  report(kernel: Kernel) {
    const usedBytes = kernel.fs.usedBytes;
    return {
      motherboard: { name: 'QubitOS service bus', bus: 'QVM64 <-> RAM / kernel APQB pool / QubitFS' },
      cpu: { name: 'QVM64', bits: this.cpu.wordBits, role: 'bounded integer and APQB instruction interpreter; hosted OS runs in JavaScript',
        runs: this.runs, lastSteps: this.lastRun?.steps ?? null, lastError: this.lastError, registers: this.cpu.registers.map(String) },
      ram: { name: 'QVM word RAM + separate APQB pool', totalQubits: this.apqbQubits, allocatedQubits: kernel.sysMem().used,
        wordCount: this.cpu.memory.length, byteLength: this.cpu.memory.length * 8,
        nonzeroWords: this.cpu.memory.filter(v => v !== BigInt(0)).length },
      gpuNpu: { backend: kernel.backendInfo.name, engine: kernel.backendInfo.engine, available: availableBackends(),
        detail: 'No GPU/NPU compute driver. APQB runs on the JavaScript CPU engine.' },
      ssd: { name: 'QubitFS', capacityBytes: kernel.fs.capacityBytes, usedBytes, freeBytes: kernel.fs.capacityBytes - usedBytes,
        detail: 'Enforced JSON snapshot quota, not physical SSD capacity. Device persistence may have a lower limit.' },
      power: { status: 'host-managed; not measured' }, cooling: { status: 'host-managed; not measured' },
      network: ['HTTP(S) via host fetch', 'No Wi-Fi, Bluetooth or LAN device driver'],
      sound: 'Audio I/O driver not implemented', enclosure: 'Hosted React Native / browser UI',
      physicalQuantumHardware: false,
    };
  }
}
