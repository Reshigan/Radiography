import { createTestDb } from '@bonakala/db/node';
import { seedAll } from '@bonakala/db/seed';
import { createApp, bootModules } from '../src/app.js';
import { InProcessQueue, MemoryObjectStore, systemClock } from '../src/kernel/adapters-node.js';
import { createLlm } from '../src/kernel/llm.js';
import type { Services } from '../src/kernel/ports.js';
import { dispatchPending } from '../src/kernel/events.js';
import { registerJobs } from '../src/jobs.js';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  services: Services;
  /** Sign in as a demo persona; returns a cookie header. */
  login(email: string): Promise<string>;
  /** Authenticated JSON request helper. */
  call(cookie: string, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any }>;
  /** Flush outbox events and queued jobs. */
  flush(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  const db = await createTestDb();
  await seedAll(db);
  const queue = new InProcessQueue();
  const deferred: Promise<unknown>[] = [];
  const services: Services = {
    db, objects: new MemoryObjectStore(), queue, clock: systemClock, llm: createLlm({}), demoMode: true, env: {},
    defer: (p) => { deferred.push(p.catch(() => undefined)); },
  };
  registerJobs(queue, services);
  await bootModules(services);
  const app = createApp(() => services);
  const flush = async () => {
    await Promise.all(deferred.splice(0));
    await dispatchPending(services);
    await queue.drain();
    await dispatchPending(services);
  };
  return {
    app, services, flush,
    async login(email) {
      const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'bonakala-demo' }), headers: { 'content-type': 'application/json' } });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
      const setCookie = res.headers.get('set-cookie') ?? '';
      return setCookie.split(';')[0]!;
    },
    async call(cookie, method, path, body, headers = {}) {
      const res = await app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', cookie, ...headers } });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, json };
    },
  };
}
