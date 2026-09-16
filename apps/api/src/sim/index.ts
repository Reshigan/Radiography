import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';

/**
 * Simulators for demo mode: modalities, claims switch, funders, payments, WhatsApp.
 * Module builders mount their simulators here via registerSim(). Disabled when DEMO_MODE=false.
 */
export const simRoutes = new Hono<AppEnv>();
simRoutes.use('*', async (c, next) => {
  if (!c.get('services').demoMode) return c.json({ error: 'not_found' }, 404);
  await next();
});
simRoutes.get('/', (c) => c.json({ simulators: sims.map((s) => s.name) }));

const sims: Array<{ name: string; routes: Hono<AppEnv> }> = [];
export function registerSim(name: string, routes: Hono<AppEnv>) {
  sims.push({ name, routes });
  simRoutes.route(`/${name}`, routes);
}
