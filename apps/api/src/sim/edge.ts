/**
 * Edge Gateway fleet simulator (demo only): heartbeats, offline and UPS states, store-and-forward backlog.
 * Mounted at /api/sim/edge. Mirrors the behaviour described in docs/07 §5 and docs/processes/11 §3.3.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import type { AppEnv } from '../kernel/context.js';
import { emitDirect } from '../kernel/events.js';
import { registerSim } from './index.js';
import type { Services } from '../kernel/ports.js';

const routes = new Hono<AppEnv>();

async function gateway(services: Services, siteId: string) {
  const [gw] = await services.db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.siteId, siteId)).limit(1);
  return gw ?? null;
}

/** Fleet snapshot with derived health. */
routes.get('/status', async (c) => {
  const services = c.get('services');
  const gws = await services.db.select().from(schema.edgeGateways);
  const sites = await services.db.select().from(schema.sites);
  const now = Date.now();
  return c.json({
    gateways: gws.map((g) => ({
      id: g.id, siteId: g.siteId, site: sites.find((s) => s.id === g.siteId)?.name ?? g.siteId, status: g.status,
      heartbeatAgeSeconds: g.lastHeartbeatAt ? Math.round((now - new Date(g.lastHeartbeatAt).getTime()) / 1000) : null,
      tunnelMs: g.tunnelMs, backlogStudies: g.backlogStudies, diskPct: g.diskPct, upsPct: g.upsPct, upsMinutesLeft: g.upsMinutesLeft,
      stateMinutes: g.stateSince ? Math.round((now - new Date(g.stateSince).getTime()) / 60000) : null,
    })),
  });
});

/** Heartbeat from a gateway: refreshes the timestamp and drains a little backlog when online. */
routes.post('/heartbeat', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ siteId: z.string(), tunnelMs: z.number().int().optional(), diskPct: z.number().int().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const gw = await gateway(services, parsed.data.siteId);
  if (!gw) return c.json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();
  const drained = gw.status === 'online' ? Math.min(gw.backlogStudies, 5) : 0;
  await services.db.update(schema.edgeGateways).set({
    lastHeartbeatAt: now, tunnelMs: parsed.data.tunnelMs ?? gw.tunnelMs, diskPct: parsed.data.diskPct ?? gw.diskPct,
    backlogStudies: gw.backlogStudies - drained, updatedAt: now,
  }).where(eq(schema.edgeGateways.id, gw.id));
  return c.json({ ok: true, at: now, drained, backlog: gw.backlogStudies - drained });
});

/** Take a site offline, put it on UPS, or bring it back; offline accumulates store-and-forward backlog. */
routes.post('/state', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ siteId: z.string(), state: z.enum(['online', 'offline', 'on_ups']), backlog: z.number().int().min(0).optional(), upsPct: z.number().int().min(0).max(100).optional(), note: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  const { siteId, state, backlog, upsPct, note } = parsed.data;
  const gw = await gateway(services, siteId);
  if (!gw) return c.json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();
  const nextBacklog = backlog ?? (state === 'offline' ? Math.max(gw.backlogStudies, 12) : state === 'online' ? 0 : gw.backlogStudies);
  await services.db.update(schema.edgeGateways).set({
    status: state, stateSince: state === gw.status ? gw.stateSince : now,
    lastHeartbeatAt: state === 'offline' ? gw.lastHeartbeatAt : now,
    backlogStudies: nextBacklog,
    upsPct: upsPct ?? (state === 'on_ups' ? 88 : state === 'offline' ? 71 : 100),
    upsMinutesLeft: state === 'online' ? null : Math.round(((upsPct ?? (state === 'on_ups' ? 88 : 71)) / 100) * 180),
    tunnelMs: state === 'offline' ? null : gw.tunnelMs ?? 12,
    note: note ?? (state === 'offline' ? 'Local worklist mirror serving the technologist; STAT forwarded first on link return' : state === 'on_ups' ? 'In a published load-shedding window; generator covers X-ray and ultrasound' : null),
    updatedAt: now,
  }).where(eq(schema.edgeGateways.id, gw.id));
  await emitDirect(services, 'edge.gateway.status.v1', { gatewayId: gw.id, siteId, from: gw.status, to: state, backlog: nextBacklog }, { practiceId: gw.practiceId, aggregateType: 'edge_gateway', aggregateId: gw.id });
  if (state === 'offline') {
    const feeds = await services.db.select().from(schema.integrationFeeds).where(and(eq(schema.integrationFeeds.siteId, siteId)));
    for (const f of feeds) await services.db.update(schema.integrationFeeds).set({ status: 'down', lastError: 'Site gateway offline', updatedAt: now }).where(eq(schema.integrationFeeds.id, f.id));
  }
  if (state === 'online') {
    const feeds = await services.db.select().from(schema.integrationFeeds).where(and(eq(schema.integrationFeeds.siteId, siteId)));
    for (const f of feeds) await services.db.update(schema.integrationFeeds).set({ status: 'healthy', lastError: null, lastMessageAt: now, updatedAt: now }).where(eq(schema.integrationFeeds.id, f.id));
  }
  return c.json({ ok: true, siteId, state, backlog: nextBacklog });
});

/** Drain the store-and-forward backlog (link returns); STAT first, a batch at a time. */
routes.post('/drain', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ siteId: z.string(), batch: z.number().int().min(1).max(200).default(10) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const gw = await gateway(services, parsed.data.siteId);
  if (!gw) return c.json({ error: 'not_found' }, 404);
  if (gw.status === 'offline') return c.json({ error: 'offline', message: 'The gateway is offline; the backlog drains when the link returns' }, 409);
  const drained = Math.min(gw.backlogStudies, parsed.data.batch);
  const remaining = gw.backlogStudies - drained;
  const now = new Date().toISOString();
  await services.db.update(schema.edgeGateways).set({ backlogStudies: remaining, lastHeartbeatAt: now, updatedAt: now }).where(eq(schema.edgeGateways.id, gw.id));
  if (remaining === 0) await emitDirect(services, 'edge.backlog.cleared.v1', { gatewayId: gw.id, siteId: gw.siteId, drained }, { practiceId: gw.practiceId, aggregateType: 'edge_gateway', aggregateId: gw.id });
  return c.json({ ok: true, drained, remaining });
});

/** Push a telemetry reading through the gateway (tube arc counts, helium, error codes). */
routes.post('/telemetry', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ assetId: z.string(), metric: z.string(), value: z.number().optional(), textValue: z.string().optional(), count: z.number().int().min(1).max(50).default(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const { assetId, metric, value, textValue, count } = parsed.data;
  const [asset] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
  if (!asset) return c.json({ error: 'not_found' }, 404);
  for (let i = 0; i < count; i++) {
    await services.db.insert(schema.telemetry).values({
      id: newId('tel'), practiceId: asset.practiceId, siteId: asset.siteId, assetId, metric,
      value: value ?? null, textValue: textValue ?? null, source: 'sim', at: new Date(Date.now() - i * 3600000).toISOString(),
    });
  }
  const { evaluatePredictive } = await import('../modules/m18-assets/index.js');
  const signal = await evaluatePredictive(services, assetId);
  if (signal && (signal.level === 'warn' || signal.level === 'crit')) {
    await emitDirect(services, 'telemetry.alarm.v1', { assetId, siteId: asset.siteId, metric, level: signal.level, signal: signal.signal, riskPct: signal.riskPct }, { practiceId: asset.practiceId, aggregateType: 'asset', aggregateId: assetId });
  }
  return c.json({ ok: true, inserted: count, signal });
});

/** Simulate a modality failure: emits modality.down.v1, which the Maintenance Hand consumes. */
routes.post('/fail', async (c) => {
  const services = c.get('services');
  const parsed = z.object({ assetId: z.string(), reason: z.string().default('heartbeat lost during operating hours') }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid' }, 400);
  const [asset] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, parsed.data.assetId)).limit(1);
  if (!asset) return c.json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();
  await services.db.update(schema.assets).set({ status: 'down', downtimeStartedAt: now, updatedAt: now }).where(eq(schema.assets.id, asset.id));
  if (asset.modalityId) await services.db.update(schema.modalities).set({ status: 'down', updatedAt: now }).where(eq(schema.modalities.id, asset.modalityId));
  await emitDirect(services, 'modality.down.v1', { modalityId: asset.modalityId ?? asset.id, assetId: asset.id, siteId: asset.siteId, type: asset.type, status: 'down', reason: parsed.data.reason }, { practiceId: asset.practiceId, aggregateType: 'asset', aggregateId: asset.id });
  return c.json({ ok: true, assetId: asset.id, emitted: 'modality.down.v1' });
});

let registered = false;
export function registerEdgeSim() {
  if (registered) return;
  registered = true;
  registerSim('edge', routes);
}
