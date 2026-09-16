import { z } from 'zod';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId, notFound, invalid, conflict, todaySast, Refused } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, emitDirect, requirePractice, registerHand, runHand, on, nextSequence } from '../../kernel/index.js';
import type { Services } from '../../kernel/ports.js';
import { registerEdgeSim } from '../../sim/edge.js';
import { registerLoadSheddingSim } from '../../sim/loadshedding.js';

const r = router();
const READERS = ['BIO', 'PRM', 'EXE', 'SUP', 'CMP', 'RAD', 'NUR', 'AIO'] as const;
const ENGINEERS = ['BIO', 'SUP', 'PRM'] as const;

export async function nextWorkOrderRef(services: Services, practiceId: string): Promise<string> {
  const yymm = todaySast().slice(2, 4) + todaySast().slice(5, 7);
  const n = await nextSequence(services, `WO:${practiceId}:${yymm}`);
  return `WO-${yymm}-${String(n).padStart(3, '0')}`;
}

/* ================= Fleet and gateways ================= */
r.get('/fleet', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const gws = await services.db.select().from(schema.edgeGateways).where(practiceId ? eq(schema.edgeGateways.practiceId, practiceId) : undefined).orderBy(asc(schema.edgeGateways.name));
  const sites = await services.db.select().from(schema.sites);
  const assets = await services.db.select().from(schema.assets).where(practiceId ? eq(schema.assets.practiceId, practiceId) : undefined);
  const now = Date.now();
  return c.json({
    gateways: gws.map((g) => {
      const site = sites.find((s) => s.id === g.siteId);
      const stateMinutes = g.stateSince ? Math.round((now - new Date(g.stateSince).getTime()) / 60000) : null;
      return {
        ...g, siteName: site?.name ?? g.siteId, stateMinutes,
        heartbeatAgeSeconds: g.lastHeartbeatAt ? Math.round((now - new Date(g.lastHeartbeatAt).getTime()) / 1000) : null,
        modalities: assets.filter((a) => a.siteId === g.siteId && a.kind === 'modality').length,
        modalitiesDown: assets.filter((a) => a.siteId === g.siteId && a.status === 'down').length,
      };
    }),
    summary: { online: gws.filter((g) => g.status === 'online').length, onUps: gws.filter((g) => g.status === 'on_ups').length, offline: gws.filter((g) => g.status === 'offline').length, backlog: gws.reduce((a, g) => a + g.backlogStudies, 0) },
  });
});
r.patch('/gateways/:id', allow(...ENGINEERS), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ status: z.enum(['online', 'offline', 'on_ups']).optional(), note: z.string().optional() }));
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.id, id)).limit(1);
  if (!row) throw notFound('Gateway');
  const now = new Date().toISOString();
  await services.db.update(schema.edgeGateways).set({ ...data, stateSince: data.status && data.status !== row.status ? now : row.stateSince, updatedAt: now }).where(eq(schema.edgeGateways.id, id));
  await audit(c, 'gateway.updated', { type: 'edge_gateway', id }, data);
  if (data.status && data.status !== row.status) await emit(c, 'edge.gateway.status.v1', { gatewayId: id, siteId: row.siteId, from: row.status, to: data.status }, { aggregateType: 'edge_gateway', aggregateId: id, practiceId: row.practiceId });
  return c.json({ ok: true });
});

/* ================= Devices ================= */
r.get('/devices', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const assets = await services.db.select().from(schema.assets).where(practiceId ? eq(schema.assets.practiceId, practiceId) : undefined).orderBy(asc(schema.assets.name));
  const sites = await services.db.select().from(schema.sites);
  const rooms = await services.db.select().from(schema.rooms);
  const wos = await services.db.select().from(schema.workOrders).where(sql`${schema.workOrders.status} not in ('done','cancelled')`);
  const today = todaySast();
  return c.json({
    devices: assets.map((a) => {
      const room = rooms.find((x) => x.id === a.roomId);
      return {
        ...a, siteName: sites.find((s) => s.id === a.siteId)?.name ?? a.siteId, roomName: room?.name ?? null,
        licenceNo: room?.licenceNo ?? null, licenceExpiry: room?.licenceExpiry ?? null,
        licenceDays: room?.licenceExpiry ? Math.round((new Date(room.licenceExpiry).getTime() - new Date(today).getTime()) / 86400000) : null,
        openWorkOrders: wos.filter((w) => w.assetId === a.id).map((w) => ({ id: w.id, ref: w.ref, type: w.type, status: w.status })),
      };
    }),
  });
});
r.get('/devices/:id', allow(...READERS), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const [a] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  if (!a) throw notFound('Asset');
  const tel = await services.db.select().from(schema.telemetry).where(eq(schema.telemetry.assetId, id)).orderBy(desc(schema.telemetry.at)).limit(200);
  const wos = await services.db.select().from(schema.workOrders).where(eq(schema.workOrders.assetId, id)).orderBy(desc(schema.workOrders.createdAt));
  const sessions = await services.db.select().from(schema.vendorAccessSessions).where(eq(schema.vendorAccessSessions.assetId, id)).orderBy(desc(schema.vendorAccessSessions.createdAt)).limit(10);
  const byMetric = new Map<string, Array<{ at: string; value: number | null; text: string | null }>>();
  for (const t of tel) byMetric.set(t.metric, [...(byMetric.get(t.metric) ?? []), { at: t.at, value: t.value, text: t.textValue }]);
  return c.json({ asset: a, telemetry: [...byMetric.entries()].map(([metric, points]) => ({ metric, points: points.slice().reverse() })), workOrders: wos, vendorSessions: sessions });
});
r.patch('/devices/:id', allow(...ENGINEERS), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ status: z.enum(['commissioning', 'in_service', 'restricted', 'down', 'maintenance', 'decommissioned']).optional(), reason: z.string().optional() }));
  const [row] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  if (!row) throw notFound('Asset');
  const now = new Date().toISOString();
  const nextStatus: string = data.status ?? row.status;
  await services.db.update(schema.assets).set({ status: nextStatus, downtimeStartedAt: nextStatus === 'down' ? now : data.status ? null : row.downtimeStartedAt, updatedAt: now }).where(eq(schema.assets.id, id));
  await audit(c, 'asset.status', { type: 'asset', id }, { from: row.status, to: data.status, reason: data.reason });
  if (data.status && row.modalityId) await emit(c, data.status === 'down' ? 'modality.down.v1' : 'asset.status.changed.v1', { modalityId: row.modalityId, assetId: id, siteId: row.siteId, type: row.type, status: data.status, reason: data.reason ?? null }, { aggregateType: 'asset', aggregateId: id, practiceId: row.practiceId });
  return c.json({ ok: true });
});

/* ================= Telemetry ================= */
r.post('/telemetry', allow('BIO', 'SUP', 'RAD'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ assetId: z.string(), metric: z.string(), value: z.number().optional(), textValue: z.string().optional(), unit: z.string().optional(), source: z.string().default('edge'), at: z.string().optional() }));
  const [a] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, data.assetId)).limit(1);
  if (!a) throw notFound('Asset');
  const id = newId('tel');
  await services.db.insert(schema.telemetry).values({ id, practiceId, siteId: a.siteId, assetId: data.assetId, metric: data.metric, value: data.value ?? null, textValue: data.textValue ?? null, unit: data.unit ?? null, source: data.source, at: data.at ?? new Date().toISOString() });
  const alarm = await evaluatePredictive(services, data.assetId);
  if (alarm?.level === 'crit' || alarm?.level === 'warn') {
    await emit(c, 'telemetry.alarm.v1', { assetId: data.assetId, siteId: a.siteId, metric: data.metric, level: alarm.level, signal: alarm.signal, riskPct: alarm.riskPct }, { aggregateType: 'asset', aggregateId: data.assetId, practiceId });
  }
  return c.json({ id, alarm }, 201);
});
r.get('/telemetry/:assetId', allow(...READERS), async (c) => {
  const { metric, limit } = query(c, z.object({ metric: z.string().optional(), limit: z.coerce.number().max(500).default(120) }));
  const rows = await c.get('services').db.select().from(schema.telemetry).where(and(eq(schema.telemetry.assetId, param(c, 'assetId')), metric ? eq(schema.telemetry.metric, metric) : undefined)).orderBy(desc(schema.telemetry.at)).limit(limit);
  return c.json({ readings: rows.reverse() });
});

/** Predictive thresholds (docs/processes/11 §3.3); BCI scores are advisory and never acted on above A3. */
export const PREDICTIVE_THRESHOLDS = {
  tube_arc_count: { warn: 6, crit: 12, window: 7, label: 'Tube arc events in 7 days' },
  helium_pct: { warn: 60, crit: 45, window: 1, label: 'Helium level', lowerIsWorse: true },
  chiller_temp: { warn: 24, crit: 28, window: 1, label: 'Chiller temperature' },
  error_code: { warn: 3, crit: 6, window: 1, label: 'Repeat error codes in 24 hours' },
};
export async function evaluatePredictive(services: Services, assetId: string): Promise<{ signal: string; riskPct: number; confidence: number; modelId: string; modelVersion: string; at: string; level: 'none' | 'watch' | 'warn' | 'crit' } | null> {
  const [asset] = await services.db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
  if (!asset) return null;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await services.db.select().from(schema.telemetry).where(and(eq(schema.telemetry.assetId, assetId), gte(schema.telemetry.at, since))).orderBy(desc(schema.telemetry.at));
  let best: { signal: string; riskPct: number; level: 'none' | 'watch' | 'warn' | 'crit' } = { signal: 'No predictive signal', riskPct: 2, level: 'none' };
  const arcs = rows.filter((x) => x.metric === 'tube_arc_count');
  if (arcs.length) {
    const total = arcs.reduce((a, x) => a + (x.value ?? 0), 0);
    const t = PREDICTIVE_THRESHOLDS.tube_arc_count;
    const level = total >= t.crit ? 'crit' : total >= t.warn ? 'warn' : total > 2 ? 'watch' : 'none';
    if (level !== 'none') best = { signal: `Tube arc events ${total} in 7 d vs 2 baseline; cooling cycle up`, riskPct: Math.min(60, Math.round(total * 1.8)), level };
  }
  const helium = rows.find((x) => x.metric === 'helium_pct');
  if (helium?.value !== undefined && helium?.value !== null) {
    const t = PREDICTIVE_THRESHOLDS.helium_pct;
    const level = helium.value <= t.crit ? 'crit' : helium.value <= t.warn ? 'warn' : 'none';
    if (level !== 'none' && (best.level === 'none' || level === 'crit')) best = { signal: `Helium level ${helium.value} % · quench risk rising`, riskPct: Math.round(100 - helium.value), level };
  }
  const errs = rows.filter((x) => x.metric === 'error_code' && x.at >= new Date(Date.now() - 86400000).toISOString());
  if (errs.length >= PREDICTIVE_THRESHOLDS.error_code.warn && best.level === 'none') best = { signal: `${errs.length} repeat error codes in 24 h (${errs[0]!.textValue ?? 'code not recorded'})`, riskPct: errs.length * 4, level: errs.length >= PREDICTIVE_THRESHOLDS.error_code.crit ? 'warn' : 'watch' };
  const signal = { ...best, confidence: 0.72, modelId: 'BCI-PRED-EQUIP', modelVersion: '0.9.4', at: new Date().toISOString() };
  await services.db.update(schema.assets).set({ predictiveSignal: signal, updatedAt: new Date().toISOString() }).where(eq(schema.assets.id, assetId));
  return signal;
}

/* ================= Work orders ================= */
const WO_TRANSITIONS: Record<string, string[]> = {
  open: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'awaiting_parts', 'cancelled'],
  in_progress: ['awaiting_parts', 'done', 'cancelled'],
  awaiting_parts: ['in_progress', 'done', 'cancelled'],
  done: [],
  cancelled: [],
};
r.get('/work-orders', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const rows = await services.db.select().from(schema.workOrders).where(practiceId ? eq(schema.workOrders.practiceId, practiceId) : undefined).orderBy(desc(schema.workOrders.createdAt)).limit(200);
  const assets = await services.db.select().from(schema.assets);
  const sites = await services.db.select().from(schema.sites);
  const now = Date.now();
  return c.json({
    columns: ['open', 'scheduled', 'in_progress', 'awaiting_parts', 'done'],
    workOrders: rows.map((w) => ({
      ...w, assetName: assets.find((a) => a.id === w.assetId)?.name ?? null, siteName: sites.find((s) => s.id === w.siteId)?.name ?? w.siteId,
      slaPct: w.slaDueAt && w.slaStartedAt ? Math.min(160, Math.round(((now - new Date(w.slaStartedAt).getTime()) / Math.max(1, new Date(w.slaDueAt).getTime() - new Date(w.slaStartedAt).getTime())) * 100)) : null,
      slaBreached: !!w.slaDueAt && w.status !== 'done' && w.slaDueAt < new Date().toISOString(),
    })),
  });
});
r.post('/work-orders', allow(...ENGINEERS, 'RAD', 'NUR', 'CMP'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ assetId: z.string().optional(), siteId: z.string(), type: z.enum(['breakdown', 'pm', 'qa', 'upgrade', 'decommission']), priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'), title: z.string().min(4), symptoms: z.string().optional(), slaHours: z.number().optional() }));
  const id = await createWorkOrder(services, { practiceId, ...data, reportedBy: c.get('user')!.id });
  await audit(c, 'work_order.opened', { type: 'work_order', id }, { type: data.type, assetId: data.assetId });
  await emit(c, 'work_order.opened.v1', { workOrderId: id, practiceId, siteId: data.siteId, assetId: data.assetId ?? null, type: data.type, priority: data.priority }, { aggregateType: 'work_order', aggregateId: id });
  return c.json({ id }, 201);
});
export async function createWorkOrder(services: Services, input: { practiceId: string; siteId: string; assetId?: string | null; type: string; priority?: string; title: string; symptoms?: string | null; slaHours?: number | null; reportedBy?: string; vendorTicket?: string | null; handTaskId?: string | null }): Promise<string> {
  const id = newId('wo');
  const ref = await nextWorkOrderRef(services, input.practiceId);
  const now = new Date().toISOString();
  const slaHours = input.slaHours ?? (input.priority === 'critical' ? 4 : input.type === 'breakdown' ? 8 : 72);
  await services.db.insert(schema.workOrders).values({
    id, practiceId: input.practiceId, siteId: input.siteId, assetId: input.assetId ?? null, ref, type: input.type, priority: input.priority ?? 'normal',
    title: input.title, symptoms: input.symptoms ?? null, status: 'open', vendorTicket: input.vendorTicket ?? null,
    slaHours, slaStartedAt: now, slaDueAt: new Date(Date.now() + slaHours * 3600000).toISOString(),
    downtimeStartedAt: input.type === 'breakdown' ? now : null, reportedBy: input.reportedBy ?? 'system', handTaskId: input.handTaskId ?? null,
    timeline: [{ at: now, text: `Work order opened: ${input.title}`, by: input.reportedBy ?? 'system', kind: 'crit' }],
  });
  return id;
}
r.patch('/work-orders/:id', allow(...ENGINEERS), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ status: z.enum(['open', 'scheduled', 'in_progress', 'awaiting_parts', 'done', 'cancelled']).optional(), note: z.string().optional(), vendorTicket: z.string().optional(), rootCause: z.string().optional(), assignedTo: z.string().optional() }));
  const [row] = await services.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).limit(1);
  if (!row) throw notFound('Work order');
  if (data.status && data.status !== row.status && !WO_TRANSITIONS[row.status]!.includes(data.status)) throw invalid(`A work order cannot move from ${row.status} to ${data.status}`);
  if (data.status === 'done' && !data.rootCause && row.type === 'breakdown' && !row.rootCause) throw invalid('A breakdown work order needs a recorded root cause before it is closed');
  const now = new Date().toISOString();
  const timeline = [...row.timeline, { at: now, text: data.note ?? `Status ${row.status} → ${data.status ?? row.status}`, by: c.get('user')!.id, kind: data.status === 'done' ? 'ok' : 'neutral' }];
  await services.db.update(schema.workOrders).set({ status: data.status ?? row.status, vendorTicket: data.vendorTicket ?? row.vendorTicket, rootCause: data.rootCause ?? row.rootCause, assignedTo: data.assignedTo ?? row.assignedTo, downtimeEndedAt: data.status === 'done' && row.downtimeStartedAt ? now : row.downtimeEndedAt, timeline, updatedAt: now }).where(eq(schema.workOrders.id, id));
  await audit(c, 'work_order.updated', { type: 'work_order', id }, data);
  if (data.status === 'done') {
    if (row.assetId) {
      await services.db.update(schema.assets).set({ status: 'in_service', downtimeStartedAt: null, updatedAt: now }).where(eq(schema.assets.id, row.assetId));
      await emit(c, 'asset.downtime.ended.v1', { assetId: row.assetId, workOrderId: id, siteId: row.siteId }, { aggregateType: 'asset', aggregateId: row.assetId, practiceId: row.practiceId });
    }
    await emit(c, 'work_order.closed.v1', { workOrderId: id, practiceId: row.practiceId, type: row.type, downtimeMinutes: row.downtimeStartedAt ? Math.round((Date.now() - new Date(row.downtimeStartedAt).getTime()) / 60000) : null }, { aggregateType: 'work_order', aggregateId: id });
  }
  return c.json({ ok: true });
});

/* ================= Consumables ================= */
r.get('/consumables', allow(...READERS, 'FDK'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const rows = await services.db.select().from(schema.consumables).where(eq(schema.consumables.practiceId, practiceId)).orderBy(asc(schema.consumables.expiry));
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const today = todaySast();
  const bySite = new Map<string, { qty: number; usage: number }>();
  for (const l of rows.filter((x) => x.category === 'contrast' && x.status === 'active')) {
    const s = bySite.get(l.siteId) ?? { qty: 0, usage: 0 };
    s.qty += l.qtyOnHand; s.usage += l.dailyUsage;
    bySite.set(l.siteId, s);
  }
  return c.json({
    lots: rows.map((l) => ({ ...l, siteName: sites.find((s) => s.id === l.siteId)?.name ?? l.siteId, daysToExpiry: Math.round((new Date(l.expiry).getTime() - new Date(today).getTime()) / 86400000), expired: l.expiry < today })),
    cover: [...bySite.entries()].map(([siteId, s]) => ({ siteId, siteName: sites.find((x) => x.id === siteId)?.name ?? siteId, qty: s.qty, dailyUsage: Math.round(s.usage * 10) / 10, daysCover: s.usage ? Math.round((s.qty / s.usage) * 10) / 10 : null })),
    note: 'First-expiry-first-out picking; expired stock is blocked from issue and an override requires CMP (M18-R-106).',
  });
});
r.post('/consumables/receive', allow(...ENGINEERS, 'NUR', 'RAD'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ siteId: z.string(), category: z.string().default('contrast'), product: z.string(), lot: z.string(), expiry: z.string(), qty: z.number().int().positive(), unit: z.string().default('vial'), supplier: z.string().optional(), unitCents: z.number().int().default(0) }));
  const [existing] = await services.db.select().from(schema.consumables).where(and(eq(schema.consumables.practiceId, practiceId), eq(schema.consumables.siteId, data.siteId), eq(schema.consumables.lot, data.lot), eq(schema.consumables.product, data.product))).limit(1);
  const now = new Date().toISOString();
  let lotId: string;
  if (existing) {
    lotId = existing.id;
    await services.db.update(schema.consumables).set({ qtyOnHand: existing.qtyOnHand + data.qty, status: 'active', updatedAt: now }).where(eq(schema.consumables.id, existing.id));
  } else {
    lotId = newId('lot');
    await services.db.insert(schema.consumables).values({ id: lotId, practiceId, siteId: data.siteId, category: data.category, product: data.product, lot: data.lot, expiry: data.expiry, qtyOnHand: data.qty, unit: data.unit, supplier: data.supplier ?? null, unitCents: data.unitCents, dailyUsage: 0 });
  }
  await services.db.insert(schema.stockMovements).values({ id: newId('mov'), practiceId, siteId: data.siteId, lotId, type: 'receive', qty: data.qty, userId: c.get('user')!.id, at: now });
  await audit(c, 'stock.received', { type: 'consumable', id: lotId }, { product: data.product, lot: data.lot, qty: data.qty });
  await emit(c, 'stock.lot.received.v1', { lotId, practiceId, siteId: data.siteId, product: data.product, lot: data.lot, qty: data.qty, expiry: data.expiry }, { aggregateType: 'consumable', aggregateId: lotId });
  return c.json({ id: lotId }, 201);
});
r.post('/consumables/:id/issue', allow(...ENGINEERS, 'NUR', 'RAD'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { qty, studyId, override } = await body(c, z.object({ qty: z.number().int().positive().default(1), studyId: z.string().optional(), override: z.string().optional() }));
  const [lot] = await services.db.select().from(schema.consumables).where(eq(schema.consumables.id, id)).limit(1);
  if (!lot) throw notFound('Stock lot');
  if (lot.expiry < todaySast() && !override) throw invalid(`Lot ${lot.lot} expired ${lot.expiry}; issue is blocked. A CMP override needs a typed reason (M18-R-106).`);
  if (lot.qtyOnHand < qty) throw conflict(`Only ${lot.qtyOnHand} ${lot.unit}s on hand in lot ${lot.lot}`);
  const now = new Date().toISOString();
  const remaining = lot.qtyOnHand - qty;
  await services.db.update(schema.consumables).set({ qtyOnHand: remaining, status: remaining === 0 ? 'depleted' : lot.status, updatedAt: now }).where(eq(schema.consumables.id, id));
  await services.db.insert(schema.stockMovements).values({ id: newId('mov'), practiceId, siteId: lot.siteId, lotId: id, type: 'issue', qty, studyId: studyId ?? null, userId: c.get('user')!.id, note: override ? `CMP override: ${override}` : null, at: now });
  await audit(c, 'stock.issued', { type: 'consumable', id }, { qty, studyId, lot: lot.lot, override: override ?? null });
  await emit(c, 'stock.issued.v1', { lotId: id, practiceId, siteId: lot.siteId, product: lot.product, lot: lot.lot, qty, studyId: studyId ?? null }, { aggregateType: 'consumable', aggregateId: id });
  const cover = lot.dailyUsage ? remaining / lot.dailyUsage : null;
  if (cover !== null && cover < 10) {
    await runHand(services, 'maintenance', { action: 'reorder_stock', siteId: lot.siteId }, { practiceId, trigger: 'stock.issued.v1', title: `Maintenance Hand: contrast reorder at ${lot.siteId}` }).catch(() => undefined);
  }
  return c.json({ ok: true, remaining, daysCover: cover === null ? null : Math.round(cover * 10) / 10 });
});
/** Product recall: every lot and its issues across sites. */
r.get('/consumables/recall/:lot', allow(...ENGINEERS, 'CMP'), async (c) => {
  const lot = param(c, 'lot');
  const services = c.get('services');
  const lots = await services.db.select().from(schema.consumables).where(eq(schema.consumables.lot, lot));
  const movements = lots.length ? await services.db.select().from(schema.stockMovements).where(and(eq(schema.stockMovements.type, 'issue'), sql`${schema.stockMovements.lotId} in (${sql.join(lots.map((l) => sql`${l.id}`), sql`, `)})`)) : [];
  await audit(c, 'stock.recall_query', { type: 'consumable_lot', id: lot }, { lots: lots.length, issues: movements.length, lawfulBasis: 'product recall (M18-R-105)' });
  return c.json({ lot, lots, issues: movements, note: 'Cross-tenant recall query recorded with its lawful basis in the audit log.' });
});

/* ================= Purchase orders ================= */
r.get('/purchase-orders', allow(...READERS), async (c) => {
  const practiceId = requirePractice(c);
  const rows = await c.get('services').db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.practiceId, practiceId)).orderBy(desc(schema.purchaseOrders.createdAt)).limit(60);
  return c.json({ purchaseOrders: rows });
});
r.post('/purchase-orders/:id/approve', allow('PRM', 'EXE', 'BIO', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).limit(1);
  if (!row) throw notFound('Purchase order');
  if (row.status === 'approved' || row.status === 'sent') throw conflict('This order is already approved');
  await services.db.update(schema.purchaseOrders).set({ status: 'approved', approvedBy: c.get('user')!.id, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(schema.purchaseOrders.id, id));
  await audit(c, 'purchase_order.approved', { type: 'purchase_order', id }, { totalCents: row.totalCents });
  await emit(c, 'purchase_order.approved.v1', { purchaseOrderId: id, practiceId: row.practiceId, totalCents: row.totalCents, supplier: row.supplier }, { aggregateType: 'purchase_order', aggregateId: id });
  return c.json({ ok: true });
});

/* ================= Integrations ================= */
r.get('/integrations', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const feeds = await services.db.select().from(schema.integrationFeeds).where(practiceId ? eq(schema.integrationFeeds.practiceId, practiceId) : undefined).orderBy(asc(schema.integrationFeeds.type));
  const sites = await services.db.select().from(schema.sites);
  const assets = await services.db.select().from(schema.assets).where(and(practiceId ? eq(schema.assets.practiceId, practiceId) : undefined, eq(schema.assets.kind, 'modality')));
  const gws = await services.db.select().from(schema.edgeGateways).where(practiceId ? eq(schema.edgeGateways.practiceId, practiceId) : undefined);
  const now = Date.now();
  const silent = assets.filter((a) => {
    const gw = gws.find((g) => g.siteId === a.siteId);
    return a.status === 'down' || gw?.status === 'offline';
  });
  return c.json({
    feeds: feeds.map((f) => ({ ...f, siteName: f.siteId ? sites.find((s) => s.id === f.siteId)?.name ?? f.siteId : 'All sites', lastMessageAgeSeconds: f.lastMessageAt ? Math.round((now - new Date(f.lastMessageAt).getTime()) / 1000) : null })),
    summary: { healthy: feeds.filter((f) => f.status === 'healthy').length, degraded: feeds.filter((f) => f.status !== 'healthy').length, errors24h: feeds.reduce((a, f) => a + f.errors24h, 0), messages24h: feeds.reduce((a, f) => a + f.messages24h, 0) },
    silenceAlerts: silent.map((a) => ({ assetId: a.id, name: a.name, siteName: sites.find((s) => s.id === a.siteId)?.name ?? a.siteId, reason: a.status === 'down' ? 'device down' : 'site gateway offline (expected, annotated)' })),
  });
});
r.patch('/integrations/:id', allow(...ENGINEERS), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ status: z.enum(['healthy', 'degraded', 'down', 'mapping_review', 'backlog']).optional(), lastError: z.string().optional() }));
  await c.get('services').db.update(schema.integrationFeeds).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.integrationFeeds.id, id));
  await audit(c, 'integration.updated', { type: 'integration_feed', id }, data);
  return c.json({ ok: true });
});

/* ================= Vendor remote access ================= */
r.get('/vendor-access', allow(...READERS), async (c) => {
  const practiceId = c.get('practiceId');
  const services = c.get('services');
  const rows = await services.db.select().from(schema.vendorAccessSessions).where(practiceId ? eq(schema.vendorAccessSessions.practiceId, practiceId) : undefined).orderBy(desc(schema.vendorAccessSessions.createdAt)).limit(40);
  const assets = await services.db.select().from(schema.assets);
  const sites = await services.db.select().from(schema.sites);
  return c.json({ sessions: rows.map((s) => ({ ...s, assetName: assets.find((a) => a.id === s.assetId)?.name ?? null, siteName: sites.find((x) => x.id === s.siteId)?.name ?? s.siteId })), note: 'Vendor remote access is never standing: every session is requested, approved by BIO with a purpose and window, brokered through the Edge Gateway and recorded (M18-R-104).' });
});
r.post('/vendor-access', allow(...ENGINEERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ siteId: z.string(), assetId: z.string().optional(), vendor: z.string(), engineer: z.string().optional(), purpose: z.string().min(5), scope: z.string().default('service console port only'), requestedStart: z.string(), requestedEnd: z.string(), workOrderId: z.string().optional(), conditions: z.array(z.string()).optional() }));
  const yymm = todaySast().slice(2, 4) + todaySast().slice(5, 7);
  const n = await nextSequence(services, `RA:${practiceId}:${yymm}`);
  const id = newId('ras');
  await services.db.insert(schema.vendorAccessSessions).values({ id, practiceId, ...data, ref: `RA-${yymm}-${String(n).padStart(3, '0')}`, status: 'requested', requestedBy: c.get('user')!.id, conditions: data.conditions ?? [] });
  await audit(c, 'vendor_access.requested', { type: 'vendor_access_session', id }, { vendor: data.vendor, purpose: data.purpose });
  return c.json({ id }, 201);
});
/** Approval requires a typed confirmation of the session reference (BIO). */
r.post('/vendor-access/:id/approve', allow('BIO', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { confirm, approvedStart, approvedEnd, conditions } = await body(c, z.object({ confirm: z.string(), approvedStart: z.string().optional(), approvedEnd: z.string().optional(), conditions: z.array(z.string()).optional() }));
  const [row] = await services.db.select().from(schema.vendorAccessSessions).where(eq(schema.vendorAccessSessions.id, id)).limit(1);
  if (!row) throw notFound('Session');
  if (confirm !== row.ref) return c.json({ error: 'confirm_required', message: `Type the session reference ${row.ref} to approve`, expected: row.ref }, 400);
  if (row.status !== 'requested') throw conflict(`Session is ${row.status}`);
  const now = new Date().toISOString();
  await services.db.update(schema.vendorAccessSessions).set({
    status: 'approved', approvedBy: c.get('user')!.id, approvedAt: now,
    approvedStart: approvedStart ?? row.requestedStart, approvedEnd: approvedEnd ?? row.requestedEnd,
    conditions: conditions ?? row.conditions, recordingRef: `rec_${id.slice(-8)}`, updatedAt: now,
  }).where(eq(schema.vendorAccessSessions.id, id));
  await audit(c, 'vendor_access.approved', { type: 'vendor_access_session', id }, { approvedBy: c.get('user')!.id, window: [approvedStart ?? row.requestedStart, approvedEnd ?? row.requestedEnd] });
  await emit(c, 'remote_access.session.opened.v1', { sessionId: id, practiceId: row.practiceId, siteId: row.siteId, assetId: row.assetId, vendor: row.vendor, approvedBy: c.get('user')!.id }, { aggregateType: 'vendor_access_session', aggregateId: id });
  return c.json({ ok: true });
});
r.post('/vendor-access/:id/close', allow('BIO', 'SUP'), async (c) => {
  const id = param(c, 'id');
  await c.get('services').db.update(schema.vendorAccessSessions).set({ status: 'closed', updatedAt: new Date().toISOString() }).where(eq(schema.vendorAccessSessions.id, id));
  await audit(c, 'vendor_access.closed', { type: 'vendor_access_session', id });
  await emit(c, 'remote_access.session.closed.v1', { sessionId: id }, { aggregateType: 'vendor_access_session', aggregateId: id });
  return c.json({ ok: true });
});

/* ================= Load-shedding windows ================= */
r.get('/power', allow(...READERS, 'BKG', 'FDK'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const rows = await services.db.select().from(schema.loadSheddingWindows).where(and(eq(schema.loadSheddingWindows.practiceId, practiceId), gte(schema.loadSheddingWindows.startsAt, new Date(Date.now() - 86400000).toISOString()))).orderBy(asc(schema.loadSheddingWindows.startsAt));
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const gws = await services.db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.practiceId, practiceId));
  return c.json({ windows: rows.map((w) => ({ ...w, siteName: sites.find((s) => s.id === w.siteId)?.name ?? w.siteId, active: w.startsAt <= new Date().toISOString() && w.endsAt >= new Date().toISOString() })), readiness: gws.map((g) => ({ siteId: g.siteId, siteName: sites.find((s) => s.id === g.siteId)?.name ?? g.siteId, gateway: g.status, upsPct: g.upsPct, upsMinutesLeft: g.upsMinutesLeft, backlog: g.backlogStudies })) });
});

/* ================= Support console (SUP) ================= */
r.get('/support/tickets', allow('SUP', 'EXE', 'BIO', 'PRM'), async (c) => {
  const rows = await c.get('services').db.select().from(schema.supportTickets).orderBy(desc(schema.supportTickets.createdAt)).limit(100);
  return c.json({ tickets: rows });
});
r.post('/support/tickets', allow('SUP', 'BIO', 'PRM', 'EXE'), async (c) => {
  const data = await body(c, z.object({ category: z.string(), severity: z.enum(['p1', 'p2', 'p3', 'p4']).default('p3'), title: z.string().min(4), description: z.string().optional(), practiceId: z.string().optional(), siteId: z.string().optional(), linkedRef: z.string().optional() }));
  const services = c.get('services');
  const n = await nextSequence(services, 'SUPT');
  const id = newId('tkt');
  await services.db.insert(schema.supportTickets).values({ id, ...data, practiceId: data.practiceId ?? c.get('practiceId'), ref: `SUP-${String(n).padStart(4, '0')}`, openedBy: c.get('user')!.id });
  await audit(c, 'support_ticket.opened', { type: 'support_ticket', id }, { severity: data.severity, category: data.category });
  return c.json({ id }, 201);
});
r.patch('/support/tickets/:id', allow('SUP'), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(), assignedTo: z.string().optional(), runbookIndex: z.number().int().optional() }));
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id)).limit(1);
  if (!row) throw notFound('Ticket');
  const runbook = [...(row.runbook ?? [])];
  if (data.runbookIndex !== undefined && runbook[data.runbookIndex]) runbook[data.runbookIndex] = { ...runbook[data.runbookIndex]!, done: true };
  await services.db.update(schema.supportTickets).set({ status: data.status ?? row.status, assignedTo: data.assignedTo ?? row.assignedTo, runbook, updatedAt: new Date().toISOString() }).where(eq(schema.supportTickets.id, id));
  await audit(c, 'support_ticket.updated', { type: 'support_ticket', id }, data);
  return c.json({ ok: true });
});

/**
 * Support Hand (docs/11 §6.23): first-line triage. Reads the ticket and the related site's
 * observability (gateway and integration health), writes a diagnosis onto the ticket, and — only
 * for the one allow-listed, idempotent, reversible runbook (draining an Edge Gateway's
 * store-and-forward backlog once its link is confirmed back online) — takes that single action.
 * It never touches clinical or financial data, never closes a ticket and never changes
 * configuration or permissions; a human always decides what happens next.
 */
r.post('/support/tickets/:id/hand', allow('SUP'), async (c) => {
  const id = param(c, 'id');
  const task = await runHand(c.get('services'), 'support', { ticketId: id }, {
    practiceId: c.get('practiceId'), trigger: 'manual', title: `Support Hand triage · ${id}`, aggregateType: 'support_ticket', aggregateId: id,
  });
  return c.json({ task });
});

/* ================= Maintenance Hand ================= */
const supportHand = defineHand({
  id: 'support', name: 'Support Hand', module: 'M18', level: 'A3',
  mandate: 'First-line tenant support: read the ticket and the related site\'s observability, diagnose from device and integration health, enrich the ticket, and run only the allow-listed idempotent runbook (drain an Edge Gateway backlog once its link is confirmed online). Never touches clinical or financial content, never changes configuration or permissions, never closes a ticket.',
  defaultLeash: { maxDrainBatch: 50 },
  approvalPersona: 'SUP', approvalPolicy: 'Anything outside the one allow-listed runbook is left for SUP or BIO; the Hand only diagnoses and enriches',
  tools: { 'ticket.read': 'R0', 'observability.read': 'R0', 'ticket.enrich': 'R1', 'runbook.drain_backlog': 'R2' },
});

const maintenanceHand = defineHand({
  id: 'maintenance', name: 'Maintenance Hand', module: 'M18', level: 'A3',
  mandate: 'Keep every asset in service, maintained and licensed, and consumables in cover: open work orders and vendor tickets within contract terms, act on predictive signals, and raise purchase orders for catalogue items within the leash. Never approves remote access, never sets an asset in service, never commits capital.',
  defaultLeash: { maxPoCents: 5000000, maxPoCentsPerMonthPerSite: 25000000, maxCalendarBlockHours: 4, maxReroutedPatients: 20 },
  approvalPersona: 'BIO',
  approvalPolicy: 'Purchase orders above R50 000 each or R250 000 per site per month, calendar blocks over 4 hours and re-routing more than 20 patients need BIO or PRM approval.',
  tools: { 'assets.read': 'R0', 'telemetry.read': 'R0', 'work_order.create': 'R1', 'work_order.update': 'R1', 'task.create': 'R1', 'vendor.ticket': 'R2', 'purchase_order.draft': 'R2', 'llm.summarise': 'R0' },
});

const CATALOGUE = [
  { product: 'Iodinated contrast 100 mL (demo)', unitCents: 15300, supplier: 'DemoPharma SA', category: 'contrast' as const, pack: 60 },
  { product: 'Gadolinium 15 mL (demo)', unitCents: 42000, supplier: 'DemoPharma SA', category: 'contrast' as const, pack: 20 },
];

export default defineModule({
  code: 'M18', name: 'Assets & Engineering', basePath: 'assets', routes: r,
  boot(services) {
    registerEdgeSim();
    registerLoadSheddingSim();

    registerHand<{ ticketId: string }, { diagnosis: string; ran: boolean }>(supportHand, async (input, ctx) => {
      const db = ctx.services.db;
      const ticket = await ctx.step('ticket.read', { ticketId: input.ticketId }, async () => (await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, input.ticketId)).limit(1))[0]);
      if (!ticket) throw new Error('Ticket not found');

      const observed = await ctx.step('observability.read', { siteId: ticket.siteId, category: ticket.category }, async () => {
        if (!ticket.siteId) return null;
        const [gw] = await db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.siteId, ticket.siteId)).limit(1);
        const feeds = await db.select().from(schema.integrationFeeds).where(eq(schema.integrationFeeds.siteId, ticket.siteId));
        return { gateway: gw ?? null, feeds };
      });

      let diagnosis = 'No linked site observability to check; needs a human look.';
      let ran = false;
      const looksLikeBacklog = /gateway|backlog|edge|offline/i.test(`${ticket.category} ${ticket.title} ${ticket.description ?? ''}`);

      if (observed?.gateway) {
        const gw = observed.gateway;
        const downFeeds = observed.feeds.filter((f) => f.status !== 'healthy');
        if (gw.status === 'online' && gw.backlogStudies > 0 && looksLikeBacklog) {
          diagnosis = `Edge Gateway at the linked site is back online with ${gw.backlogStudies} studies still queued. Draining the store-and-forward backlog.`;
          const batch = Math.min(gw.backlogStudies, 50);
          ctx.leashCheck([{ rule: 'maxDrainBatch', actual: batch }]);
          await ctx.step('runbook.drain_backlog', { siteId: ticket.siteId, batch }, async () => {
            const drained = Math.min(gw.backlogStudies, batch);
            const now = new Date().toISOString();
            await db.update(schema.edgeGateways).set({ backlogStudies: gw.backlogStudies - drained, lastHeartbeatAt: now, updatedAt: now }).where(eq(schema.edgeGateways.id, gw.id));
            if (gw.backlogStudies - drained === 0) await emitDirect(ctx.services, 'edge.backlog.cleared.v1', { gatewayId: gw.id, siteId: gw.siteId, drained }, { aggregateType: 'edge_gateway', aggregateId: gw.id, practiceId: gw.practiceId }).catch(() => undefined);
            return { drained };
          }, 'The one allow-listed runbook: drain a backlog that is already confirmed safe to drain');
          ran = true;
        } else if (gw.status !== 'online') {
          diagnosis = `Edge Gateway at the linked site is ${gw.status.replace('_', ' ')}; nothing to drain until the link returns. This is expected behaviour, not a fault.`;
        } else if (downFeeds.length) {
          diagnosis = `Gateway is online. ${downFeeds.length} integration feed(s) unhealthy: ${downFeeds.map((f) => `${f.type} (${f.lastError ?? 'no detail'})`).join(', ')}. Outside the Hand's runbook; routed to BIO.`;
        } else {
          diagnosis = 'Gateway and integration feeds look healthy from here. Likely a local or user-side issue; needs a human look.';
        }
      }

      await ctx.step('ticket.enrich', { ticketId: ticket.id, diagnosis }, async () => {
        const runbook = [...(ticket.runbook ?? []), { step: diagnosis, done: ran }];
        await db.update(schema.supportTickets).set({ runbook, status: ticket.status === 'open' ? 'in_progress' : ticket.status, updatedAt: new Date().toISOString() }).where(eq(schema.supportTickets.id, ticket.id));
      });

      return { diagnosis, ran };
    });

    registerHand<{ action: string; modalityId?: string; assetId?: string; siteId?: string; reason?: string }, Record<string, unknown>>(maintenanceHand, async (input, ctx) => {
      const db = ctx.services.db;

      if (input.action === 'breakdown') {
        const [asset] = await ctx.step('assets.read', { assetId: input.assetId, modalityId: input.modalityId }, async () => {
          if (input.assetId) return db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId)).limit(1);
          return db.select().from(schema.assets).where(eq(schema.assets.modalityId, input.modalityId!)).limit(1);
        });
        if (!asset) throw new Refused('No asset record for this modality; BIO must register it before the Hand can act');
        const signal = await ctx.step('telemetry.read', { assetId: asset.id }, () => evaluatePredictive(ctx.services, asset.id));
        const priority = asset.type === 'CT' || asset.type === 'MR' ? 'critical' : 'high';
        const slaHours = asset.serviceContract?.responseHours ?? 4;
        const woId = await ctx.step('work_order.create', { assetId: asset.id, priority }, () => createWorkOrder(ctx.services, {
          practiceId: asset.practiceId, siteId: asset.siteId, assetId: asset.id, type: 'breakdown', priority, title: `${asset.name} down · ${input.reason ?? 'fault reported'}`,
          symptoms: `${input.reason ?? 'fault reported'}${signal && signal.level !== 'none' ? ` · predictive signal: ${signal.signal}` : ''}`, slaHours, reportedBy: 'maintenance_hand',
        }));
        const ticket = await ctx.step('vendor.ticket', { vendor: asset.serviceContract?.vendor ?? asset.vendor, woId }, async () => {
          const n = await nextSequence(ctx.services, `VT:${asset.practiceId}`);
          const ref = `VT-${String(20000 + n)}`;
          const now = new Date().toISOString();
          const [wo] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, woId)).limit(1);
          await db.update(schema.workOrders).set({ vendorTicket: ref, status: 'scheduled', timeline: [...(wo?.timeline ?? []), { at: now, text: `Vendor ticket ${ref} opened under contract; response SLA ${slaHours} h; logs and ${signal?.level !== 'none' ? '30-day predictive trend' : 'error log'} attached`, by: 'maintenance_hand', kind: 'neutral' }], updatedAt: now }).where(eq(schema.workOrders.id, woId));
          return ref;
        }, 'Templated vendor ticket within the contract; the Hand never negotiates terms');
        await db.update(schema.assets).set({ status: 'down', downtimeStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(schema.assets.id, asset.id));

        // Draft a PO for the likely part, within leash.
        let poId: string | null = null;
        if (signal && (signal.level === 'warn' || signal.level === 'crit')) {
          const partCents = asset.type === 'CT' ? 4_800_000 : 1_250_000;
          ctx.leashCheck([{ rule: 'maxPoCents', actual: partCents }]);
          poId = await ctx.step('purchase_order.draft', { assetId: asset.id, totalCents: partCents }, async () => {
            const id = newId('po');
            const n = await nextSequence(ctx.services, `PO:${asset.practiceId}`);
            await db.insert(schema.purchaseOrders).values({
              id, practiceId: asset.practiceId, siteId: asset.siteId, ref: `PO-${String(3000 + n)}`, supplier: asset.serviceContract?.vendor ?? asset.vendor ?? 'Vendor (demo)', category: 'parts',
              lines: [{ product: `${asset.type === 'CT' ? 'Replacement X-ray tube' : 'Replacement part'} for ${asset.name}`, qty: 1, unitCents: partCents }], totalCents: partCents,
              status: 'awaiting_approval', raisedBy: 'maintenance_hand', workOrderId: woId,
            });
            return id;
          }, 'Part order drafted within the leash; BIO approves before it is sent');
        }
        await ctx.step('task.create', { for: 'PRM', about: 'capacity' }, async () => ({ task: `Re-plan patients affected by ${asset.name} downtime` }), 'Capacity re-planning stays with PRM and the Booking Hand');
        return { assetId: asset.id, workOrderId: woId, vendorTicket: ticket, purchaseOrderId: poId, predictive: signal, slaHours };
      }

      if (input.action === 'predictive_scan') {
        const assets = await ctx.step('assets.read', { practiceId: ctx.practiceId }, () => db.select().from(schema.assets).where(and(ctx.practiceId ? eq(schema.assets.practiceId, ctx.practiceId) : undefined, eq(schema.assets.kind, 'modality'))));
        const raised: Array<{ assetId: string; level: string; workOrderId?: string }> = [];
        for (const a of assets) {
          const sig = await ctx.step('telemetry.read', { assetId: a.id }, () => evaluatePredictive(ctx.services, a.id));
          if (!sig || sig.level === 'none' || sig.level === 'watch') continue;
          const open = await db.select({ id: schema.workOrders.id }).from(schema.workOrders).where(and(eq(schema.workOrders.assetId, a.id), sql`${schema.workOrders.status} not in ('done','cancelled')`)).limit(1);
          if (open.length) { raised.push({ assetId: a.id, level: sig.level }); continue; }
          const woId = await ctx.step('work_order.create', { assetId: a.id, type: 'pm' }, () => createWorkOrder(ctx.services, { practiceId: a.practiceId, siteId: a.siteId, assetId: a.id, type: 'pm', priority: sig.level === 'crit' ? 'high' : 'normal', title: `Predictive inspection · ${a.name}`, symptoms: sig.signal, slaHours: 72, reportedBy: 'maintenance_hand' }));
          raised.push({ assetId: a.id, level: sig.level, workOrderId: woId });
        }
        return { scanned: assets.length, raised };
      }

      if (input.action === 'reorder_stock') {
        const lots = await ctx.step('assets.read', { siteId: input.siteId, kind: 'consumables' }, () => db.select().from(schema.consumables).where(and(eq(schema.consumables.siteId, input.siteId!), eq(schema.consumables.category, 'contrast'), eq(schema.consumables.status, 'active'))));
        const qty = lots.reduce((a, l) => a + l.qtyOnHand, 0);
        const usage = lots.reduce((a, l) => a + l.dailyUsage, 0);
        const cover = usage ? qty / usage : 99;
        if (cover >= 10) return { reordered: false, daysCover: Math.round(cover * 10) / 10, note: 'Cover is above the 10-day threshold; no order raised.' };
        const item = CATALOGUE[0]!;
        const needed = Math.ceil(Math.max(0, usage * 30 - qty) / item.pack) * item.pack;
        const totalCents = needed * item.unitCents;
        ctx.leashCheck([{ rule: 'maxPoCents', actual: totalCents }]);
        const poId = await ctx.step('purchase_order.draft', { siteId: input.siteId, totalCents }, async () => {
          const id = newId('po');
          const n = await nextSequence(ctx.services, `PO:${ctx.practiceId}`);
          await db.insert(schema.purchaseOrders).values({ id, practiceId: ctx.practiceId!, siteId: input.siteId!, ref: `PO-${String(3000 + n)}`, supplier: item.supplier, category: 'consumable', lines: [{ product: item.product, qty: needed, unitCents: item.unitCents }], totalCents, status: 'awaiting_approval', raisedBy: 'maintenance_hand' });
          return id;
        }, 'Catalogue item from an approved supplier, within the monthly site cap');
        return { reordered: true, purchaseOrderId: poId, qty: needed, totalCents, daysCover: Math.round(cover * 10) / 10 };
      }
      throw new Refused(`Unknown action ${input.action}`);
    });

    /* A modality going down wakes the Maintenance Hand. */
    on('modality.down.v1', async (evt, svcs) => {
      const p = evt.payload as { modalityId?: string; assetId?: string; reason?: string; siteId?: string };
      const modalityId = p.modalityId ?? p.assetId;
      if (!modalityId) return;
      const [asset] = await svcs.db.select().from(schema.assets).where(eq(schema.assets.modalityId, modalityId)).limit(1);
      const practiceId = asset?.practiceId ?? evt.practiceId;
      if (!practiceId) return;
      const open = await svcs.db.select({ id: schema.workOrders.id }).from(schema.workOrders).where(and(asset ? eq(schema.workOrders.assetId, asset.id) : sql`1=0`, eq(schema.workOrders.type, 'breakdown'), sql`${schema.workOrders.status} not in ('done','cancelled')`)).limit(1);
      if (open.length) return;
      const task = await runHand(svcs, 'maintenance', { action: 'breakdown', modalityId, reason: p.reason ?? 'heartbeat lost' }, { practiceId, trigger: 'modality.down.v1', title: 'Maintenance Hand: modality down', aggregateType: 'asset', aggregateId: asset?.id });
      if (task.output?.workOrderId && asset) await svcs.db.update(schema.workOrders).set({ handTaskId: task.id }).where(eq(schema.workOrders.id, task.output.workOrderId as string));
    });

    void services;
  },
  /** Daily: refresh predictive signals, uptime and stock cover; reorder where cover is short. */
  async tick(services) {
    const assets = await services.db.select().from(schema.assets).where(eq(schema.assets.kind, 'modality'));
    for (const a of assets) await evaluatePredictive(services, a.id);
    const sites = await services.db.select({ id: schema.sites.id, practiceId: schema.sites.practiceId }).from(schema.sites);
    let reorders = 0;
    for (const s of sites) {
      const task = await runHand(services, 'maintenance', { action: 'reorder_stock', siteId: s.id }, { practiceId: s.practiceId, trigger: 'schedule', title: `Maintenance Hand: stock cover ${s.id}` }).catch(() => null);
      if (task?.output?.reordered) reorders++;
    }
    return { predictiveScans: assets.length, reorders };
  },
});
