import { VirtualMachine, BOOT_ROM, BELL_ASSEMBLY } from '../src/core/vm';
import { StateVector } from '../src/core/state';
import { calculate } from '../src/core/calculator';
import { Kernel } from '../src/os/kernel';
import { QubitFS } from '../src/os/fs';
import { Shell } from '../src/os/shell';
import { WindowManager } from '../src/os/wm';

function session() {
  const k = new Kernel({ numQubits: 8, seed: 3 });
  const output: string[] = [];
  const sh = new Shell(k, line => output.push(line));
  return { k, sh, output };
}

describe('QVM execution', () => {
  test('boot validates integer CPU, memory and APQB measurement', () => {
    const result = new VirtualMachine().run(BOOT_ROM, 1);
    expect(result.registers.slice(0, 3)).toEqual(['42', '42', '1']);
    expect(result.halted).toBe(true);
    const { k } = session();
    expect(k.fs.readJSON('/etc/qvm-boot.json')).toEqual(k.bootReport);
  });
  test('64-bit integers retain precision and 32-bit arithmetic wraps', () => {
    expect(new VirtualMachine(64).run('MOV R0 9007199254740993\nADD R0 2\nPRINT R0\nHALT').output).toEqual(['9007199254740995']);
    expect(new VirtualMachine(32).run('MOV R0 4294967295\nADD R0 2\nPRINT R0\nHALT').output).toEqual(['1']);
  });
  test('branches compute a sum and memory returns it', () => {
    const source = 'MOV R1 10\nloop: ADD R0 R1\nSUB R1 1\nJNZ R1 loop\nSTORE 4095 R0\nLOAD R2 4095\nPRINT R2\nHALT';
    expect(new VirtualMachine().run(source).output).toEqual(['55']);
  });
  test('Bell measurements agree in both branches and repeat by seed', () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const a = new VirtualMachine().run(BELL_ASSEMBLY, seed);
      expect(a.output[0]).toBe(a.output[1]);
      expect(a).toEqual(new VirtualMachine().run(BELL_ASSEMBLY, seed));
      outcomes.add(a.output.join(''));
    }
    expect([...outcomes].sort()).toEqual(['00', '11']);
  });
  test.each(['again: JMP again', 'LOAD R0 4096\nHALT', 'QALLOC 64\nHALT', 'QMEASURE R0 0\nHALT', 'MOV R16 1\nHALT', 'MOV R0 1', 'QALLOC 1\nQPREP 0 NaN\nHALT'])('rejects unsafe or malformed program %s', source => {
    expect(() => new VirtualMachine().run(source)).toThrow();
  });
  test('executes through the kernel and records failures and JSON results', () => {
    const { k, sh } = session();
    expect(sh.executeLine('qvm /home/user/Examples/bell.qasm')).toBe(0);
    const p = [...k.processes.values()].pop()!;
    expect(p.state).toBe('done');
    expect(k.fs.read(`/var/results/${p.pid}_qvm.json`)).toContain('wordBits');
    k.fs.write('/bad.qasm', 'loop: JMP loop');
    expect(sh.executeLine('qvm /bad.qasm')).toBe(1);
    expect(k.sysMem().used).toBe(0);
  });
  test.each([NaN, Infinity, 0, 1.5, 32, 64])('rejects invalid state-vector sizes before allocation: %s', n => {
    expect(() => new StateVector(n)).toThrow();
  });
});

describe('Unix-style shell and shared apps', () => {
  test('pipes, redirects and file utilities operate on real shared files', () => {
    const { k, sh } = session();
    expect(sh.executeLine('mkdir -p ~/Documents/work; printf "orange\\nblue\\norange\\n" > ~/Documents/work/a; cat < ~/Documents/work/a | sort | uniq > /unique')).toBe(0);
    expect(k.fs.read('/unique')).toBe('blue\norange\n');
    sh.executeLine('cp /unique /copy; mv /copy /moved; grep orange /moved | wc -l > /count; echo green >> /moved');
    expect(k.fs.read('/count')).toBe('1\n');
    expect(k.fs.exists('/copy')).toBe(false);
    expect(k.fs.read('/moved')).toBe('blue\norange\ngreen\n');
  });
  test('single quotes, escaped operators, variables and exit status', () => {
    const { sh, output } = session();
    sh.executeLine('export NAME="Qubit OS"; echo "$NAME"; echo \'$NAME\'; echo a\\|b; false && echo wrong; echo $?; false || echo recovered');
    expect(output).toEqual(['Qubit OS', '$NAME', 'a|b', '1', 'recovered']);
    sh.executeLine('echo "$NAME"_suffix');
    expect(output[output.length - 1]).toBe('Qubit OS_suffix');
  });
  test('printf preserves data without adding a newline', () => {
    const { k, sh } = session();
    sh.executeLine('printf "%s" abc > /raw; printf "%s" def >> /raw');
    expect(k.fs.read('/raw')).toBe('abcdef');
  });
  test('parse errors cause no partial writes', () => {
    const { sh, k } = session();
    for (const command of ['echo x > /x; echo "bad', 'echo x > /x; echo $(bad)', 'echo x > /x |', 'echo x > /x &&']) {
      expect(sh.executeLine(command)).toBe(2);
      expect(k.fs.exists('/x')).toBe(false);
    }
  });
  test('network commands finish before conditional commands and redirects', async () => {
    const { sh, k } = session();
    k.net.fetchImpl = (async () => new Response('a\nb\nc\n')) as typeof fetch;
    sh.executeLine('wget https://example.test/text /download && cat /download | tail -n 2 > /last');
    await sh.pending;
    expect(k.fs.read('/last')).toBe('b\nc\n');
    k.sysSysctl('net.enabled', 'false');
    sh.executeLine('wget https://example.test/fail /missing && echo wrong > /wrong || echo recovered > /recovered');
    await sh.pending;
    expect(k.fs.exists('/wrong')).toBe(false);
    expect(k.fs.read('/recovered')).toBe('recovered\n');
  });
  test('scripts await asynchronous commands, nested scripts are bounded', async () => {
    const { k, sh } = session();
    k.net.fetchImpl = (async () => new Response('ready')) as typeof fetch;
    k.fs.write('/load.qsh', 'wget https://example.test/a /a\ncat /a > /b');
    sh.executeLine('sh /load.qsh && cat /b > /c');
    await sh.pending;
    expect(k.fs.read('/c')).toBe('ready');
    k.fs.write('/recursive.qsh', 'sh /recursive.qsh');
    expect(sh.executeLine('sh /recursive.qsh')).toBe(1);
  });
  test('native shells are not falsely advertised; errors and completion are useful', () => {
    const { sh, output } = session();
    expect(sh.executeLine('zsh')).toBe(1);
    expect(output.join('')).toContain('not installed');
    expect(sh.executeLine('constructor')).toBe(127);
    expect(sh.complete('pw')).toEqual(['pwd']);
    expect(sh.complete('cat /home/user/Examples/be')).toContain('/home/user/Examples/bell.qasm');
  });
  test('TextEdit and Calculator are kernel windows and share persisted documents', () => {
    const { k, sh } = session();
    const wm = new WindowManager(k);
    sh.executeLine('echo hello > ~/Documents/note.txt; open ~/Documents/note.txt; open calculator');
    expect(wm.windows.map(w => w.app)).toEqual(['textedit', 'calculator']);
    expect(new Kernel({ fsSnapshot: JSON.parse(k.fs.snapshot()) }).fs.read('/home/user/Documents/note.txt')).toBe('hello\n');
  });
  test('filesystem rejects prototype pollution and malformed snapshots', () => {
    const fs = new QubitFS();
    expect(() => fs.write('/__proto__/polluted', 'yes')).toThrow();
    expect(() => QubitFS.fromSnapshot('{"__proto__":{"polluted":"yes"}}')).toThrow();
    expect(() => QubitFS.fromSnapshot('{"bad":null}')).toThrow();
    expect(({} as Record<string, string>).polluted).toBeUndefined();
  });
});

describe('Calculator', () => {
  test('arithmetic precedence, unary values and exponent notation', () => {
    expect(calculate('(12 + 6) / 3')).toBe(6);
    expect(calculate('-2 * (3 + 4) + 1e2')).toBe(86);
  });
  test.each(['1/0', 'process.exit()', '2 +', '(1+2', '1e999', ''])('rejects %s without evaluating code', s => {
    expect(() => calculate(s)).toThrow();
  });
});
