import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { newId, DomainError } from '@bonakala/domain';
import type { AppEnv } from './kernel/context.js';
import type { Services } from './kernel/ports.js';
import { loadUserFromRequest } from './kernel/auth.js';
import { modules } from './modules/index.js';
import { simRoutes } from './sim/index.js';

let booted = false;
export async function bootModules(services: Services) {
  if (booted) return;
  booted = true;
  for (const m of modules) await m.boot?.(services);
  if (services.demoMode) await ensureDemoSeed(services);
}

/** Demo environments seed themselves on first boot (idempotent, cheap check). */
async function ensureDemoSeed(services: Services) {
  const { schema } = await import('@bonakala/db');
  const rows = await services.db.select({ id: schema.legalEntities.id }).from(schema.legalEntities).limit(1);
  if (rows.length) return;
  const { seedAll } = await import('@bonakala/db/seed');
  const summary = await seedAll(services.db);
  console.log('demo seed', summary);
}

/** Build the Hono app. `getServices` resolves per request (Workers bind per request; Node uses a singleton). */
export function createApp(getServices: (c: any) => Services | Promise<Services>) {
  const app = new Hono<AppEnv>();
  app.use('*', cors({ origin: (o) => o ?? '*', credentials: true }));
  if (process.env.NODE_ENV !== 'test') app.use('*', logger());

  app.use('*', async (c, next) => {
    const services = await getServices(c);
    c.set('services', services);
    c.set('requestId', newId('req'));
    await bootModules(services);
    const { user, practiceId } = await loadUserFromRequest(c);
    c.set('user', user);
    c.set('practiceId', practiceId);
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, demo: c.get('services').demoMode, modules: modules.map((m) => m.code) }));

  for (const m of modules) app.route(`/api/${m.basePath}`, m.routes);
  app.route('/api/sim', simRoutes);

  app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));
  app.onError((err, c) => {
    const e = err as Error & { status?: number; code?: string; details?: unknown };
    const status = e instanceof DomainError ? e.status : (e.status ?? 500);
    const code = e instanceof DomainError ? e.code : (e.code ?? 'internal');
    if (status >= 500) console.error(err);
    return c.json({ error: code, message: e.message, details: e.details ?? (e instanceof DomainError ? e.details : undefined) }, status as any);
  });
  return app;
}
