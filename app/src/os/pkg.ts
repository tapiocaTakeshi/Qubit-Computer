/**
 * qpm -- the QubitOS package manager.
 *
 * Packages are JSON documents fetched over the network (from the registry on
 * GitHub, or any URL) and installed into QubitFS.  Two kinds exist:
 *
 *   script  files (.qsh scripts, circuit JSON, QBNN weights) + a main script;
 *           installed as a /bin program and a dock app that runs the script
 *   web     a URL opened in the Browser app (a "web app", like a Safari web app)
 *
 * Installed apps are recorded in /etc/apps.json so they survive reboots.
 */
import type { Kernel, Process } from './kernel';
import { KernelError } from './util';

export type PackageKind = 'script' | 'web';

export interface PackageManifest {
  name: string;
  version: string;
  title: string;
  description?: string;
  icon?: string;
  kind: PackageKind;
  /** script packages: files to write into QubitFS (absolute path -> text). */
  files?: Record<string, string>;
  /** script packages: the .qsh entry point (a path inside `files`). */
  main?: string;
  /** web packages: the URL to open. */
  url?: string;
  homepage?: string;
}

export interface RegistryEntry {
  name: string;
  version: string;
  title: string;
  description?: string;
  icon?: string;
  kind: PackageKind;
  /** URL of the package manifest. */
  url: string;
}

export interface RegistryIndex {
  name?: string;
  packages: RegistryEntry[];
}

export interface InstalledApp extends PackageManifest {
  installedAt: number;
  source: string;
}

export const APPS_DB = '/etc/apps.json';
export const DEFAULT_REGISTRIES = [
  'https://raw.githubusercontent.com/tapiocaTakeshi/Qubit-Computer/main/registry/index.json',
  'https://raw.githubusercontent.com/tapiocaTakeshi/Qubit-Computer/claude/qubit-computer-apqb-z0m4rr/registry/index.json',
];

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/;

export class PackageManager {
  kernel: Kernel;
  installed: Record<string, InstalledApp> = {};
  index: RegistryEntry[] = [];
  indexSource: string | null = null;
  /** Optional script runner supplied by the shell layer (avoids an import cycle). */
  runScript: ((kernel: Kernel, text: string, out: (line: string) => void) => number) | null = null;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.load();
  }

  // ------------------------------------------------------------ storage
  load(): void {
    try {
      const raw = this.kernel.fs.readJSON<Record<string, InstalledApp>>(APPS_DB);
      this.installed = raw && typeof raw === 'object' ? raw : {};
    } catch {
      this.installed = {};
    }
    for (const app of Object.values(this.installed)) this.registerProgram(app);
  }

  private save(): void {
    this.kernel.fs.writeJSON(APPS_DB, this.installed);
    this.kernel.notify();
  }

  list(): InstalledApp[] {
    return Object.values(this.installed).sort((a, b) => a.installedAt - b.installedAt);
  }

  get(name: string): InstalledApp | undefined {
    return this.installed[name];
  }

  // ------------------------------------------------------------ registry
  registries(): string[] {
    const v = String(this.kernel.sysctl['net.registry'] ?? '');
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async refreshIndex(): Promise<RegistryEntry[]> {
    const errors: string[] = [];
    for (const url of this.registries()) {
      try {
        const idx = await this.kernel.net.fetchJSON<RegistryIndex>(url);
        if (!idx || !Array.isArray(idx.packages)) throw new KernelError('registry index has no packages array');
        this.index = idx.packages.map((p) => ({ ...p, url: resolveUrl(p.url, url) }));
        this.indexSource = url;
        this.kernel.log(`qpm: registry ${url}: ${this.index.length} packages`);
        this.kernel.notify();
        return this.index;
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }
    throw new KernelError(`no registry reachable:\n  ${errors.join('\n  ')}`);
  }

  search(q: string): RegistryEntry[] {
    const s = q.toLowerCase();
    return this.index.filter((p) => !s || p.name.includes(s) || p.title.toLowerCase().includes(s) || (p.description ?? '').toLowerCase().includes(s));
  }

  // ------------------------------------------------------------ install
  static validate(m: PackageManifest): void {
    if (!m || typeof m !== 'object') throw new KernelError('package manifest is not an object');
    if (!NAME_RE.test(m.name ?? '')) throw new KernelError(`invalid package name: ${m.name}`);
    if (!m.title) throw new KernelError('package needs a title');
    if (m.kind === 'script') {
      if (!m.files || !m.main) throw new KernelError('script package needs files and main');
      for (const p of Object.keys(m.files)) {
        if (!p.startsWith('/apps/')) throw new KernelError(`script package may only write under /apps/: ${p}`);
        if (p.includes('..')) throw new KernelError(`bad path: ${p}`);
      }
      if (!(m.main in m.files)) throw new KernelError('main must be one of the package files');
    } else if (m.kind === 'web') {
      if (!m.url || !/^https?:\/\//i.test(m.url)) throw new KernelError('web package needs an http(s) url');
    } else throw new KernelError(`unknown package kind: ${String((m as { kind?: string }).kind)}`);
  }

  async install(nameOrUrl: string): Promise<InstalledApp> {
    let source = nameOrUrl;
    if (!/^https?:\/\//i.test(nameOrUrl)) {
      if (!this.index.length) await this.refreshIndex();
      const entry = this.index.find((p) => p.name === nameOrUrl);
      if (!entry) throw new KernelError(`package not found in registry: ${nameOrUrl} (try 'qpm search')`);
      source = entry.url;
    }
    const manifest = await this.kernel.net.fetchJSON<PackageManifest>(source);
    return this.installManifest(manifest, source);
  }

  installManifest(manifest: PackageManifest, source = 'local'): InstalledApp {
    PackageManager.validate(manifest);
    const fs = this.kernel.fs;
    if (manifest.kind === 'script' && manifest.files) {
      for (const [path, text] of Object.entries(manifest.files)) fs.write(path, String(text));
    }
    const app: InstalledApp = { ...manifest, installedAt: Date.now(), source };
    this.installed[app.name] = app;
    this.registerProgram(app);
    this.kernel.log(`qpm: installed ${app.name}@${app.version} (${app.kind}) from ${source}`);
    this.save();
    return app;
  }

  /** Register a web app straight from the browser ("Add to Dock"). */
  addWebApp(title: string, url: string, icon = '🌐'): InstalledApp {
    const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'web-app';
    return this.installManifest({ name, version: '1.0.0', title, icon, kind: 'web', url }, url);
  }

  remove(name: string): void {
    const app = this.installed[name];
    if (!app) throw new KernelError(`not installed: ${name}`);
    if (app.kind === 'script' && app.files) {
      for (const path of Object.keys(app.files)) {
        try {
          this.kernel.fs.rm(path);
        } catch {
          /* already gone */
        }
      }
      const dir = `/apps/${name}`;
      if (this.kernel.fs.exists(dir)) {
        try {
          this.kernel.fs.rm(dir, true);
        } catch {
          /* ignore */
        }
      }
    }
    delete this.installed[name];
    delete this.kernel.programs[`app:${name}`];
    this.kernel.wm?.closeApp(`app:${name}`);
    this.kernel.log(`qpm: removed ${name}`);
    this.save();
  }

  private registerProgram(app: InstalledApp): void {
    if (app.kind !== 'script') return;
    const pm = this;
    this.kernel.programs[`app:${app.name}`] = {
      name: `app:${app.name}`,
      description: `${app.title} ${app.version}${app.description ? ' — ' + app.description : ''}`,
      usage: `app:${app.name}`,
      params: [],
      job: (kernel: Kernel, proc: Process) => {
        if (!pm.runScript) throw new KernelError('no script runner attached');
        const text = kernel.fs.read(app.main!);
        const status = pm.runScript(kernel, text, (l) => proc.log(l));
        return { app: app.name, main: app.main, status };
      },
    };
  }
}

export function resolveUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const b = base.slice(0, base.lastIndexOf('/') + 1);
  return b + url.replace(/^\.\//, '');
}
