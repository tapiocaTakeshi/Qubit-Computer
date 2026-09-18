/**
 * Window manager -- the GUI half of QubitOS.
 *
 * Every open window is a kernel *service process* (state "running") so the
 * desktop and the shell share one process table: `ps` lists windows,
 * `kill <pid>` closes them, `open <app>` opens them.
 */
import { Kernel, Process } from './kernel';

export type AppId = 'terminal' | 'finder' | 'programs' | 'memory' | 'apqb' | 'activity' | 'settings' | 'qbnn';

export interface AppInfo {
  id: AppId;
  title: string;
  icon: string;
  description: string;
  defaultSize: { w: number; h: number };
}

export const APPS: Record<AppId, AppInfo> = {
  terminal: { id: 'terminal', title: 'Terminal', icon: '>_', description: 'qsh shell', defaultSize: { w: 560, h: 520 } },
  finder: { id: 'finder', title: 'Finder', icon: '🗂', description: 'QubitFS browser', defaultSize: { w: 520, h: 480 } },
  programs: { id: 'programs', title: 'Programs', icon: '▶', description: 'Run circuits and jobs', defaultSize: { w: 560, h: 620 } },
  memory: { id: 'memory', title: 'Qubit Memory', icon: '▦', description: 'APQB registers', defaultSize: { w: 560, h: 620 } },
  apqb: { id: 'apqb', title: 'APQB', icon: 'θ', description: 'Adjustable pseudo qubit inspector', defaultSize: { w: 480, h: 640 } },
  activity: { id: 'activity', title: 'Activity Monitor', icon: '◔', description: 'Processes, scheduler, kernel log', defaultSize: { w: 560, h: 520 } },
  settings: { id: 'settings', title: 'System Settings', icon: '⚙', description: 'sysctl and about', defaultSize: { w: 480, h: 520 } },
  qbnn: { id: 'qbnn', title: 'QBNN Lab', icon: '∿', description: 'Train QBNN layers', defaultSize: { w: 520, h: 600 } },
};

export const APP_ORDER: AppId[] = ['terminal', 'finder', 'programs', 'memory', 'apqb', 'qbnn', 'activity', 'settings'];

export interface OSWindow {
  id: number;
  app: AppId;
  title: string;
  pid: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Optional argument, e.g. a path for Finder or a program name for Programs. */
  arg?: string;
}

export class WindowManager {
  kernel: Kernel;
  windows: OSWindow[] = [];
  private nextId = 1;
  private nextZ = 1;
  /** Desktop area the windows are laid out in. */
  area = { w: 800, h: 600 };
  listeners = new Set<() => void>();

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    kernel.wm = this;
    kernel.subscribe(() => this.reap());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  setArea(w: number, h: number): void {
    if (w === this.area.w && h === this.area.h) return;
    this.area = { w, h };
    for (const win of this.windows) this.clamp(win);
    this.notify();
  }

  private clamp(win: OSWindow): void {
    const margin = 24;
    win.w = Math.min(win.w, this.area.w - 8);
    win.h = Math.min(win.h, this.area.h - 8);
    win.x = Math.max(4 - win.w + margin * 3, Math.min(win.x, this.area.w - margin * 3));
    win.y = Math.max(0, Math.min(win.y, this.area.h - margin));
  }

  get focused(): OSWindow | null {
    const visible = this.windows.filter((w) => !w.minimized);
    if (!visible.length) return null;
    return visible.reduce((a, b) => (b.z > a.z ? b : a));
  }

  find(id: number): OSWindow | undefined {
    return this.windows.find((w) => w.id === id);
  }

  byApp(app: AppId): OSWindow[] {
    return this.windows.filter((w) => w.app === app);
  }

  /** Open a window (spawning a GUI service process); reuses an existing one unless `fresh`. */
  open(app: AppId, arg?: string, fresh = false): OSWindow {
    const info = APPS[app];
    if (!info) throw new Error(`unknown app: ${app}`);
    if (!fresh) {
      const existing = this.byApp(app)[0];
      if (existing) {
        if (arg !== undefined) existing.arg = arg;
        existing.minimized = false;
        this.focus(existing.id);
        return existing;
      }
    }
    const proc = this.kernel.spawnService(`gui:${app}`, arg ? [arg] : []);
    const n = this.windows.length;
    const small = this.area.w < 600;
    const w = small ? this.area.w - 12 : Math.min(info.defaultSize.w, this.area.w - 40);
    const h = small ? this.area.h - 16 : Math.min(info.defaultSize.h, this.area.h - 40);
    const win: OSWindow = {
      id: this.nextId++, app, title: info.title, pid: proc.pid,
      x: small ? 6 : 24 + (n % 6) * 28, y: small ? 8 : 16 + (n % 6) * 28, w, h,
      z: this.nextZ++, minimized: false, maximized: small, arg,
    };
    this.clamp(win);
    this.windows.push(win);
    this.kernel.log(`wm: open window ${win.id} ${info.title} (pid ${proc.pid})`);
    this.notify();
    this.kernel.notify();
    return win;
  }

  focus(id: number): void {
    const win = this.find(id);
    if (!win) return;
    win.minimized = false;
    if (this.focused?.id !== id) win.z = this.nextZ++;
    this.notify();
  }

  close(id: number): void {
    const win = this.find(id);
    if (!win) return;
    this.windows = this.windows.filter((w) => w.id !== id);
    const proc = this.kernel.processes.get(win.pid);
    if (proc && proc.state === 'running') this.kernel.sysKill(win.pid);
    this.kernel.log(`wm: close window ${id} ${win.title}`);
    this.notify();
    this.kernel.notify();
  }

  closeApp(app: AppId): void {
    for (const w of this.byApp(app)) this.close(w.id);
  }

  minimize(id: number): void {
    const win = this.find(id);
    if (!win) return;
    win.minimized = true;
    this.notify();
  }

  toggleMaximize(id: number): void {
    const win = this.find(id);
    if (!win) return;
    win.maximized = !win.maximized;
    this.focus(id);
  }

  move(id: number, dx: number, dy: number): void {
    const win = this.find(id);
    if (!win || win.maximized) return;
    win.x += dx;
    win.y += dy;
    this.clamp(win);
    this.notify();
  }

  setTitle(id: number, title: string): void {
    const win = this.find(id);
    if (win && win.title !== title) {
      win.title = title;
      this.notify();
    }
  }

  /** Close windows whose service process was killed from the shell. */
  private reap(): void {
    let changed = false;
    for (const win of [...this.windows]) {
      const proc = this.kernel.processes.get(win.pid);
      if (proc && proc.state !== 'running') {
        this.windows = this.windows.filter((w) => w.id !== win.id);
        this.kernel.log(`wm: window ${win.id} ${win.title} closed (pid ${win.pid} ${proc.state})`);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  list(): string[] {
    return this.windows.map((w) => `${String(w.id).padStart(3)}  pid ${String(w.pid).padStart(3)}  ${w.title.padEnd(16)} ${w.minimized ? 'minimized' : this.focused?.id === w.id ? 'focused' : ''}${w.arg ? `  ${w.arg}` : ''}`);
  }
}
