/** Practical Unix-style utilities for QubitFS. No native programs or host filesystem access. */
import type { Shell } from './shell';

export function unixCommands(sh: Shell): Record<string, (args: string[]) => void> {
  const fs = sh.k.fs;
  const emit = (text: string) => { if (text) sh.writeRaw(text); };
  const read = (paths: string[]) => paths.length ? paths.map(p => p === '-' ? sh.stdin : fs.read(p)).join('') : sh.stdin;
  const lines = (text: string) => text ? text.replace(/\n$/, '').split('\n') : [];
  const flags = (args: string[], supported: string[]) => {
    for (const a of args) if (a.startsWith('-') && a !== '-' && !supported.includes(a)) throw new Error(`unsupported option: ${a}`);
    return args.filter(a => !a.startsWith('-') || a === '-');
  };
  const copy = (a: string[], move: boolean) => {
    if (a.length !== 2) throw new Error(`usage: ${move ? 'mv' : 'cp'} <file> <destination>`);
    const src = fs.resolve(a[0]);
    const dst = fs.isDir(a[1]) ? fs.resolve(a[1]) + '/' + src.split('/').pop() : fs.resolve(a[1]);
    if (src === dst) throw new Error('source and destination are the same');
    const text = fs.read(src); // Directories deliberately unsupported.
    fs.write(dst, text);
    if (move) fs.rm(src);
  };
  return {
    true: () => {}, false: () => { sh.lastStatus = 1; },
    whoami: () => sh.out(sh.env.USER),
    env: () => Object.entries({ ...sh.env, PWD: fs.cwd }).forEach(([k, v]) => sh.out(`${k}=${v}`)),
    export: a => {
      if (!a.length) { Object.entries(sh.env).forEach(([k, v]) => sh.out(`${k}=${v}`)); return; }
      for (const item of a) {
        const match = item.match(/^([A-Za-z_]\w*)=(.*)$/s);
        if (!match) throw new Error('usage: export NAME=value');
        sh.env[match[1]] = match[2];
      }
    },
    which: a => {
      for (const name of a) {
        if (Object.hasOwn(sh.commands, name) || Object.hasOwn(sh.k.programs, name)) sh.out(`/bin/${name}`);
        else sh.lastStatus = 1;
      }
    },
    history: () => sh.history.forEach((l, i) => sh.out(`${i + 1}  ${l}`)),
    touch: a => {
      for (const p of flags(a, [])) if (!fs.exists(p)) fs.write(p, '');
    },
    cp: a => copy(flags(a, []), false), mv: a => copy(flags(a, []), true),
    mkdir: a => { for (const p of flags(a, ['-p'])) fs.mkdir(p, a.includes('-p')); },
    rm: a => {
      for (const p of flags(a, ['-r', '-f', '-rf', '-fr'])) {
        if (!fs.exists(p) && a.some(x => ['-f', '-rf', '-fr'].includes(x))) continue;
        fs.rm(p, a.some(x => ['-r', '-rf', '-fr'].includes(x)));
      }
    },
    ls: a => {
      const paths = flags(a, ['-a', '-l', '-la', '-al']);
      const all = a.some(x => ['-a', '-la', '-al'].includes(x));
      const long = a.some(x => ['-l', '-la', '-al'].includes(x));
      for (const p of paths.length ? paths : ['.']) {
        for (const entry of fs.ls(p).filter(x => all || !x.startsWith('.'))) {
          const full = fs.isDir(p) ? fs.resolve(p) + '/' + entry : fs.resolve(p);
          sh.out(long ? `${fs.isDir(full) ? 'd' : '-'} ${fs.isDir(full) ? '-' : fs.read(full).length} ${entry}` : entry);
        }
      }
    },
    cat: a => emit(read(flags(a, []))),
    printf: a => {
      const [format = '', ...values] = a;
      let i = 0;
      const text = format.replace(/%[%sd]/g, x => x === '%%' ? '%' : x === '%d' ? String(Number(values[i++] ?? 0)) : values[i++] ?? '')
        .replace(/\\([ntr\\])/g, (_, c) => (({ n: '\n', t: '\t', r: '\r', '\\': '\\' } as Record<string, string>)[c]!));
      emit(text);
    },
    grep: a => {
      const args = flags(a, ['-i', '-v', '-n', '-F']);
      if (!args.length) throw new Error('usage: grep [-i] [-v] [-n] [-F] <literal> [file...]');
      const [pattern, ...paths] = args;
      // Literal matching keeps untrusted patterns from blocking the mobile JS thread.
      const needle = a.includes('-i') ? pattern.toLowerCase() : pattern;
      const found = lines(read(paths)).map((l, i) => ({ l, i })).filter(({ l }) =>
        (a.includes('-i') ? l.toLowerCase() : l).includes(needle) !== a.includes('-v'));
      if (!found.length) sh.lastStatus = 1;
      found.forEach(({ l, i }) => sh.out(a.includes('-n') ? `${i + 1}:${l}` : l));
    },
    head: a => slice(a, false), tail: a => slice(a, true),
    wc: a => {
      const paths = flags(a, ['-l', '-w', '-m']);
      const text = read(paths);
      const counts = [String((text.match(/\n/g) ?? []).length), String(text.trim() ? text.trim().split(/\s+/).length : 0), String([...text].length)];
      const chosen = ['-l', '-w', '-m'].map((flag, i) => a.includes(flag) ? counts[i] : null).filter(x => x !== null);
      sh.out((chosen.length ? chosen : counts).join(' '));
    },
    sort: a => {
      const list = lines(read(flags(a, ['-r', '-n'])));
      list.sort(a.includes('-n') ? (x, y) => Number(x) - Number(y) : undefined);
      if (a.includes('-r')) list.reverse();
      list.forEach(sh.out);
    },
    uniq: a => lines(read(flags(a, []))).filter((l, i, arr) => i === 0 || arr[i - 1] !== l).forEach(sh.out),
    zsh: () => { throw new Error('zsh is not installed. This is qsh, a documented Unix-style subset; macOS binaries are unsupported.'); },
    bash: () => { throw new Error('bash is not installed. Use qsh commands or sh <file.qsh>.'); },
  };
  function slice(a: string[], tail: boolean) {
    let n = 10;
    const args = [...a];
    if (args[0] === '-n') { args.shift(); n = Number(args.shift()); }
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('-n must be 0..10000');
    const list = lines(read(flags(args, [])));
    (n === 0 ? [] : tail ? list.slice(-n) : list.slice(0, n)).forEach(sh.out);
  }
}
