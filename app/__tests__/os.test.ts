import { Kernel, KernelError, isResult } from '../src/os/kernel';
import { QubitFS } from '../src/os/fs';
import { Shell, tokenize } from '../src/os/shell';
import { Result } from '../src/core/computer';

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

function shell(cmds: string[], opts: ConstructorParameters<typeof Kernel>[0] = {}) {
  const lines: string[] = [];
  const k = new Kernel({ numQubits: 8, seed: 1, ...opts });
  const sh = new Shell(k, (l) => lines.push(l));
  for (const c of cmds) sh.executeLine(c);
  return { sh, k, text: lines.join('\n'), lines };
}

describe('QubitFS', () => {
  test('basic ops and snapshot roundtrip', () => {
    const fs = new QubitFS();
    fs.mkdir('/home/user/work');
    fs.write('/home/user/work/a.txt', 'hello');
    fs.cd('/home/user');
    expect(fs.read('work/a.txt')).toBe('hello');
    expect(fs.ls()).toContain('work/');
    const fs2 = QubitFS.fromSnapshot(fs.snapshot());
    expect(fs2.read('/home/user/work/a.txt')).toBe('hello');
    expect(() => fs2.rm('/home/user/work')).toThrow();
    fs2.rm('/home/user/work', true);
    expect(fs2.exists('/home/user/work')).toBe(false);
    expect(fs2.tree('/lib').length).toBeGreaterThan(2);
  });
});

describe('Kernel', () => {
  test('memory allocation', () => {
    const k = new Kernel({ numQubits: 6, seed: 0, theta: 0 });
    const s1 = k.sysAlloc(4, 'a');
    const s2 = k.sysAlloc(2, 'b');
    expect(s1.qubits).toEqual([0, 1, 2, 3]);
    expect(s2.qubits).toEqual([4, 5]);
    expect(() => k.sysAlloc(1)).toThrow(KernelError);
    k.sysFree(s1.sid);
    expect(k.sysMem().free).toBe(4);
  });
  test('register syscalls', () => {
    const k = new Kernel({ numQubits: 6, seed: 0, theta: 0 });
    const seg = k.sysAlloc(2, 'pair');
    k.sysApply(seg.sid, 'apqb', [0], [0.4]);
    k.sysApply(seg.sid, 'cx', [0, 1]);
    close(k.sysEntanglement(seg.sid).concurrence!, Math.abs(Math.sin(0.8)));
    const out = k.sysMeasure(seg.sid);
    expect(['00', '11']).toContain(out.outcome);
    close(seg.state.probabilityOf(out.outcome!), 1);
  });
  test('process lifecycle and failure', () => {
    const k = new Kernel({ numQubits: 6, seed: 0, theta: 0 });
    const p = k.sysRun('bell', [], 10, 1);
    expect(p.state).toBe('done');
    expect(Object.values((p.result as Result).counts).reduce((a, b) => a + b, 0)).toBe(10);
    expect(k.fs.exists(`/var/results/${p.pid}_bell.json`)).toBe(true);
    const bad = k.sysRun('grover', ['10101010']);
    expect(bad.state).toBe('failed');
    expect(bad.error).toContain('qubits');
  });
  test('priority scheduler is deterministic at theta=0 and explores at pi/4', () => {
    const k = new Kernel({ numQubits: 6, seed: 0, theta: 0 });
    k.sysSpawn('bell', [], 1);
    k.sysSpawn('ghz', ['3'], 9);
    k.sysSpawn('bell_apqb', ['0.2'], 5);
    expect(k.explorationRate()).toBe(0);
    expect(k.sysSchedule().map((p) => p.name)).toEqual(['ghz', 'bell_apqb', 'bell']);
    const orders = new Set<string>();
    for (let trial = 0; trial < 20; trial++) {
      const k2 = new Kernel({ numQubits: 4, seed: trial, theta: Math.PI / 4 });
      close(k2.explorationRate(), 0.5);
      for (const [n, pr] of [['bell', 1], ['ghz', 9], ['bell_apqb', 5]] as Array<[string, number]>) k2.sysSpawn(n, [], pr);
      orders.add(k2.sysSchedule().map((p) => p.name).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
  test('kill, sysctl and notifications', () => {
    const k = new Kernel({ numQubits: 6, seed: 0, theta: 0 });
    let n = 0;
    k.subscribe(() => n++);
    const p = k.sysSpawn('bell');
    k.sysKill(p.pid);
    expect(p.state).toBe('killed');
    expect(k.sysSchedule()).toEqual([]);
    k.sysSysctl('apqb.theta', '0.25pi');
    close(k.explorationRate(), 0.5);
    expect(() => k.sysSysctl('apqb.theta', '3')).toThrow(KernelError);
    expect(n).toBeGreaterThan(0);
  });
  test('qbnn job', () => {
    const k = new Kernel({ numQubits: 4, seed: 0 });
    const p = k.sysRun('qbnn_train', ['xor', '--epochs', '40', '--seed', '1']);
    expect(p.state).toBe('done');
    expect((p.result as { accuracy: number }).accuracy).toBe(1);
    const ev = k.sysRun('qbnn_eval', [(p.result as { weights: string }).weights, '1', '-1']);
    expect((ev.result as { output: number[] }).output[0]).toBeGreaterThan(0.5);
  });
});

describe('Shell', () => {
  test('tokenizer', () => {
    expect(tokenize('echo "a b" c')).toEqual(['echo', 'a b', 'c']);
    expect(tokenize("run bell --shots 5")).toEqual(['run', 'bell', '--shots', '5']);
  });
  test('run and ent', () => {
    const { sh, text } = shell(['run bell_apqb 0.3 --shots 20 --seed 2', 'ent last']);
    expect(sh.lastStatus).toBe(0);
    expect(text).toContain('concurrence');
    expect(text).toContain('satisfied');
  });
  test('program name as command and unknown command', () => {
    expect(shell(['bell --shots 5']).text).toContain('== bell');
    expect(shell(['frobnicate']).sh.lastStatus).toBe(127);
  });
  test('register workflow', () => {
    const { sh, text } = shell(['alloc 2 --name pair --r 0.6,-0.2', 'readout 1', 'gate 1 cx 0 1', 'measure 1 --shots 10', 'measure 1', 'free 1', 'mem']);
    expect(sh.lastStatus).toBe(0);
    expect(text).toContain('register collapsed');
    expect(text).toContain('free 8');
  });
  test('files, exec, scripts', () => {
    const { sh, text } = shell(['run bell --shots 5', 'save last /home/user/b.json', 'exec /home/user/b.json --shots 7 --seed 1', 'cat /home/user/b.json', 'tree /home', 'sh /home/user/hello.qsh']);
    expect(sh.lastStatus).toBe(0);
    expect(text).toContain('"gate": "cx"');
    expect(text).toContain('bell_apqb');
  });
  test('apqb and sysctl', () => {
    const { text } = shell(['apqb --r 0.5', 'apqb 0.25pi', 'sysctl apqb.theta 0.4', 'sysctl', 'echo "a; b"; echo c']);
    expect(text).toContain('r = cos2θ = +0.5000');
    expect(text).toContain('apqb.theta = 0.4');
    expect(text).toContain('a; b');
  });
  test('scheduler through the shell', () => {
    const { text } = shell(['sysctl apqb.theta 0', 'spawn bell --prio 1', 'spawn ghz 4 --prio 9', 'sched', 'ps'], { theta: 0 });
    expect(text.indexOf('pid 2 (ghz)')).toBeLessThan(text.indexOf('pid 1 (bell)'));
  });
});

describe('WindowManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WindowManager } = require('../src/os/wm');
  test('windows are kernel service processes', () => {
    const k = new Kernel({ numQubits: 4, seed: 0 });
    const wm = new WindowManager(k);
    wm.setArea(800, 600);
    const win = wm.open('terminal');
    expect(k.process(win.pid).state).toBe('running');
    expect(k.process(win.pid).name).toBe('gui:terminal');
    expect(wm.open('terminal').id).toBe(win.id); // reused
    const w2 = wm.open('finder', '/lib');
    expect(wm.focused!.id).toBe(w2.id);
    wm.focus(win.id);
    expect(wm.focused!.id).toBe(win.id);
    wm.close(win.id);
    expect(k.process(win.pid).state).toBe('killed');
    // killing from the kernel closes the window
    k.sysKill(w2.pid);
    expect(wm.windows.length).toBe(0);
  });
  test('shell open / windows / close', () => {
    const lines: string[] = [];
    const k = new Kernel({ numQubits: 4, seed: 0 });
    const wm = new WindowManager(k);
    const sh = new Shell(k, (l) => lines.push(l));
    sh.executeLine('open apqb; open /lib/circuits; windows');
    expect(wm.windows.length).toBe(2);
    expect(lines.join('\n')).toContain('Finder');
    sh.executeLine('close apqb; close 2; windows');
    expect(wm.windows.length).toBe(0);
    expect(sh.executeLine('open nope')).toBe(1);
    sh.executeLine('open /home/user/hello.qsh');
    expect(lines.join('\n')).toContain('concurrence');
  });
});

describe('network and qpm', () => {
  const fs = require('fs');
  const path = require('path');
  const registryDir = path.join(__dirname, '..', '..', 'registry');
  const base = 'https://example.test/registry/';
  function mockFetch(k: Kernel) {
    k.net.fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(base)) {
        const file = path.join(registryDir, url.slice(base.length));
        if (fs.existsSync(file)) return new Response(fs.readFileSync(file, 'utf8'), { status: 200 });
        return new Response('not found', { status: 404 });
      }
      if (url === 'https://example.test/hello') return new Response('hello, qubit', { status: 200 });
      throw new Error('ENOTFOUND');
    }) as typeof fetch;
    k.sysctl['net.registry'] = base + 'index.json';
  }
  test('curl / wget through the shell', async () => {
    const lines: string[] = [];
    const k = new Kernel({ numQubits: 4, seed: 0 });
    mockFetch(k);
    const sh = new Shell(k, (l) => lines.push(l));
    sh.executeLine('curl https://example.test/hello');
    await sh.pending;
    expect(lines.join('\n')).toContain('hello, qubit');
    sh.executeLine('wget https://example.test/hello /home/user/h.txt');
    await sh.pending;
    expect(k.fs.read('/home/user/h.txt')).toBe('hello, qubit');
    sh.executeLine('curl https://nowhere.test/');
    await sh.pending;
    expect(lines[lines.length - 1]).toContain('network error');
    expect(k.net.history.length).toBe(5); // 2 ok + 1 failed request retried twice
    expect(k.net.history.filter((r) => r.error).length).toBe(3);
    k.sysSysctl('net.enabled', 'false');
    sh.executeLine('curl https://example.test/hello');
    await sh.pending;
    expect(lines[lines.length - 1]).toContain('disabled');
  });
  test('qpm install from the repo registry, run, open, remove', async () => {
    const lines: string[] = [];
    const k = new Kernel({ numQubits: 6, seed: 0 });
    mockFetch(k);
    const { WindowManager } = require('../src/os/wm');
    const wm = new WindowManager(k);
    const sh = new Shell(k, (l) => lines.push(l));
    sh.executeLine('qpm update; qpm search lab');
    await sh.pending;
    expect(lines.join('\n')).toContain('bell-lab');
    sh.executeLine('qpm install bell-lab qubit-ai');
    await sh.pending;
    expect(k.fs.exists('/apps/bell-lab/main.qsh')).toBe(true);
    expect(k.pkg.get('qubit-ai')!.kind).toBe('web');
    expect('app:bell-lab' in k.programs).toBe(true);
    const proc = k.sysRun('app:bell-lab');
    expect(proc.state).toBe('done');
    expect(proc.logs.join('\n')).toContain('concurrence');
    sh.executeLine('open bell-lab; open qubit-ai; windows');
    expect(wm.windows.map((w: { app: string }) => w.app).sort()).toEqual(['app:bell-lab', 'app:qubit-ai']);
    // persisted in /etc/apps.json and reloaded on reboot
    const k2 = new Kernel({ numQubits: 6, seed: 0, fsSnapshot: JSON.parse(k.fs.snapshot()) });
    expect(k2.pkg.list().map((a) => a.name).sort()).toEqual(['bell-lab', 'qubit-ai']);
    expect('app:bell-lab' in k2.programs).toBe(true);
    sh.executeLine('qpm remove bell-lab; qpm list');
    expect(k.pkg.get('bell-lab')).toBeUndefined();
    expect(k.fs.exists('/apps/bell-lab')).toBe(false);
    expect(wm.windows.length).toBe(1);
    sh.executeLine('qpm install nope');
    await sh.pending;
    expect(lines[lines.length - 1]).toContain('not found');
  });
  test('manifest validation rejects unsafe packages', () => {
    const k = new Kernel({ numQubits: 4, seed: 0 });
    expect(() => k.pkg.installManifest({ name: 'evil', version: '1', title: 'x', kind: 'script', main: '/etc/motd', files: { '/etc/motd': 'pwned' } })).toThrow(/\/apps\//);
    expect(() => k.pkg.installManifest({ name: 'Bad Name', version: '1', title: 'x', kind: 'web', url: 'https://a' })).toThrow(/invalid package name/);
    expect(() => k.pkg.installManifest({ name: 'w', version: '1', title: 'x', kind: 'web', url: 'ftp://a' })).toThrow(/http/);
    const app = k.pkg.addWebApp('My Site!', 'https://example.test');
    expect(app.name).toBe('my-site');
  });
});
