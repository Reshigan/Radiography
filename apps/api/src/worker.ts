/// <reference types="@cloudflare/workers-types" />
import { createD1Db } from '@bonakala/db/d1';
import { createApp, bootModules } from './app.js';
import { createLlm } from './kernel/llm.js';
import type { JobQueue, ObjectStore, Services } from './kernel/ports.js';
import { dispatchPending } from './kernel/events.js';
import { modules } from './modules/index.js';
import { runJob } from './jobs.js';

interface Env {
  DB: D1Database;
  OBJECTS: R2Bucket;
  JOBS?: Queue;
  ANTHROPIC_API_KEY?: string;
  DEMO_MODE?: string;
  [k: string]: unknown;
}

class R2Store implements ObjectStore {
  constructor(private bucket: R2Bucket) {}
  async put(key: string, body: ArrayBuffer | Uint8Array | string, contentType?: string) {
    await this.bucket.put(key, body as any, { httpMetadata: contentType ? { contentType } : undefined });
  }
  async get(key: string) {
    const o = await this.bucket.get(key);
    if (!o) return null;
    return { body: await o.arrayBuffer(), contentType: o.httpMetadata?.contentType };
  }
  async delete(key: string) {
    await this.bucket.delete(key);
  }
  async list(prefix: string) {
    const r = await this.bucket.list({ prefix });
    return r.objects.map((o) => o.key);
  }
}

function makeServices(env: Env, ctx: ExecutionContext): Services {
  const queue: JobQueue = {
    enqueue: async (name, payload, opts) => {
      if (env.JOBS) await env.JOBS.send({ name, payload }, { delaySeconds: opts?.delaySeconds } as any);
      else ctx.waitUntil(runJob(name, payload, services));
    },
  };
  const services: Services = {
    db: createD1Db(env.DB),
    objects: new R2Store(env.OBJECTS),
    queue,
    clock: { now: () => new Date() },
    llm: createLlm(env as any),
    demoMode: env.DEMO_MODE !== 'false',
    env: env as any,
    defer: (p) => ctx.waitUntil(p),
  };
  return services;
}

const app = createApp((c) => makeServices(c.env as Env, c.executionCtx));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const services = makeServices(env, ctx);
    await bootModules(services);
    await dispatchPending(services);
    for (const m of modules) await m.tick?.(services);
  },
  async queue(batch: MessageBatch<{ name: string; payload: Record<string, unknown> }>, env: Env, ctx: ExecutionContext) {
    const services = makeServices(env, ctx);
    await bootModules(services);
    for (const msg of batch.messages) {
      try {
        await runJob(msg.body.name, msg.body.payload, services);
        msg.ack();
      } catch (e) {
        console.error(e);
        msg.retry();
      }
    }
  },
};
