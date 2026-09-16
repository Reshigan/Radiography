import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, conflict } from '@bonakala/domain';
import { DEMO_MODELS, getDemoModel, routeModels } from '@bonakala/domain/bci';
import { defineModule, router, allow, body, query, param, audit, emit, on } from '../../kernel/index.js';
import { ensureRegistry, inferStudy } from './service.js';

const r = router();
const GOV = ['AIO', 'CMP', 'PRM', 'EXE', 'SUP', 'BIO'] as const;
const READ = [...GOV, 'RGT', 'RAD'] as const;

/* ---------- Registry ---------- */
r.get('/models', allow(...READ), async (c) => {
  const services = c.get('services');
  await ensureRegistry(services);
  const practiceId = c.get('practiceId');
  const rows = await services.db.select().from(schema.modelRegistry).where(or(isNull(schema.modelRegistry.practiceId), practiceId ? eq(schema.modelRegistry.practiceId, practiceId) : undefined)).orderBy(schema.modelRegistry.modelId);
  const sites = await services.db.select({ id: schema.sites.id, code: schema.sites.code, name: schema.sites.name, practiceId: schema.sites.practiceId }).from(schema.sites);
  const counts = await services.db.select({ modelId: schema.inferenceResults.modelId, n: schema.inferenceResults.id }).from(schema.inferenceResults);
  const byModel: Record<string, number> = {};
  for (const x of counts) byModel[x.modelId] = (byModel[x.modelId] ?? 0) + 1;
  return c.json({
    models: rows.map((m) => ({ ...m, deployments: { activated: Object.values(m.siteStatus).filter((v) => v === 'activated').length + (m.lifecycle === 'activated' ? sites.filter((s) => !m.siteStatus[s.id]).length : 0), shadow: Object.values(m.siteStatus).filter((v) => v === 'shadow').length + (m.lifecycle === 'shadow' ? sites.filter((s) => !m.siteStatus[s.id]).length : 0), paused: Object.values(m.siteStatus).filter((v) => v === 'paused').length, off: Object.values(m.siteStatus).filter((v) => v === 'off').length }, resultCount: byModel[m.modelId] ?? 0 })),
    sites,
  });
});

r.get('/models/:id', allow(...READ), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const [row] = await services.db.select().from(schema.modelRegistry).where(eq(schema.modelRegistry.id, id)).limit(1);
  if (!row) throw notFound('Model');
  const events = await services.db.select().from(schema.modelEvents).where(eq(schema.modelEvents.modelId, row.modelId)).orderBy(desc(schema.modelEvents.createdAt)).limit(50);
  const def = getDemoModel(row.modelId);
  return c.json({ model: row, events, card: def ?? null });
});

/** Activation, pause and kill switch per model and site (M11-R-308: acts immediately). */
r.patch('/models/:id/status', allow('AIO', 'CMP', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { siteId, status, reason, lifecycle } = await body(c, z.object({ siteId: z.string().optional(), status: z.enum(['activated', 'shadow', 'paused', 'off']).optional(), lifecycle: z.enum(['proposed', 'validated', 'shadow', 'activated', 'paused', 'deprecated', 'retired']).optional(), reason: z.string().min(3) }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [row] = await services.db.select().from(schema.modelRegistry).where(eq(schema.modelRegistry.id, id)).limit(1);
  if (!row) throw notFound('Model');
  if (!status && !lifecycle) throw conflict('Provide a site status or a lifecycle change');
  const siteStatus = { ...row.siteStatus };
  if (siteId && status) siteStatus[siteId] = status;
  await services.db.update(schema.modelRegistry).set({ siteStatus, lifecycle: lifecycle ?? row.lifecycle, updatedAt: services.clock.now().toISOString() }).where(eq(schema.modelRegistry.id, id));
  const evtId = newId('mev');
  const type = status === 'paused' || status === 'off' ? 'kill_switch' : status === 'activated' || lifecycle === 'activated' ? 'activation' : 'change_record';
  await services.db.insert(schema.modelEvents).values({ id: evtId, practiceId: c.get('practiceId'), siteId: siteId ?? null, modelId: row.modelId, modelVersion: row.version, type, severity: type === 'kill_switch' ? 'crit' : 'info', title: `${row.name} ${status ?? lifecycle} ${siteId ? `at ${siteId}` : 'group-wide'}`, detail: { reason, by: user.id, previous: siteId ? row.siteStatus[siteId] ?? row.lifecycle : row.lifecycle }, status: 'closed', actorUserId: user.id, resolvedBy: user.id, resolvedAt: services.clock.now().toISOString() });
  await audit(c, 'bci.model_status', { type: 'model_registry', id }, { siteId, status, lifecycle, reason });
  await emit(c, 'bci.model_status.v1', { modelId: row.modelId, modelVersion: row.version, siteId: siteId ?? null, status: status ?? lifecycle, reason }, { aggregateType: 'model', aggregateId: id });
  return c.json({ ok: true, siteStatus });
});

/* ---------- Results ---------- */
r.get('/studies/:studyId/results', allow(...READ), async (c) => {
  const services = c.get('services');
  const studyId = param(c, 'studyId');
  const rows = await services.db.select().from(schema.inferenceResults).where(eq(schema.inferenceResults.studyId, studyId)).orderBy(schema.inferenceResults.createdAt);
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, studyId)).limit(1);
  // Shadow results never reach the Reading Room; they are visible to AI operations only.
  const user = c.get('user')!;
  const visible = ['AIO', 'CMP', 'SUP'].includes(user.persona) ? rows : rows.filter((x) => x.mode === 'activated');
  const overlayPolicy: Record<string, string> = {};
  for (const x of visible) {
    const def = getDemoModel(x.modelId);
    if (def) overlayPolicy[x.modelId] = def.overlaysDefault;
  }
  return c.json({ results: visible, study: study ?? null, overlayPolicy });
});

r.post('/studies/:studyId/infer', allow('AIO', 'SUP', 'BIO'), async (c) => {
  const studyId = param(c, 'studyId');
  const out = await inferStudy(c.get('services'), studyId);
  await audit(c, 'bci.reinfer', { type: 'study', id: studyId }, { results: out?.results.length ?? 0 });
  return c.json({ studyId, priority: out?.priority ?? null, results: out?.results.map((x) => ({ id: x.id, modelId: x.modelId, mode: x.mode, priority: x.result.triage?.priority })) ?? [] });
});

/* ---------- Monitoring ---------- */
r.get('/monitoring', allow(...READ), async (c) => {
  const services = c.get('services');
  const { days, siteId } = query(c, z.object({ days: z.coerce.number().min(1).max(90).default(14), siteId: z.string().optional() }));
  const since = new Date(services.clock.now().getTime() - days * 86400_000).toISOString();
  const results = await services.db.select().from(schema.inferenceResults).where(and(gte(schema.inferenceResults.createdAt, since), siteId ? eq(schema.inferenceResults.siteId, siteId) : undefined));
  const studies = await services.db.select({ id: schema.studies.id, siteId: schema.studies.siteId, modality: schema.studies.modality, bodyPart: schema.studies.bodyPart, status: schema.studies.status, receivedAt: schema.studies.receivedAt }).from(schema.studies).where(gte(schema.studies.receivedAt, since));
  const reports = await services.db.select({ id: schema.reports.id, studyId: schema.reports.studyId, candidates: schema.reports.candidates, status: schema.reports.status, siteId: schema.reports.siteId }).from(schema.reports).where(and(eq(schema.reports.status, 'signed'), gte(schema.reports.signedAt, since)));

  const analysedStudies = new Set(results.filter((x) => x.task !== 'not_analysed').map((x) => x.studyId));
  // Eligible = a study for which the routing rules select at least one model (docs/22 §10).
  const eligible = studies.filter((s) => s.status !== 'cancelled' && routeModels(s.modality, s.bodyPart).length > 0);
  const notEligible = studies.length - eligible.length;
  const coverage = eligible.length ? Math.round((eligible.filter((s) => analysedStudies.has(s.id)).length / eligible.length) * 1000) / 10 : 100;

  let accepted = 0, rejected = 0, edited = 0, decided = 0;
  for (const rep of reports) for (const cand of rep.candidates ?? []) {
    if (cand.decision === 'accepted') { accepted++; decided++; }
    else if (cand.decision === 'rejected') { rejected++; decided++; }
    else if (cand.decision === 'edited') { edited++; accepted++; decided++; }
  }
  const perModel: Record<string, { n: number; latency: number[]; positives: number; mode: Record<string, number> }> = {};
  for (const x of results) {
    if (x.task === 'not_analysed') continue;
    perModel[x.modelId] ??= { n: 0, latency: [], positives: 0, mode: {} };
    const m = perModel[x.modelId]!;
    m.n++;
    m.latency.push(x.latencyMs);
    if (x.flagged) m.positives++;
    m.mode[x.mode] = (m.mode[x.mode] ?? 0) + 1;
  }
  const pct = (arr: number[], p: number) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };
  const perSite: Record<string, { n: number; positives: number }> = {};
  for (const x of results) {
    if (x.task === 'not_analysed' || x.task === 'qc') continue;
    perSite[x.siteId] ??= { n: 0, positives: 0 };
    perSite[x.siteId]!.n++;
    if (x.flagged) perSite[x.siteId]!.positives++;
  }
  const groupPositive = Object.values(perSite).reduce((a, s) => a + s.positives, 0) / Math.max(1, Object.values(perSite).reduce((a, s) => a + s.n, 0));
  // Daily series for sparklines
  const dayKeys = Array.from({ length: Math.min(days, 14) }, (_, i) => new Date(services.clock.now().getTime() - (Math.min(days, 14) - 1 - i) * 86400_000).toISOString().slice(0, 10));
  const daily = dayKeys.map((d) => {
    const rs = results.filter((x) => x.createdAt.slice(0, 10) === d && x.task !== 'not_analysed');
    return { date: d, n: rs.length, positiveRate: rs.length ? Math.round((rs.filter((x) => x.flagged).length / rs.length) * 1000) / 10 : 0, latencyP95: pct(rs.map((x) => x.latencyMs), 95) };
  });
  // A slip is Class 1 or 2 content reaching a record, referrer or patient without its gate (docs/00 §8).
  // Performance incidents are not slips: only events explicitly categorised as one are counted.
  const incidents = await services.db.select({ id: schema.modelEvents.id, detail: schema.modelEvents.detail }).from(schema.modelEvents).where(and(eq(schema.modelEvents.type, 'incident'), gte(schema.modelEvents.createdAt, since)));
  const slips = incidents.filter((x) => /slip/i.test(String((x.detail as Record<string, unknown>)?.category ?? '')));
  return c.json({
    days, coveragePct: coverage, analysed: eligible.filter((s) => analysedStudies.has(s.id)).length, eligible: eligible.length, noModelApplies: notEligible,
    agreement: decided ? Math.round((accepted / decided) * 100) / 100 : null,
    overrideRatePct: decided ? Math.round((rejected / decided) * 1000) / 10 : 0,
    decisions: { accepted, rejected, edited, decided },
    latencyP50: pct(results.map((x) => x.latencyMs), 50), latencyP95: pct(results.map((x) => x.latencyMs), 95),
    models: Object.entries(perModel).map(([modelId, v]) => ({ modelId, name: getDemoModel(modelId)?.name ?? modelId, n: v.n, latencyP50: pct(v.latency, 50), latencyP95: pct(v.latency, 95), positiveRatePct: Math.round((v.positives / v.n) * 1000) / 10, modes: v.mode })),
    sites: Object.entries(perSite).map(([site, v]) => ({ siteId: site, n: v.n, positiveRatePct: Math.round((v.positives / v.n) * 1000) / 10, deltaVsGroupPct: Math.round((v.positives / v.n - groupPositive) * 1000) / 10 })),
    daily, slipCount: slips.length, aiIncidents: incidents.length,
  });
});

/** Drift alarm generator: compares each site's positive rate with the group over the window. */
r.post('/monitoring/drift-check', allow('AIO', 'CMP', 'SUP'), async (c) => {
  const alarms = await runDriftCheck(c.get('services'));
  await audit(c, 'bci.drift_check', undefined, { alarms: alarms.length });
  return c.json({ alarms });
});

export async function runDriftCheck(services: any) {
  const since = new Date(services.clock.now().getTime() - 7 * 86400_000).toISOString();
  const baselineSince = new Date(services.clock.now().getTime() - 37 * 86400_000).toISOString();
  const rows = await services.db.select().from(schema.inferenceResults).where(and(gte(schema.inferenceResults.createdAt, baselineSince), inArray(schema.inferenceResults.task, ['triage', 'findings'])));
  const alarms: Array<Record<string, unknown>> = [];
  const groups = new Map<string, typeof rows>();
  for (const x of rows) {
    const k = `${x.modelId}|${x.siteId}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  for (const [key, list] of groups) {
    const [modelId, siteId] = key.split('|') as [string, string];
    const recent = list.filter((x: any) => x.createdAt >= since);
    const baseline = list.filter((x: any) => x.createdAt < since);
    if (recent.length < 8 || baseline.length < 20) continue;
    const rRate = recent.filter((x: any) => x.flagged).length / recent.length;
    const bRate = baseline.filter((x: any) => x.flagged).length / baseline.length;
    if (bRate === 0) continue;
    const delta = (rRate - bRate) / bRate;
    if (Math.abs(delta) < 0.35) continue;
    const existing = await services.db.select({ id: schema.modelEvents.id }).from(schema.modelEvents).where(and(eq(schema.modelEvents.modelId, modelId), eq(schema.modelEvents.type, 'drift_alarm'), eq(schema.modelEvents.status, 'open'), eq(schema.modelEvents.siteId, siteId))).limit(1);
    if (existing.length) continue;
    const [study] = await services.db.select({ practiceId: schema.studies.practiceId }).from(schema.studies).where(eq(schema.studies.siteId, siteId)).limit(1);
    const id = newId('mev');
    await services.db.insert(schema.modelEvents).values({ id, practiceId: study?.practiceId ?? null, siteId, modelId, modelVersion: recent[0]!.modelVersion, type: 'drift_alarm', severity: Math.abs(delta) > 0.6 ? 'crit' : 'warn', title: `${getDemoModel(modelId)?.name ?? modelId} positive rate ${delta > 0 ? 'up' : 'down'} ${Math.round(Math.abs(delta) * 100)} % at ${siteId}`, detail: { recentRatePct: Math.round(rRate * 1000) / 10, baselineRatePct: Math.round(bRate * 1000) / 10, deltaPct: Math.round(delta * 1000) / 10, window: '7 d vs 30 d baseline', n: recent.length, recommendation: 'review at site; consider pause (model keeps running and logging)' }, status: 'open' });
    alarms.push({ id, modelId, siteId, deltaPct: Math.round(delta * 1000) / 10 });
  }
  return alarms;
}

/* ---------- Shadow evaluation ---------- */
r.get('/shadow', allow(...READ), async (c) => {
  const services = c.get('services');
  await ensureRegistry(services);
  const models = await services.db.select().from(schema.modelRegistry);
  const out = [];
  for (const m of models) {
    const shadowSites = Object.entries(m.siteStatus).filter(([, v]) => v === 'shadow').map(([k]) => k);
    if (m.lifecycle !== 'shadow' && !shadowSites.length) continue;
    const rows = await services.db.select().from(schema.inferenceResults).where(and(eq(schema.inferenceResults.modelId, m.modelId), eq(schema.inferenceResults.mode, 'shadow')));
    const bySite: Record<string, { n: number; positives: number }> = {};
    for (const x of rows) {
      bySite[x.siteId] ??= { n: 0, positives: 0 };
      bySite[x.siteId]!.n++;
      if (x.flagged) bySite[x.siteId]!.positives++;
    }
    const v = m.validationSummary as Record<string, number | string>;
    out.push({ modelId: m.modelId, name: m.name, version: m.version, cases: rows.length, required: 500, lifecycle: m.lifecycle, sites: Object.entries(bySite).map(([siteId, s]) => ({ siteId, n: s.n, positiveRatePct: Math.round((s.positives / s.n) * 1000) / 10, floorMet: (s.positives / s.n) < 0.5 })), validation: v, limitations: m.limitations ?? [] });
  }
  return c.json({ evaluations: out });
});

/* ---------- Incidents and change control ---------- */
r.get('/events', allow(...READ), async (c) => {
  const { type, status } = query(c, z.object({ type: z.string().optional(), status: z.string().optional() }));
  const rows = await c.get('services').db.select().from(schema.modelEvents).where(and(type ? eq(schema.modelEvents.type, type) : undefined, status ? eq(schema.modelEvents.status, status) : undefined)).orderBy(desc(schema.modelEvents.createdAt)).limit(200);
  return c.json({ events: rows });
});
r.post('/events', allow('AIO', 'CMP', 'SUP'), async (c) => {
  const data = await body(c, z.object({ modelId: z.string(), modelVersion: z.string().optional(), siteId: z.string().optional(), type: z.enum(['incident', 'change_record', 'revalidation', 'shadow_report']), severity: z.enum(['info', 'warn', 'crit']).default('info'), title: z.string().min(3), detail: z.record(z.unknown()).default({}) }));
  const services = c.get('services');
  const id = newId('mev');
  await services.db.insert(schema.modelEvents).values({ id, practiceId: c.get('practiceId'), siteId: data.siteId ?? null, modelId: data.modelId, modelVersion: data.modelVersion ?? null, type: data.type, severity: data.severity, title: data.title, detail: data.detail, status: 'open', actorUserId: c.get('user')!.id });
  await audit(c, 'bci.event_opened', { type: 'model_event', id }, { type: data.type, modelId: data.modelId });
  return c.json({ id }, 201);
});
r.post('/events/:id/resolve', allow('AIO', 'CMP', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { status, note } = await body(c, z.object({ status: z.enum(['acknowledged', 'closed', 'approved', 'rejected']), note: z.string().optional() }));
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.modelEvents).where(eq(schema.modelEvents.id, id)).limit(1);
  if (!row) throw notFound('Model event');
  await services.db.update(schema.modelEvents).set({ status, detail: { ...row.detail, resolutionNote: note ?? null }, resolvedBy: c.get('user')!.id, resolvedAt: services.clock.now().toISOString() }).where(eq(schema.modelEvents.id, id));
  await audit(c, 'bci.event_resolved', { type: 'model_event', id }, { status, note });
  return c.json({ ok: true });
});

r.get('/status', (c) => c.json({ module: 'M11', status: 'ok', models: DEMO_MODELS.length }));

export default defineModule({
  code: 'M11', name: 'Clinical Intelligence', basePath: 'bci', routes: r,
  boot(services) {
    void ensureRegistry(services).catch(() => undefined);
    /** Inference orchestration: route models by modality, store results, emit bci.result.available.v1. */
    on('study.completed.v1', async (evt) => {
      const p = evt.payload as { studyId: string };
      const existing = await services.db.select({ id: schema.inferenceResults.id }).from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, p.studyId), inArray(schema.inferenceResults.task, ['triage', 'findings']))).limit(1);
      if (existing.length) return;
      await ensureRegistry(services);
      await inferStudy(services, p.studyId);
    });
    /** Back-fill on reconciliation (M11-R-301). */
    on('study.reconciled.v1', async (evt) => {
      const p = evt.payload as { studyId: string };
      await inferStudy(services, p.studyId);
    });
  },
  async tick(services) {
    const alarms = await runDriftCheck(services);
    return { driftAlarms: alarms.length };
  },
});
