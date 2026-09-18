/**
 * QubitOS network stack: a thin, logged wrapper over fetch().
 * Every request is recorded (Activity Monitor "Network") and written to dmesg.
 */
import type { Kernel } from './kernel';
import { KernelError } from './util';

export interface NetRecord {
  id: number;
  method: string;
  url: string;
  status: number | null;
  bytes: number;
  ms: number;
  error?: string;
  at: number;
}

export interface FetchOptions {
  method?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  body?: string;
}

export class NetStack {
  kernel: Kernel;
  history: NetRecord[] = [];
  private nextId = 1;
  /** Injectable for tests / offline mode. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  get enabled(): boolean {
    return Boolean(this.kernel.sysctl['net.enabled']);
  }

  private record(r: NetRecord): void {
    this.history.push(r);
    if (this.history.length > 200) this.history.shift();
    this.kernel.log(`net: ${r.method} ${r.url} -> ${r.error ? `error (${r.error})` : `${r.status} ${r.bytes}B ${r.ms}ms`}`);
    this.kernel.notify();
  }

  /** GET/HEAD with a couple of retries on transport errors (flaky mobile links, proxies). */
  async request(url: string, opts: FetchOptions = {}): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    if (!this.enabled) throw new KernelError('network is disabled (sysctl net.enabled false)');
    if (!/^https?:\/\//i.test(url)) throw new KernelError(`unsupported URL: ${url}`);
    const retries = Math.max(0, Number(this.kernel.sysctl['net.retries'] ?? 2));
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.requestOnce(url, opts);
      } catch (e) {
        last = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/network error/.test(msg) || attempt === retries) throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw last;
  }

  private async requestOnce(url: string, opts: FetchOptions): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    const rec: NetRecord = { id: this.nextId++, method: opts.method ?? 'GET', url, status: null, bytes: 0, ms: 0, at: Date.now() };
    const t0 = Date.now();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? Number(this.kernel.sysctl['net.timeout_ms'] ?? 15000)) : null;
    try {
      const res = await this.fetchImpl(url, { method: rec.method, headers: opts.headers, body: opts.body, signal: controller?.signal });
      const text = await res.text();
      rec.status = res.status;
      rec.bytes = text.length;
      rec.ms = Date.now() - t0;
      const headers: Record<string, string> = {};
      res.headers?.forEach?.((v, k) => (headers[k] = v));
      this.record(rec);
      return { status: res.status, text, headers };
    } catch (e) {
      rec.ms = Date.now() - t0;
      rec.error = e instanceof Error ? e.message : String(e);
      this.record(rec);
      throw new KernelError(`network error: ${rec.error}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
    const r = await this.request(url, opts);
    if (r.status >= 400) throw new KernelError(`HTTP ${r.status} for ${url}`);
    return r.text;
  }

  async fetchJSON<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
    return JSON.parse(await this.fetchText(url, opts)) as T;
  }
}
