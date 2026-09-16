/**
 * Load-shedding schedule simulator (demo only). Publishes outage windows per site so M05 can close
 * rooms, the Roster Hand can shift start times and BKG can see constraints before offering slots
 * (docs/processes/11 §3.8, M18-R-107). Mounted at /api/sim/loadshedding.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, todaySast } from '@bonakala/domain';
import type { AppEnv } from '../kernel/context.js';
import { emitDirect } from '../kernel/events.js';
import { registerSim } from './index.js';

const routes = new Hono<AppEnv>();

/** Which room types a site's generator covers. MRI without a generator is the highest-risk asset. */
const GENERATOR_COVER: Record<string, string[]> = {
  site_san: ['XR', 'US', 'CT', 'MG'],
  site_rbg: ['XR', 'US'],
  site_umh: ['XR', 'US', 'CT', 'MR', 'MG', 'DXA'],
  site_bal: [],
};

/** Stage → windows per day (illustrative blocks, two per day at higher stages). */
function windowsForStage(stage: number): Array<[string, string]> {
  if (stage <= 0) return [];
  if (stage <= 2) return [['12:00', '14:30']];
  if (stage <= 4) return [['14:00', '16:30']];
  return [['06:00', '08:30'], ['14:00', '16:30']];
}

routes.get('/status', async (c) => {
  const services = c.get('services');
  const rows = await services.db.select().from(schema.loadSheddingWindows).where(gte(schema.loadSheddingWindows.startsAt, new Date(Date.now() - 86400000).toISOString()));
  const sites = await services.db.select().from(schema.sites);
  const now = new Date().toISOString();
  return c.json({
    windows: rows.map((w) => ({ ...w, siteName: sites.find((s) => s.id === w.siteId)?.name ?? w.siteId, active: w.startsAt <= now && w.endsAt >= now })),
    generatorCover: GENERATOR_COVER,
    note: 'Illustrative schedule for the demo. In production a schedule connector or manual entry feeds these windows.',
  });
});

/** Publish (or clear) windows for a stage. Sites on UPS during their window are also updated. */
routes.post('/stage', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ stage: z.number().int().min(0).max(8), date: z.string().optional(), siteIds: z.array(z.string()).optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  const { stage } = parsed.data;
  const date = parsed.data.date ?? todaySast();
  const sites = await services.db.select().from(schema.sites);
  const targets = parsed.data.siteIds?.length ? sites.filter((s) => parsed.data.siteIds!.includes(s.id)) : sites;
  const existing = await services.db.select().from(schema.loadSheddingWindows).where(gte(schema.loadSheddingWindows.startsAt, `${date}T00:00:00.000Z`));
  for (const w of existing.filter((x) => targets.some((t) => t.id === x.siteId) && x.startsAt.slice(0, 10) === date)) {
    await services.db.delete(schema.loadSheddingWindows).where(eq(schema.loadSheddingWindows.id, w.id));
  }
  const created: Array<{ siteId: string; startsAt: string; endsAt: string }> = [];
  for (const site of targets) {
    for (const [from, to] of windowsForStage(stage)) {
      const id = newId('lsw');
      const startsAt = `${date}T${from}:00.000Z`;
      const endsAt = `${date}T${to}:00.000Z`;
      await services.db.insert(schema.loadSheddingWindows).values({ id, practiceId: site.practiceId, siteId: site.id, stage, startsAt, endsAt, generatorCovers: GENERATOR_COVER[site.id] ?? [], source: 'sim' });
      created.push({ siteId: site.id, startsAt, endsAt });
      await emitDirect(services, 'site.power.window.v1', { siteId: site.id, stage, startsAt, endsAt, generatorCovers: GENERATOR_COVER[site.id] ?? [] }, { practiceId: site.practiceId, aggregateType: 'site', aggregateId: site.id });
    }
  }
  return c.json({ ok: true, stage, date, windows: created, cleared: stage === 0 });
});

/** Put the sites whose window is running onto UPS (and back when it ends). */
routes.post('/apply', async (c) => {
  const services = c.get('services');
  const now = new Date().toISOString();
  const active = await services.db.select().from(schema.loadSheddingWindows).where(and(gte(schema.loadSheddingWindows.endsAt, now)));
  const gws = await services.db.select().from(schema.edgeGateways);
  const changed: Array<{ siteId: string; state: string }> = [];
  for (const gw of gws) {
    const inWindow = active.some((w) => w.siteId === gw.siteId && w.startsAt <= now && w.endsAt >= now);
    const next = inWindow ? 'on_ups' : gw.status === 'on_ups' ? 'online' : gw.status;
    if (next === gw.status) continue;
    await services.db.update(schema.edgeGateways).set({ status: next, stateSince: now, upsPct: next === 'on_ups' ? 88 : 100, upsMinutesLeft: next === 'on_ups' ? 158 : null, updatedAt: now }).where(eq(schema.edgeGateways.id, gw.id));
    await emitDirect(services, 'edge.gateway.status.v1', { gatewayId: gw.id, siteId: gw.siteId, from: gw.status, to: next, cause: 'load_shedding' }, { practiceId: gw.practiceId, aggregateType: 'edge_gateway', aggregateId: gw.id });
    changed.push({ siteId: gw.siteId, state: next });
  }
  return c.json({ ok: true, changed });
});

let registered = false;
export function registerLoadSheddingSim() {
  if (registered) return;
  registered = true;
  registerSim('loadshedding', routes);
}
