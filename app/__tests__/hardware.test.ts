import { Kernel } from '../src/os/kernel';
import { Shell } from '../src/os/shell';
import { FSDir, QubitFS, utf8Bytes } from '../src/os/fs';
import { Circuit } from '../src/core/circuit';

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
    expect(lines.join('\n')).toContain('cpu: QVM64 64-bit');
  });
});

describe('integrated PC execution', () => {
  test('disk program -> CPU -> RAM -> APQB -> disk -> cold boot and reread', () => {
    const k = new Kernel({ numQubits: 2 });
    const sh = new Shell(k, () => {});
    expect(sh.executeLine('qvm /home/user/Examples/pc-check.qasm')).toBe(0);
    expect(k.pc.lastRun?.output).toEqual(['43']);
    expect(k.pc.cpu.memory[100]).toBe(BigInt(42));
    expect(k.sysHardware().cpu.runs).toBe(1);
    expect(k.fs.read('/home/user/Documents/pc-result.txt')).toBe('43');
    expect(k.sysMem().used).toBe(0);
    const oldResult = k.fs.read('/var/results/1_qvm.json');
    const reboot = new Kernel({ numQubits: 2, fsSnapshot: JSON.parse(k.fs.snapshot()) as FSDir });
    expect(reboot.pc.cpu.memory[100]).toBe(BigInt(0));
    reboot.fs.write('/read.qasm', 'READ R0 /home/user/Documents/pc-result.txt\nPRINT R0\nHALT');
    const proc = reboot.sysRun('qvm', ['/read.qasm']);
    expect(proc.state).toBe('done');
    expect(proc.pid).toBe(2);
    expect(reboot.pc.lastRun?.output).toEqual(['43']);
    expect(reboot.fs.read('/var/results/1_qvm.json')).toBe(oldResult);
  });

  test('QALLOC and circuit jobs cannot bypass RAM already reserved by an app', () => {
    const k = new Kernel({ numQubits: 2 });
    const kept = k.sysAlloc(2, 'other-app');
    expect(() => k.pc.run(k, 'QALLOC 1\nHALT')).toThrow(/out of qubits/);
    expect(() => k.sysExecCircuit(new Circuit(1).h(0))).toThrow(/out of qubits/);
    expect(k.sysRun('bell').state).toBe('failed');
    expect(k.sysMem().used).toBe(2);
    expect(k.segment(kept.sid)).toBe(kept);
    k.sysFree(kept.sid);
    expect(k.sysRun('bell').state).toBe('done');
    expect(k.sysMem().used).toBe(0);
  });

  test.each(['QALLOC 1\nHALT', 'QALLOC 1\nQFREE\nQALLOC 1\nHALT', 'QALLOC 1\nDIV R0 0\nHALT', 'QALLOC 1\nloop: JMP loop', 'QALLOC 1\nWRITE / R0\nHALT'])('releases only the executing CPU allocation: %s', source => {
    const k = new Kernel({ numQubits: 2 });
    const kept = k.sysAlloc(1, 'keep');
    try { k.pc.run(k, source); } catch { /* error paths must release too */ }
    expect(k.sysMem().used).toBe(1);
    expect([...k.segments.keys()]).toEqual([kept.sid]);
    expect(k.freeQubits).toHaveLength(1);
  });

  test('READ validates data and preserves unsigned 64-bit precision', () => {
    const k = new Kernel();
    k.fs.write('/max', '18446744073709551615');
    expect(k.pc.run(k, 'READ R0 /max\nWRITE /copy R0\nPRINT R0\nHALT').output).toEqual(['18446744073709551615']);
    expect(k.fs.read('/copy')).toBe('18446744073709551615');
    for (const text of ['R1', 'NaN', '-1', '18446744073709551616', '']) {
      k.fs.write('/bad', text);
      expect(() => k.pc.run(k, 'READ R0 /bad\nHALT')).toThrow(/unsigned 64-bit/);
    }
    expect(() => k.pc.run(k, 'READ R0 /missing\nHALT')).toThrow(/no such/);
    expect(k.sysRun('qvm', ['/home/user/Examples/bell.qasm', '32']).error).toContain('64-bit only');
  });

  test('repeated allocation consumes the APQB work budget and is cleaned up', () => {
    const k = new Kernel({ numQubits: 12 });
    expect(() => k.pc.run(k, 'loop: QALLOC 12\nQFREE\nJMP loop')).toThrow(/APQB operation budget/);
    expect(k.sysMem().used).toBe(0);
  });

  test('reports only implemented capabilities and actual word RAM', () => {
    const h = new Kernel().sysHardware();
    expect(h.ram.byteLength).toBe(32768);
    expect(h.gpuNpu.available.filter(b => b.available).map(b => b.name)).toEqual(['cpu']);
    expect(h.gpuNpu).not.toHaveProperty('lanes');
    expect(h.power).not.toHaveProperty('watts');
    expect(h.cooling.status).toContain('not measured');
    expect(h.sound).toContain('not implemented');
  });
});

describe('bounded durable filesystem', () => {
  test('UTF-8 accounting includes Unicode, JSON and directory metadata without TextEncoder', () => {
    expect(utf8Bytes('aあ🧠')).toBe(8);
    const fs = new QubitFS({}, 100);
    fs.write('/unicode', 'あ🧠');
    expect(fs.usedBytes).toBe(Buffer.byteLength(fs.snapshot(), 'utf8'));
    const prior = fs.snapshot();
    expect(() => fs.write('/unicode', 'x'.repeat(100), true)).toThrow(/disk full/);
    expect(fs.snapshot()).toBe(prior);
    expect(() => fs.write('/new/dirs/file', 'x'.repeat(100))).toThrow(/disk full/);
    expect(fs.exists('/new')).toBe(false);
    expect(() => fs.mkdir('/' + 'a'.repeat(100))).toThrow(/disk full/);
    expect(fs.snapshot()).toBe(prior);
    fs.rm('/unicode');
    expect(fs.usedBytes).toBe(2);
    expect(() => new QubitFS({ file: 'x'.repeat(100) }, 100)).toThrow(/capacity/);
  });

  test('direct file edits notify persistence subscribers; rejected writes do not', () => {
    const k = new Kernel();
    const changed = jest.fn();
    k.subscribe(changed);
    k.fs.write('/direct', 'persist this');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(() => k.fs.write('/', 'invalid')).toThrow();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  test('disk-full result saving is reported instead of silently claiming success', () => {
    const k = new Kernel({ storageBytes: 32768 });
    k.fs.write('/full', '');
    k.fs.write('/full', 'x'.repeat(k.fs.capacityBytes - k.fs.usedBytes));
    const p = k.sysRun('qvm', ['/home/user/Examples/bell.qasm']);
    expect(p.state).toBe('done');
    expect(p.logs.join('\n')).toContain('Result not saved: QubitFS disk full');
    expect(k.sysMem().used).toBe(0);
  });
});
