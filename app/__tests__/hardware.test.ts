import { Kernel } from '../src/os/kernel';
import { Shell } from '../src/os/shell';

describe('APQB personal computer', () => {
  test('assembles 64-bit parts around QubitOS services', () => {
    const kernel = new Kernel({ numQubits: 4, seed: 1 });
    const report = kernel.sysHardware();
    expect(report.cpu.bits).toBe(64);
    expect(report.ram.totalQubits).toBe(4);
    expect(report.physicalQuantumHardware).toBe(false);
    kernel.sysAlloc(2, 'work');
    expect(kernel.sysHardware().ram.allocatedQubits).toBe(2);
  });

  test('qsh exposes the assembled hardware', () => {
    const lines: string[] = [];
    const shell = new Shell(new Kernel({ numQubits: 4 }), (line) => lines.push(line));
    shell.executeLine('hardware');
    expect(lines.join('\n')).toContain('cpu: APQB-CPU64 64-bit');
  });
});
