import { Kernel } from '../src/os/kernel';
import { Shell } from '../src/os/shell';
import { InstallHost, InstallPromptEvent, WebInstaller, detectPlatform, launchTarget, manualSteps } from '../src/os/webinstall';

/** A stand-in for `window`: records listeners so tests can fire browser events by hand. */
class FakeHost implements InstallHost {
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  navigator: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number };
  displayMode: string | null;
  __qubitos: { installPrompt?: InstallPromptEvent | null; installed?: boolean; offlineReady?: boolean } = {};

  constructor(opts: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number; displayMode?: string | null } = {}) {
    this.navigator = { userAgent: opts.userAgent ?? CHROME_WIN, standalone: opts.standalone, maxTouchPoints: opts.maxTouchPoints ?? 0 };
    this.displayMode = opts.displayMode ?? null;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  matchMedia = (query: string) => ({ matches: this.displayMode !== null && query === `(display-mode: ${this.displayMode})` });

  emit(type: string, event: unknown = {}): void {
    for (const l of this.listeners[type] ?? []) l(event);
  }
}

/** A `beforeinstallprompt` event that answers with `outcome`. */
function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const calls = { prevented: 0, prompted: 0 };
  const event: InstallPromptEvent = {
    preventDefault: () => { calls.prevented += 1; },
    prompt: async () => { calls.prompted += 1; },
    userChoice: Promise.resolve({ outcome }),
  };
  return { event, calls };
}

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0';
const ELECTRON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) QubitOS/1.0.0 Chrome/152.0.0.0 Electron/44.4.2 Safari/537.36';

describe('browser detection', () => {
  test('recognises the families that install differently', () => {
    expect(detectPlatform(CHROME_WIN)).toBe('chromium');
    expect(detectPlatform(EDGE)).toBe('chromium');
    expect(detectPlatform(IPHONE)).toBe('ios');
    expect(detectPlatform(IPAD, 5)).toBe('ios'); // iPadOS claims to be a Mac
    expect(detectPlatform(MAC_SAFARI, 0)).toBe('safari');
    expect(detectPlatform(FIREFOX)).toBe('firefox');
    expect(detectPlatform(ELECTRON)).toBe('electron'); // before Chrome: the UA carries both
    expect(detectPlatform(undefined)).toBe('other');
  });

  test('manual steps exist for every browser, and none once installed', () => {
    for (const p of ['chromium', 'ios', 'safari', 'firefox', 'other'] as const) {
      expect(manualSteps(p, false)).toBeTruthy();
      expect(manualSteps(p, true)).toBeNull();
    }
    expect(manualSteps('ios', false)).toMatch(/Home Screen/);
  });
});

describe('launch shortcuts', () => {
  test('?app=<id> picks the window to open', () => {
    expect(launchTarget('?app=terminal')).toBe('terminal');
    expect(launchTarget('?utm=x&app=qbnn')).toBe('qbnn');
    expect(launchTarget('?app=app%3Abell-lab')).toBe('app:bell-lab');
    expect(launchTarget('?app=')).toBeNull();
    expect(launchTarget('?app=../etc/passwd')).toBeNull();
    expect(launchTarget('')).toBeNull();
    expect(launchTarget(undefined)).toBeNull();
  });
});

describe('WebInstaller', () => {
  test('off the web there is nothing to install', async () => {
    const inst = new WebInstaller(null);
    const s = inst.status();
    expect(s.supported).toBe(false);
    expect(s.promptable).toBe(false);
    expect(s.manual).toBeNull();
    expect(inst.summary()).toMatch(/native build/);
    expect(await inst.install()).toBe('unavailable');
  });

  test('a browser prompt becomes installable, and installing consumes it', async () => {
    const host = new FakeHost();
    const inst = new WebInstaller(host);
    const seen: number[] = [];
    inst.subscribe(() => seen.push(1));
    expect(inst.status().promptable).toBe(false);
    expect(inst.status().manual).toMatch(/address bar/);

    const { event, calls } = promptEvent('accepted');
    host.emit('beforeinstallprompt', event);
    expect(calls.prevented).toBe(1); // the browser's own mini-infobar is suppressed
    expect(inst.status().promptable).toBe(true);
    expect(inst.status().manual).toBeNull();
    expect(seen.length).toBeGreaterThan(0);

    expect(await inst.install()).toBe('accepted');
    expect(calls.prompted).toBe(1);
    expect(inst.status().installed).toBe(true);
    expect(inst.status().promptable).toBe(false);
    expect(await inst.install()).toBe('installed'); // the event is single-use
  });

  test('a dismissed prompt leaves the app uninstalled', async () => {
    const host = new FakeHost();
    const inst = new WebInstaller(host);
    host.emit('beforeinstallprompt', promptEvent('dismissed').event);
    expect(await inst.install()).toBe('dismissed');
    expect(inst.status().installed).toBe(false);
    expect(inst.status().promptable).toBe(false);
    expect(inst.status().lastOutcome).toBe('dismissed');
  });

  test('a prompt captured by the HTML bootstrap before boot is still usable', async () => {
    const host = new FakeHost();
    const { event } = promptEvent('accepted');
    host.__qubitos.installPrompt = event;
    const inst = new WebInstaller(host);
    expect(inst.status().promptable).toBe(true);
    expect(await inst.install()).toBe('accepted');
  });

  test('the Windows desktop app is already installed', () => {
    const inst = new WebInstaller(new FakeHost({ userAgent: ELECTRON }));
    const s = inst.status();
    expect(s.platform).toBe('electron');
    expect(s.installed).toBe(true);
    expect(s.promptable).toBe(false);
    expect(s.manual).toBeNull();
    expect(inst.summary()).toMatch(/desktop app/);
  });

  test('running standalone counts as installed', () => {
    const inst = new WebInstaller(new FakeHost({ displayMode: 'standalone' }));
    expect(inst.status().standalone).toBe(true);
    expect(inst.status().installed).toBe(true);
    expect(inst.summary()).toMatch(/installed app/);
  });

  test('iOS home-screen apps report themselves through navigator.standalone', () => {
    const inst = new WebInstaller(new FakeHost({ userAgent: IPHONE, standalone: true }));
    expect(inst.status().installed).toBe(true);
    expect(inst.status().platform).toBe('ios');
  });

  test('the appinstalled event and the worker are picked up', () => {
    const host = new FakeHost();
    const inst = new WebInstaller(host);
    host.emit('beforeinstallprompt', promptEvent().event);
    host.emit('appinstalled');
    expect(inst.status().installed).toBe(true);
    expect(inst.status().promptable).toBe(false);
    expect(inst.status().offlineReady).toBe(false);
    host.emit('qubitos:offlineready');
    expect(inst.status().offlineReady).toBe(true);
    expect(inst.summary()).toMatch(/offline ready/);
  });

  test('fromGlobal tolerates a world without a window', () => {
    expect(WebInstaller.fromGlobal(undefined).status().supported).toBe(false);
    expect(WebInstaller.fromGlobal({}).status().supported).toBe(false);
    expect(WebInstaller.fromGlobal(new FakeHost()).status().supported).toBe(true);
  });
});

describe('qsh install command', () => {
  function shell(host: InstallHost | null) {
    const lines: string[] = [];
    const k = new Kernel({ numQubits: 4, seed: 1, webInstall: new WebInstaller(host) });
    return { k, sh: new Shell(k, (l) => lines.push(l)), lines, text: () => lines.join('\n') };
  }

  test('install --status reports what the browser offers', () => {
    const host = new FakeHost();
    const { sh, text } = shell(host);
    sh.executeLine('install --status');
    expect(text()).toMatch(/promptable=false/);
    expect(text()).toMatch(/browser=chromium/);
  });

  test('install runs the browser prompt and reports the outcome', async () => {
    const host = new FakeHost();
    const { sh, k, text } = shell(host);
    host.emit('beforeinstallprompt', promptEvent('accepted').event);
    sh.executeLine('install');
    await sh.pending;
    expect(text()).toMatch(/installing QubitOS/i);
    expect(k.webInstall.status().installed).toBe(true);
    expect(k.sysDmesg(200).join('\n')).toMatch(/install:/);
  });

  test('install explains itself when the browser offers no prompt', async () => {
    const { sh, text } = shell(new FakeHost({ userAgent: IPHONE }));
    sh.executeLine('install');
    await sh.pending;
    expect(text()).toMatch(/did not offer an install prompt/);
    expect(text()).toMatch(/Home Screen/);
  });

  test('install is a no-op once QubitOS is already installed', () => {
    const { sh, text } = shell(new FakeHost({ displayMode: 'standalone' }));
    sh.executeLine('install');
    expect(text()).toMatch(/already installed/);
  });

  test('the native build says so instead of pretending', () => {
    const { sh, text } = shell(null);
    sh.executeLine('install');
    expect(text()).toMatch(/already a native app/);
  });
});
