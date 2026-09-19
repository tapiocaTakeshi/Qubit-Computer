/**
 * Composable 64-bit APQB-PC.  This is a hardware model for QubitOS running
 * on a classical host; it is not a claim of physical quantum hardware.
 */
import type { Kernel } from './kernel';

export interface HardwareReport {
  motherboard: { name: string; bus: string };
  cpu: { name: string; bits: 64; role: string };
  ram: { name: string; totalQubits: number; allocatedQubits: number };
  gpuNpu: { name: string; lanes: number; backend: string; role: string };
  ssd: { name: string; capacityBytes: number; usedBytes: number; freeBytes: number };
  power: { name: string; load: number; watts: number; cpuTempC: number; fanPercent: number };
  cooling: { name: string; fanPercent: number };
  network: string[];
  sound: string;
  enclosure: string;
  physicalQuantumHardware: false;
}

const bytesInTree = (node: unknown): number => typeof node === 'string'
  ? new TextEncoder().encode(node).length
  : Object.values(node as Record<string, unknown>).reduce<number>((total, child) => total + bytesInTree(child), 0);

export class APQBPersonalComputer {
  readonly cpuBits = 64 as const;
  readonly gpuLanes = 256;
  readonly storageBytes = 64 * 1024 * 1024;

  constructor(readonly apqbQubits: number) {
    if (!Number.isInteger(apqbQubits) || apqbQubits < 1 || apqbQubits > 20) throw new Error('APQB-PC supports 1..20 simulated qubits');
  }

  report(kernel: Kernel): HardwareReport {
    const allocatedQubits = this.apqbQubits - kernel.freeQubits.length;
    const load = Math.min(1, (allocatedQubits + kernel.readyQueue().length) / this.apqbQubits);
    const usedBytes = bytesInTree(kernel.fs.root);
    const fanPercent = 20 + 75 * load;
    return {
      motherboard: { name: 'APQB-MB64', bus: 'APQB IR -> QVM -> host backend' },
      cpu: { name: 'APQB-CPU64', bits: this.cpuBits, role: 'circuit execution and QubitOS scheduling' },
      ram: { name: 'APQB-RAM', totalQubits: this.apqbQubits, allocatedQubits },
      gpuNpu: { name: 'APQB-GPU/NPU', lanes: this.gpuLanes, backend: kernel.backendInfo.name, role: 'state-vector and QBNN acceleration' },
      ssd: { name: 'QubitFS SSD', capacityBytes: this.storageBytes, usedBytes, freeBytes: Math.max(0, this.storageBytes - usedBytes) },
      power: { name: 'virtual PSU', load, watts: 18 * (0.35 + 0.65 * load), cpuTempC: 32 + 34 * load, fanPercent },
      cooling: { name: 'virtual CPU cooler and case fans', fanPercent },
      network: ['Wi-Fi', 'Bluetooth', 'LAN (host bridge)'], sound: 'virtual audio I/O', enclosure: 'QubitOS mobile / desktop enclosure', physicalQuantumHardware: false,
    };
  }
}
