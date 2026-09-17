import { serve } from '@hono/node-server';
import { createNodeDb, prepareNodeDb } from '@bonakala/db/node';
import { createApp, bootModules } from './app.js';
import { FsObjectStore, InProcessQueue, systemClock } from './kernel/adapters-node.js';
import { createLlm } from './kernel/llm.js';
import type { Services } from './kernel/ports.js';
import { dispatchPending } from './kernel/events.js';
import { modules } from './modules/index.js';
import { registerJobs } from './jobs.js';
import { simClaimsSwitch } from './sim/switch.js';
import { simPaymentGateway } from './sim/psp.js';

export async function createNodeServices(env = process.env as Record<string, string | undefined>): Promise<Services> {
  const db = createNodeDb(env.DATABASE_URL ?? 'file:./data/bonakala.db');
  await prepareNodeDb(db);
  const queue = new InProcessQueue();
  const services: Services = {
    db,
    objects: new FsObjectStore(env.OBJECT_STORE_DIR ?? './data/objects'),
    queue,
    clock: systemClock,
    llm: createLlm(env),
    // Only a simulator exists for either port today — swap these two lines for a real adapter when one is built.
    claimsSwitch: simClaimsSwitch,
    paymentGateway: simPaymentGateway,
    demoMode: env.DEMO_MODE !== 'false',
    env,
    defer: (p) => setImmediate(() => void p.catch((e) => console.error('deferred failed', e))),
  };
  registerJobs(queue, services);
  return services;
}

const isMain = process.argv[1]?.endsWith('node.ts') || process.argv[1]?.endsWith('node.js');
if (isMain) {
  const services = await createNodeServices();
  await bootModules(services);
  const app = createApp(() => services);
  const port = Number(process.env.PORT ?? 8787);
  setInterval(() => void dispatchPending(services), 2000);
  setInterval(() => {
    for (const m of modules) void m.tick?.(services).catch((e) => console.error('tick failed', m.code, e));
  }, 30_000);
  serve({ fetch: app.fetch, port }, () => console.log(`Bonakala API on http://localhost:${port} (demo=${services.demoMode})`));
}
