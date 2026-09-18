/**
 * Installing QubitOS itself, from the web.
 *
 * The exported web build is a progressive web app: `public/manifest.webmanifest` describes it,
 * `public/sw.js` caches the shell so it launches offline, and browsers fire `beforeinstallprompt`
 * when the page qualifies for installation. The bootstrap in `public/index.html` stashes that event
 * on `window.__qubitos` before React mounts, so the prompt is still replayable when the desktop
 * asks for it (the event is only offered once, and the app boots after it fires).
 *
 * The host object is injected rather than read from the global scope, so the kernel can build one
 * under node (tests) or on native, where there is no window and installing is a no-op.
 */

/** The `beforeinstallprompt` event, reduced to what we use. */
export interface InstallPromptEvent {
  preventDefault?: () => void;
  prompt: () => Promise<unknown>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** The slice of `window` the installer needs. */
export interface InstallHost {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number; serviceWorker?: unknown };
  /** Set by the bootstrap script in public/index.html. */
  __qubitos?: { installPrompt?: InstallPromptEvent | null; installed?: boolean; offlineReady?: boolean };
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable' | 'installed';

/** Which manual steps to show when the browser has no programmatic install prompt. */
export type InstallPlatform = 'chromium' | 'ios' | 'safari' | 'firefox' | 'electron' | 'other' | 'none';

export interface InstallStatus {
  /** There is a browser to install into (false on native, where the app is already an app). */
  supported: boolean;
  /** A `beforeinstallprompt` event is held and can be replayed right now. */
  promptable: boolean;
  /** Running as an installed app, or installed during this session. */
  installed: boolean;
  /** Launched in a standalone window (installed app) rather than a browser tab. */
  standalone: boolean;
  /** The service worker that makes the installed app work offline is registered. */
  offlineReady: boolean;
  platform: InstallPlatform;
  /** Manual steps, when the browser will not show a prompt of its own. */
  manual: string | null;
  lastOutcome: InstallOutcome | null;
}

/** Display modes that mean "launched as an installed app". */
const STANDALONE_MODES = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];

/** Guess the browser family from a user agent string, for the manual install instructions. */
export function detectPlatform(ua: string | undefined, maxTouchPoints = 0): InstallPlatform {
  if (!ua) return 'other';
  const s = ua.toLowerCase();
  // The desktop build is already an installed app, and must be recognised first: its user agent
  // carries Chrome's too.
  if (/electron/.test(s)) return 'electron';
  // iPadOS 13+ claims to be a Mac; a touch-capable "Mac" is an iPad.
  const ios = /iphone|ipad|ipod/.test(s) || (/macintosh/.test(s) && maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/firefox|fxios/.test(s)) return 'firefox';
  if (/edg\/|edga|chrome|chromium|crios|samsungbrowser|opr\//.test(s)) return 'chromium';
  if (/safari/.test(s)) return 'safari';
  return 'other';
}

/** What to tell the user when we cannot open the install dialog ourselves. */
export function manualSteps(platform: InstallPlatform, installed: boolean): string | null {
  if (installed) return null;
  switch (platform) {
    case 'electron':
      return null; // the desktop app is the installed app
    case 'ios':
      return 'In Safari, tap Share, then "Add to Home Screen".';
    case 'safari':
      return 'In Safari, choose File → "Add to Dock".';
    case 'firefox':
      return 'Firefox cannot install web apps; open this page in Chrome, Edge or Safari to install it.';
    case 'chromium':
      return 'Use the install icon in the address bar, or the browser menu → "Install QubitOS".';
    default:
      return 'Look for "Install" or "Add to Home Screen" in the browser menu.';
  }
}

/**
 * The app to open at boot, from `?app=<id>` — how the manifest's shortcuts (right-click the
 * installed app's icon) and plain bookmarks ask for a specific window.
 */
export function launchTarget(search: string | undefined | null): string | null {
  if (!search) return null;
  const m = /[?&]app=([^&#]+)/.exec(search);
  if (!m) return null;
  const id = decodeURIComponent(m[1]).trim();
  return /^(app:)?[a-z0-9_-]+$/i.test(id) ? id : null;
}

export class WebInstaller {
  readonly host: InstallHost | null;
  private deferred: InstallPromptEvent | null = null;
  private sessionInstalled = false;
  private listeners = new Set<() => void>();
  lastOutcome: InstallOutcome | null = null;
  /** True once the service worker that makes the installed app work offline is registered. */
  offlineReady = false;

  constructor(host: InstallHost | null = null) {
    this.host = host;
    if (!host) return;
    this.deferred = host.__qubitos?.installPrompt ?? null;
    this.sessionInstalled = Boolean(host.__qubitos?.installed);
    this.offlineReady = Boolean(host.__qubitos?.offlineReady);
    host.addEventListener('beforeinstallprompt', (e) => {
      const ev = e as InstallPromptEvent;
      ev.preventDefault?.();
      this.deferred = ev;
      this.notify();
    });
    // Dispatched by the bootstrap script when it captured the event before this listener existed.
    host.addEventListener('qubitos:installavailable', () => {
      this.deferred = host.__qubitos?.installPrompt ?? this.deferred;
      this.notify();
    });
    host.addEventListener('qubitos:offlineready', () => {
      this.offlineReady = true;
      this.notify();
    });
    host.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.sessionInstalled = true;
      this.lastOutcome = 'installed';
      this.notify();
    });
  }

  /** Build an installer for the current environment; null host (native / node) means "not installable". */
  static fromGlobal(g: unknown = typeof window === 'undefined' ? undefined : window): WebInstaller {
    const host = g as InstallHost | undefined;
    return new WebInstaller(host && typeof host.addEventListener === 'function' ? host : null);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** True when the page is running in an installed app window. */
  get standalone(): boolean {
    const host = this.host;
    if (!host) return false;
    if (host.navigator?.standalone === true) return true; // iOS home-screen app
    const mm = host.matchMedia;
    if (!mm) return false;
    return STANDALONE_MODES.some((m) => {
      try {
        return Boolean(mm.call(host, `(display-mode: ${m})`)?.matches);
      } catch {
        return false;
      }
    });
  }

  get platform(): InstallPlatform {
    if (!this.host) return 'none';
    return detectPlatform(this.host.navigator?.userAgent, this.host.navigator?.maxTouchPoints ?? 0);
  }

  get installed(): boolean {
    return this.standalone || this.platform === 'electron' || this.sessionInstalled || Boolean(this.host?.__qubitos?.installed);
  }

  /** True when `install()` can open the browser's install dialog right now. */
  get promptable(): boolean {
    return Boolean(this.deferred) && !this.installed;
  }

  status(): InstallStatus {
    const installed = this.installed;
    const platform = this.platform;
    return {
      supported: Boolean(this.host),
      promptable: this.promptable,
      installed,
      standalone: this.standalone,
      offlineReady: this.offlineReady,
      platform,
      manual: this.promptable || !this.host ? null : manualSteps(platform, installed),
      lastOutcome: this.lastOutcome,
    };
  }

  /** One line for dmesg / `install --status`. */
  summary(): string {
    const s = this.status();
    if (!s.supported) return 'install: native build — already an installed app';
    if (s.platform === 'electron') return 'install: running as the QubitOS desktop app';
    if (s.installed) return `install: running as an installed app${s.offlineReady ? ' (offline ready)' : ''}`;
    if (s.promptable) return 'install: available — run `install` or use System Settings';
    return `install: no prompt from this browser (${s.platform})${s.manual ? ` — ${s.manual}` : ''}`;
  }

  /**
   * Replay the browser's install prompt. The event may only be used once: on any answer the
   * browser discards it, and fires a fresh one later if the app still qualifies.
   */
  async install(): Promise<InstallOutcome> {
    const ev = this.deferred;
    if (this.installed) {
      this.lastOutcome = 'installed';
      this.notify();
      return 'installed';
    }
    if (!ev) {
      this.lastOutcome = 'unavailable';
      this.notify();
      return 'unavailable';
    }
    this.deferred = null;
    this.notify();
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      const outcome: InstallOutcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
      this.lastOutcome = outcome;
      if (outcome === 'accepted') this.sessionInstalled = true;
      return outcome;
    } catch {
      this.lastOutcome = 'unavailable';
      return 'unavailable';
    } finally {
      this.notify();
    }
  }
}
