import fs from 'node:fs/promises';
import path from 'node:path';
import type { Clock, JobQueue, ObjectStore } from './ports.js';

export class FsObjectStore implements ObjectStore {
  constructor(private root: string) {}
  private p(key: string) {
    return path.join(this.root, key.replace(/\.\./g, ''));
  }
  async put(key: string, body: ArrayBuffer | Uint8Array | string, contentType?: string) {
    const file = this.p(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof body === 'string' ? body : Buffer.from(body as Uint8Array));
    if (contentType) await fs.writeFile(file + '.meta', contentType);
  }
  async get(key: string) {
    try {
      const file = this.p(key);
      const buf = await fs.readFile(file);
      let contentType: string | undefined;
      try {
        contentType = await fs.readFile(file + '.meta', 'utf8');
      } catch {
        /* none */
      }
      return { body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
  async list(prefix: string) {
    const dir = this.p(prefix);
    try {
      const entries = await fs.readdir(dir, { recursive: true });
      return entries.filter((e) => !e.endsWith('.meta')).map((e) => path.posix.join(prefix, e.split(path.sep).join('/')));
    } catch {
      return [];
    }
  }
}

export class MemoryObjectStore implements ObjectStore {
  private m = new Map<string, { body: ArrayBuffer; contentType?: string }>();
  async put(key: string, body: ArrayBuffer | Uint8Array | string, contentType?: string) {
    const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const ab = b instanceof Uint8Array ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b;
    this.m.set(key, { body: ab as ArrayBuffer, contentType });
  }
  async get(key: string) {
    return this.m.get(key) ?? null;
  }
  async delete(key: string) {
    this.m.delete(key);
  }
  async list(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** In-process queue: runs registered job handlers on a timer. */
export class InProcessQueue implements JobQueue {
  private handlers = new Map<string, (payload: Record<string, unknown>) => Promise<void>>();
  private pending: Array<{ name: string; payload: Record<string, unknown>; at: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  on(name: string, handler: (payload: Record<string, unknown>) => Promise<void>) {
    this.handlers.set(name, handler);
  }
  async enqueue(name: string, payload: Record<string, unknown>, opts?: { delaySeconds?: number }) {
    this.pending.push({ name, payload, at: Date.now() + (opts?.delaySeconds ?? 0) * 1000 });
    this.schedule();
  }
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, 10);
  }
  async drain() {
    const now = Date.now();
    const ready = this.pending.filter((j) => j.at <= now);
    this.pending = this.pending.filter((j) => j.at > now);
    for (const j of ready) {
      const h = this.handlers.get(j.name);
      if (h) {
        try {
          await h(j.payload);
        } catch (e) {
          console.error('job failed', j.name, e);
        }
      }
    }
    if (this.pending.length) this.schedule();
  }
}

export const systemClock: Clock = { now: () => new Date() };
