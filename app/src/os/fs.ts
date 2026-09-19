/** QubitFS: hierarchical virtual filesystem (dirs = objects, files = strings). */
export type FSNode = string | FSDir;
export interface FSDir {
  [name: string]: FSNode;
}

export class FSError extends Error {}

const normalize = (path: string): string => {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else {
      if (['__proto__', 'constructor', 'prototype'].includes(p)) throw new FSError('reserved path component');
      parts.push(p);
    }
  }
  return '/' + parts.join('/');
};

export class QubitFS {
  root: FSDir = {};
  cwd = '/';

  constructor(snapshot?: FSDir) {
    if (snapshot) {
      const validate = (node: unknown, depth = 0): void => {
        if (typeof node === 'string') return;
        if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 64) throw new FSError('invalid filesystem snapshot');
        for (const [name, child] of Object.entries(node)) {
          if (!name || name === '.' || name === '..' || name.includes('/') || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new FSError('invalid filesystem entry');
          validate(child, depth + 1);
        }
      };
      validate(snapshot);
      this.root = JSON.parse(JSON.stringify(snapshot)) as FSDir;
    }
    else this.populateDefaults();
  }

  resolve(path: string): string {
    if (!path) return this.cwd;
    return normalize(path.startsWith('/') ? path : `${this.cwd}/${path}`);
  }

  private walk(path: string, createDirs = false): [FSDir, string] {
    const full = this.resolve(path);
    if (full === '/') return [this.root, ''];
    const parts = full.split('/').filter(Boolean);
    let node: FSDir = this.root;
    for (const part of parts.slice(0, -1)) {
      if (!(part in node)) {
        if (!createDirs) throw new FSError(`no such directory: ${part}`);
        node[part] = {};
      }
      const next = node[part];
      if (typeof next === 'string') throw new FSError(`not a directory: ${part}`);
      node = next;
    }
    return [node, parts[parts.length - 1]];
  }

  private node(path: string): FSNode {
    const full = this.resolve(path);
    if (full === '/') return this.root;
    const [parent, name] = this.walk(full);
    if (!(name in parent)) throw new FSError(`no such file or directory: ${full}`);
    return parent[name];
  }

  exists(path: string): boolean {
    try {
      this.node(path);
      return true;
    } catch {
      return false;
    }
  }

  isDir(path: string): boolean {
    try {
      return typeof this.node(path) !== 'string';
    } catch {
      return false;
    }
  }

  ls(path = ''): string[] {
    const n = this.node(path || this.cwd);
    if (typeof n === 'string') return [this.resolve(path).split('/').pop() ?? ''];
    return Object.keys(n).sort().map((k) => (typeof n[k] === 'string' ? k : k + '/'));
  }

  mkdir(path: string, parents = true): void {
    const [parent, name] = this.walk(path, parents);
    if (!name) return;
    if (name in parent) {
      if (typeof parent[name] !== 'string') return;
      throw new FSError(`file exists: ${path}`);
    }
    parent[name] = {};
  }

  write(path: string, text: string, append = false): void {
    const [parent, name] = this.walk(path, true);
    if (!name) throw new FSError('cannot write to /');
    if (name in parent && typeof parent[name] !== 'string') throw new FSError(`is a directory: ${path}`);
    parent[name] = append && name in parent ? (parent[name] as string) + text : text;
  }

  read(path: string): string {
    const n = this.node(path);
    if (typeof n !== 'string') throw new FSError(`is a directory: ${path}`);
    return n;
  }

  readJSON<T = unknown>(path: string): T {
    return JSON.parse(this.read(path)) as T;
  }

  writeJSON(path: string, obj: unknown): void {
    this.write(path, JSON.stringify(obj, null, 2));
  }

  rm(path: string, recursive = false): void {
    const [parent, name] = this.walk(path);
    if (!name) throw new FSError('cannot remove /');
    if (!(name in parent)) throw new FSError(`no such file or directory: ${path}`);
    const n = parent[name];
    if (typeof n !== 'string' && Object.keys(n).length && !recursive) throw new FSError(`directory not empty: ${path}`);
    delete parent[name];
  }

  cd(path: string): string {
    const full = this.resolve(path);
    if (!this.isDir(full)) throw new FSError(`not a directory: ${full}`);
    this.cwd = full;
    return full;
  }

  tree(path = '/', prefix = ''): string[] {
    const n = this.node(path);
    if (typeof n === 'string') return [this.resolve(path).split('/').pop() ?? ''];
    const names = Object.keys(n).sort();
    const lines: string[] = [];
    names.forEach((name, i) => {
      const last = i === names.length - 1;
      const child = n[name];
      lines.push(prefix + (last ? '└── ' : '├── ') + (typeof child === 'string' ? name : name + '/'));
      if (typeof child !== 'string') lines.push(...this.tree(`${this.resolve(path)}/${name}`, prefix + (last ? '    ' : '│   ')));
    });
    return lines;
  }

  snapshot(): string {
    return JSON.stringify(this.root);
  }

  static fromSnapshot(json: string): QubitFS {
    return new QubitFS(JSON.parse(json) as FSDir);
  }

  private populateDefaults(): void {
    for (const d of ['/bin', '/etc', '/home/user', '/var/log', '/var/results', '/lib/circuits', '/lib/qbnn']) this.mkdir(d);
    this.write('/etc/motd', "Welcome to QubitOS -- a hosted desktop with an APQB simulator.\nqsh is a Unix-style subset, not macOS/zsh. Type 'help' for commands, 'run bell' to start, 'apqb 0.3' to inspect a qubit.\n");
    this.write('/etc/release', JSON.stringify({ name: 'QubitOS', platform: 'react-native' }));
    this.write('/home/user/hello.qsh', '# QubitOS shell script: an APQB Bell pair\necho "preparing |Psi2(theta=0.4)> = cos(0.4)|00> + sin(0.4)|11>"\nrun bell_apqb 0.4 --shots 256 --seed 7\nent last\n');
    this.write('/lib/circuits/bell.json', JSON.stringify({ name: 'bell', num_qubits: 2, instructions: [{ gate: 'h', targets: [0] }, { gate: 'cx', targets: [0, 1] }, { gate: 'measure', targets: [0, 1] }] }, null, 2));
    this.write('/lib/circuits/apqb_register.json', JSON.stringify({ name: 'apqb_register', num_qubits: 3, initial_correlations: [0.9, 0.0, -0.6], instructions: [{ gate: 'measure', targets: [0, 1, 2] }] }, null, 2));
  }
}
