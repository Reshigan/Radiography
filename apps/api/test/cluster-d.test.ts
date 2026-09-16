import { describe, expect, it, beforeAll } from 'vitest';
import { schema } from '@bonakala/db';
import { and, eq, sql } from 'drizzle-orm';
import { createTestApp, type TestApp } from './harness.js';
import { runHand } from '../src/kernel/hands.js';
import { emitDirect } from '../src/kernel/events.js';

const PRAC_A = 'prac_a';
const PRAC_B = 'prac_b';

describe('cluster D · M16 analytics', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('publishes the metric catalogue grouped as docs/13 §4', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const res = await t.call(prm, 'GET', '/api/analytics/metrics');
    expect(res.status).toBe(200);
    expect(res.json.count).toBeGreaterThanOrEqual(60);
    expect(res.json.groups.map((g: any) => g.group)).toEqual(['access', 'operations', 'clinical_quality', 'patient_experience', 'referrer', 'revenue_cycle', 'finance', 'workforce', 'assets', 'compliance', 'ai_ops', 'shareholder']);
    const one = await t.call(prm, 'GET', '/api/analytics/metrics/AIO.SLIP');
    expect(one.json.metric.target).toBe(0);
    expect((await t.call(prm, 'GET', '/api/analytics/metrics/NOPE.NOPE')).status).toBe(404);
  });

  it('computes tiles from its own tables and returns a note when a source is missing', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const res = await t.call(prm, 'GET', '/api/analytics/tiles?scope=practice');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.json.tiles.map((x: any) => [x.id, x]));
    // Owned by cluster D: computed live from real rows.
    expect(byId['WFM.VAC'].source).toBe('live');
    expect(byId['AST.UP'].value).toBeGreaterThan(80);
    expect(byId['CMP.INC'].source).toBe('live');
    // Every tile carries its definition, target and direction for the "definition" affordance.
    for (const tile of res.json.tiles) {
      expect(tile.formula).toBeTruthy();
      expect(tile.targetLabel).toBeTruthy();
      expect(['ok', 'att', 'crit', 'none']).toContain(tile.tone);
    }
  });

  it('falls back to a snapshot or an explicit unavailable note when another cluster has no rows', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const res = await t.call(prm, 'GET', '/api/analytics/tiles?scope=practice&ids=CLQ.PEER,OPS.WAIT');
    const peer = res.json.tiles.find((x: any) => x.id === 'CLQ.PEER');
    // CLQ.PEER has no live computation and no snapshot: it must say so rather than invent a number.
    expect(peer.value).toBeNull();
    expect(peer.source).toBe('unavailable');
    expect(peer.note).toMatch(/source not available/);
    const wait = res.json.tiles.find((x: any) => x.id === 'OPS.WAIT');
    expect(wait.source).toBe('snapshot');
    expect(wait.value).toBeGreaterThan(0);
  });

  it('serves a daily series, a room by hour heatmap and a queue curve', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const series = await t.call(prm, 'GET', '/api/analytics/series/OPS.TAT.SLA?days=30');
    expect(series.json.points.length).toBeGreaterThan(20);
    expect(series.json.metric.id).toBe('OPS.TAT.SLA');
    const heat = await t.call(prm, 'GET', '/api/analytics/heatmap');
    expect(heat.status).toBe(200);
    expect(heat.json.hours.length).toBe(12);
    expect(heat.json.rows.length).toBeGreaterThan(3);
    expect(heat.json.rows[0].cells.length).toBe(12);
    const queue = await t.call(prm, 'GET', '/api/analytics/queue');
    expect(queue.json.points.length).toBeGreaterThan(1);
    expect(queue.json.target).toBe(20);
  });

  it('benchmarks practices with a peer median and anonymises peers below EXE', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const asExe = await t.call(exe, 'GET', '/api/analytics/benchmark?metricId=AST.UP');
    expect(asExe.status).toBe(200);
    expect(asExe.json.identified).toBe(true);
    expect(asExe.json.caseMixNote).toMatch(/case-mix/i);
    const prm = await t.login('prm@demo.bonakala');
    const asPrm = await t.call(prm, 'GET', '/api/analytics/benchmark?metricId=AST.UP', undefined, { 'x-practice-id': PRAC_B });
    expect(asPrm.json.identified).toBe(false);
    expect(asPrm.json.rows.every((x: any) => /^P\d+$/.test(x.label))).toBe(true);
  });

  it('answers a question through the Insight Hand and refuses what is not in the semantic layer', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const ok = await t.call(exe, 'POST', '/api/analytics/ask', { question: 'Which sites are over 85 % CT utilisation?' }, { 'x-practice-id': PRAC_B });
    expect(ok.status).toBe(200);
    expect(ok.json.task.status).toBe('done');
    expect(ok.json.answer.primary.id).toBe('OPS.UTIL');
    expect(ok.json.answer.primary.formula).toBeTruthy();
    expect(ok.json.answer.narrative).toContain('Utilisation');
    expect(ok.json.savedQuestionId).toBeTruthy();
    const refused = await t.call(exe, 'POST', '/api/analytics/ask', { question: 'zzqx wibble frobnicate' }, { 'x-practice-id': PRAC_B });
    expect(refused.json.task.status).toBe('refused');
    expect(refused.json.refused).toMatch(/semantic layer/);
  });

  it('runs a second-modality what-if with assumptions and saves it as a scenario', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const res = await t.call(exe, 'POST', '/api/analytics/what-if', { name: 'Second MRI test', modality: 'MR' }, { 'x-practice-id': PRAC_B });
    expect(res.status).toBe(201);
    expect(res.json.outputs.paybackMonths).toBeGreaterThan(6);
    expect(res.json.outputs.assumptions.length).toBeGreaterThan(5);
    expect(res.json.provenance.modelId).toBe('capex-whatif');
    const list = await t.call(exe, 'GET', '/api/analytics/what-if', undefined, { 'x-practice-id': PRAC_B });
    expect(list.json.scenarios.length).toBeGreaterThan(0);
  });

  it('generates a board pack with governance and AI-slip sections', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const res = await t.call(exe, 'POST', '/api/analytics/board-packs', { period: '2026-09' });
    expect(res.status).toBe(201);
    expect(res.json.pack.sections.kpis.length).toBeGreaterThan(8);
    expect(res.json.pack.sections.governance.aiSlipCount).toBe(0);
    expect(res.json.pack.glossary.length).toBeGreaterThan(5);
  });

  it('advances the acquisition pipeline and runs the Onboarding Hand day by day', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const list = await t.call(exe, 'GET', '/api/analytics/acquisitions');
    const onboarding = list.json.acquisitions.find((a: any) => a.stage === 'onboarding');
    expect(onboarding).toBeTruthy();
    const run = await t.call(exe, 'POST', `/api/analytics/acquisitions/${onboarding.id}/onboarding-hand`, {});
    expect(run.json.task.status).toBe('done');
    expect((run.json.task.output.staged as string[]).length).toBeGreaterThan(0);
    // A target-stage acquisition is out of the Hand's mandate.
    const target = list.json.acquisitions.find((a: any) => a.stage === 'target');
    const refused = await t.call(exe, 'POST', `/api/analytics/acquisitions/${target.id}/onboarding-hand`, {});
    expect(refused.json.task.status).toBe('refused');
    // Go-live is blocked until the checklist is complete.
    const blocked = await t.call(exe, 'PATCH', `/api/analytics/acquisitions/${onboarding.id}`, { stage: 'live' });
    expect(blocked.status).toBe(400);
  });

  it('stores daily snapshots from the tick job', async () => {
    const { modules } = await import('../src/modules/index.js');
    const m16 = modules.find((m) => m.code === 'M16')!;
    const before = await t.services.db.select({ n: sql<number>`count(*)` }).from(schema.metricSnapshots).where(eq(schema.metricSnapshots.source, 'computed'));
    const out = await m16.tick!(t.services);
    expect((out as any).snapshots).toBeGreaterThan(0);
    const after = await t.services.db.select({ n: sql<number>`count(*)` }).from(schema.metricSnapshots).where(eq(schema.metricSnapshots.source, 'computed'));
    expect(Number(after[0]!.n)).toBeGreaterThan(Number(before[0]!.n));
    // Re-running the same day updates rather than duplicates.
    await m16.tick!(t.services);
    const third = await t.services.db.select({ n: sql<number>`count(*)` }).from(schema.metricSnapshots).where(eq(schema.metricSnapshots.source, 'computed'));
    expect(Number(third[0]!.n)).toBe(Number(after[0]!.n));
  });
});

describe('cluster D · M17 workforce and the Roster Hand', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('serves the roster week with gap hours and a staff list with credential state', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const roster = await t.call(prm, 'GET', '/api/workforce/roster?weeks=2');
    expect(roster.status).toBe(200);
    expect(roster.json.shifts.length).toBeGreaterThan(10);
    expect(roster.json.summary.plannedHours).toBeGreaterThan(0);
    const staff = await t.call(prm, 'GET', '/api/workforce/staff');
    expect(staff.json.staff.length).toBeGreaterThan(5);
    expect(staff.json.staff[0].credentials).toBeDefined();
  });

  it('blocks rostering a worker whose credential has lapsed, and allows a typed override', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const db = t.services.db;
    const [lapsed] = await db.select().from(schema.credentials).where(and(eq(schema.credentials.type, 'mammography'), sql`${schema.credentials.expiry} < date('now')`)).limit(1);
    expect(lapsed).toBeTruthy();
    const [st] = await db.select().from(schema.staff).where(eq(schema.staff.id, lapsed!.staffId)).limit(1);
    const [shift] = await db.select().from(schema.shifts).where(and(eq(schema.shifts.practiceId, st!.practiceId), eq(schema.shifts.status, 'open_gap'))).limit(1);
    const headers = { 'x-practice-id': st!.practiceId };
    const blocked = await t.call(prm, 'POST', `/api/workforce/shifts/${shift!.id}/assign`, { staffId: st!.id }, headers);
    expect(blocked.status).toBe(400);
    expect(blocked.json.message).toMatch(/Rostering blocked/);
    const overridden = await t.call(prm, 'POST', `/api/workforce/shifts/${shift!.id}/assign`, { staffId: st!.id, override: 'CMP grace period granted; renewal evidence uploaded' }, headers);
    expect(overridden.status).toBe(200);
  });

  it('evaluates BCEA hour and rest rules across sites', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const db = t.services.db;
    const [st] = await db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, PRAC_B), eq(schema.staff.role, 'RAD'))).limit(1);
    const res = await t.call(prm, 'GET', `/api/workforce/bcea/${st!.id}`);
    expect(res.json.rules.maxOrdinaryHoursPerWeek).toBe(45);
    expect(res.json.rules.minDailyRestHours).toBe(12);
    // A shift that starts a few hours after another one ends breaches daily rest.
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(schema.shifts).values({ id: 'shf_test_rest_a', practiceId: PRAC_B, siteId: 'site_umh', date: today, startTime: '07:00', endTime: '19:00', hours: 12, role: 'RAD', staffId: st!.id, status: 'confirmed' });
    const create = await t.call(prm, 'POST', '/api/workforce/shifts', { siteId: 'site_umh', date: today, startTime: '22:00', endTime: '23:00', role: 'RAD', staffId: st!.id });
    expect(create.status).toBe(400);
    expect(create.json.message).toMatch(/rest/i);
  });

  it('Roster Hand fills a gap from the internal pool within the leash', async () => {
    const db = t.services.db;
    const id = 'shf_test_gap_internal';
    const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await db.insert(schema.shifts).values({ id, practiceId: PRAC_B, siteId: 'site_umh', date, startTime: '08:00', endTime: '14:00', hours: 6, role: 'RAD', staffId: null, status: 'open_gap', gapReason: 'sick' });
    const task = await runHand(t.services, 'roster', { shiftId: id }, { practiceId: PRAC_B, trigger: 'test', title: 'fill gap' });
    expect(task.status).toBe('done');
    expect(task.output!.method).toBe('internal_swap');
    expect(task.output!.costCents).toBe(0);
    const [after] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
    expect(after!.status).toBe('confirmed');
    expect(after!.filledBy).toBe('roster_hand');
    await t.flush();
    const events = await db.select().from(schema.events).where(eq(schema.events.name, 'roster.filled.v1'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('Roster Hand needs PRM approval when agency cover is above the leash, then completes', async () => {
    const db = t.services.db;
    const id = 'shf_test_gap_agency';
    const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    // A competency nobody holds forces agency cover; twelve hours pushes the cost above the per-shift cap.
    await db.insert(schema.shifts).values({ id, practiceId: PRAC_B, siteId: 'site_umh', date, startTime: '07:00', endTime: '19:00', hours: 12, role: 'RAD', requiredCompetency: 'DX', staffId: null, status: 'open_gap', gapReason: 'resignation' });
    await db.update(schema.hands).set({ leash: { maxAgencyCentsPerShift: 100000, maxOvertimeHoursPerWeek: 10, minHoursBeforeStart: 12 } }).where(eq(schema.hands.id, 'roster'));
    // Remove every eligible DX worker at the site so the internal pool is empty.
    await db.update(schema.staff).set({ status: 'inactive' }).where(and(eq(schema.staff.practiceId, PRAC_B), eq(schema.staff.role, 'RAD')));
    const task = await runHand(t.services, 'roster', { shiftId: id }, { practiceId: PRAC_B, trigger: 'test', title: 'fill gap agency' });
    expect(task.status).toBe('needs_approval');
    expect(task.approvalPersona).toBe('PRM');
    expect(task.leashChecks.some((c: any) => c.rule === 'maxAgencyCentsPerShift' && !c.ok)).toBe(true);
    const prm = await t.login('prm@demo.bonakala');
    const approved = await t.call(prm, 'POST', `/api/hands/tasks/${task.id}/approve`, {});
    expect(approved.status).toBe(200);
    expect(approved.json.task.status).toBe('done');
    const [after] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
    expect(after!.status).toBe('agency');
    expect(after!.agencyCents).toBeGreaterThan(100000);
    await db.update(schema.staff).set({ status: 'active' }).where(and(eq(schema.staff.practiceId, PRAC_B), eq(schema.staff.role, 'RAD')));
  });

  it('opening a gap emits roster.gap.opened.v1 and lists it in gaps', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const db = t.services.db;
    const [shift] = await db.select().from(schema.shifts).where(and(eq(schema.shifts.practiceId, PRAC_B), eq(schema.shifts.status, 'confirmed'), sql`${schema.shifts.date} >= date('now')`)).limit(1);
    const res = await t.call(prm, 'POST', `/api/workforce/shifts/${shift!.id}/open-gap`, { reason: 'sick' });
    expect(res.status).toBe(200);
    await t.flush();
    const events = await db.select().from(schema.events).where(eq(schema.events.name, 'roster.gap.opened.v1'));
    expect(events.length).toBeGreaterThan(0);
    const gaps = await t.call(prm, 'GET', '/api/workforce/gaps');
    expect(gaps.json.gaps.some((g: any) => g.id === shift!.id)).toBe(true);
  });

  it('reports credential expiry and CPD pace, and hides productivity below the sample size', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const creds = await t.call(prm, 'GET', '/api/workforce/credentials');
    expect(creds.json.credentials.length).toBeGreaterThan(5);
    expect(creds.json.credentials.some((x: any) => ['expiring', 'lapsed', 'watch'].includes(x.state))).toBe(true);
    const cpd = await t.call(prm, 'GET', '/api/workforce/cpd');
    expect(cpd.json.target).toBe(30);
    expect(cpd.json.staff.length).toBeGreaterThan(3);
    const prod = await t.call(prm, 'GET', '/api/workforce/productivity');
    expect(prod.json.caseMixNote).toMatch(/case-mix weight/);
    expect(prod.json.rows.every((x: any) => x.suppressed === true || x.weightedStudiesPerHour === null || typeof x.weightedStudiesPerHour === 'number')).toBe(true);
  });
});

describe('cluster D · M18 assets, Maintenance Hand and the edge simulator', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('serves the fleet, devices, integrations and work-order kanban', async () => {
    const bio = await t.login('bio@demo.bonakala');
    const fleet = await t.call(bio, 'GET', '/api/assets/fleet');
    expect(fleet.json.gateways.length).toBe(4);
    expect(fleet.json.summary.offline).toBe(1);
    const devices = await t.call(bio, 'GET', '/api/assets/devices');
    expect(devices.json.devices.length).toBeGreaterThan(15);
    const integrations = await t.call(bio, 'GET', '/api/assets/integrations');
    expect(integrations.json.feeds.length).toBeGreaterThan(5);
    const wos = await t.call(bio, 'GET', '/api/assets/work-orders');
    expect(wos.json.columns).toEqual(['open', 'scheduled', 'in_progress', 'awaiting_parts', 'done']);
    expect(wos.json.workOrders.length).toBeGreaterThan(3);
  });

  it('Maintenance Hand opens a work order, a vendor ticket and a draft PO on modality.down.v1', async () => {
    const db = t.services.db;
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.practiceId, PRAC_A), eq(schema.assets.type, 'CT'))).limit(1);
    // A rising arc trend makes the predictive signal fire so a part order is drafted.
    for (let i = 0; i < 7; i++) {
      await db.insert(schema.telemetry).values({ id: `tel_test_${i}`, practiceId: asset!.practiceId, siteId: asset!.siteId, assetId: asset!.id, metric: 'tube_arc_count', value: 3, source: 'sim', at: new Date(Date.now() - i * 86400000).toISOString() });
    }
    await emitDirect(t.services, 'modality.down.v1', { modalityId: asset!.modalityId, siteId: asset!.siteId, type: asset!.type, status: 'down', reason: 'tube arc fault' }, { practiceId: PRAC_A });
    await t.flush();
    const wos = await db.select().from(schema.workOrders).where(and(eq(schema.workOrders.assetId, asset!.id), eq(schema.workOrders.type, 'breakdown')));
    expect(wos.length).toBeGreaterThan(0);
    const wo = wos[wos.length - 1]!;
    expect(wo.vendorTicket).toMatch(/^VT-/);
    expect(wo.status).toBe('scheduled');
    const [down] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset!.id)).limit(1);
    expect(down!.status).toBe('down');
    const pos = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.workOrderId, wo.id));
    expect(pos.length).toBe(1);
    expect(pos[0]!.status).toBe('awaiting_approval');
    expect(pos[0]!.raisedBy).toBe('maintenance_hand');
    const tasks = await db.select().from(schema.agentTasks).where(eq(schema.agentTasks.handId, 'maintenance'));
    expect(tasks.some((x) => x.status === 'done')).toBe(true);
  });

  it('enforces the work-order state machine and requires a root cause on a breakdown', async () => {
    const bio = await t.login('bio@demo.bonakala');
    const db = t.services.db;
    const [wo] = await db.select().from(schema.workOrders).where(and(eq(schema.workOrders.practiceId, PRAC_B), eq(schema.workOrders.type, 'breakdown'), eq(schema.workOrders.status, 'in_progress'))).limit(1);
    const headers = { 'x-practice-id': PRAC_B };
    const bad = await t.call(bio, 'PATCH', `/api/assets/work-orders/${wo!.id}`, { status: 'open' }, headers);
    expect(bad.status).toBe(400);
    const noCause = await t.call(bio, 'PATCH', `/api/assets/work-orders/${wo!.id}`, { status: 'done' }, headers);
    expect(noCause.status).toBe(400);
    const ok = await t.call(bio, 'PATCH', `/api/assets/work-orders/${wo!.id}`, { status: 'done', rootCause: 'Tube replaced under contract; QA verified' }, headers);
    expect(ok.status).toBe(200);
    const [after] = await db.select().from(schema.assets).where(eq(schema.assets.id, wo!.assetId!)).limit(1);
    expect(after!.status).toBe('in_service');
  });

  it('blocks issuing expired stock, decrements on issue and finds a lot across sites for a recall', async () => {
    const nur = await t.login('nur@demo.bonakala');
    const db = t.services.db;
    const [lot] = await db.select().from(schema.consumables).where(and(eq(schema.consumables.practiceId, PRAC_A), eq(schema.consumables.category, 'contrast'))).limit(1);
    const before = lot!.qtyOnHand;
    const issue = await t.call(nur, 'POST', `/api/assets/consumables/${lot!.id}/issue`, { qty: 2 });
    expect(issue.status).toBe(200);
    expect(issue.json.remaining).toBe(before - 2);
    await db.update(schema.consumables).set({ expiry: '2020-01-01' }).where(eq(schema.consumables.id, lot!.id));
    const blocked = await t.call(nur, 'POST', `/api/assets/consumables/${lot!.id}/issue`, { qty: 1 });
    expect(blocked.status).toBe(400);
    expect(blocked.json.message).toMatch(/expired/);
    const overridden = await t.call(nur, 'POST', `/api/assets/consumables/${lot!.id}/issue`, { qty: 1, override: 'CMP approved: emergency use, documented' });
    expect(overridden.status).toBe(200);
    const bio = await t.login('bio@demo.bonakala');
    const recall = await t.call(bio, 'GET', `/api/assets/consumables/recall/${lot!.lot}`);
    expect(recall.json.lots.length).toBeGreaterThan(0);
    expect(recall.json.issues.length).toBeGreaterThan(0);
  });

  it('brokers vendor remote access only with a typed confirmation', async () => {
    const bio = await t.login('bio@demo.bonakala');
    const db = t.services.db;
    const [session] = await db.select().from(schema.vendorAccessSessions).where(eq(schema.vendorAccessSessions.status, 'requested')).limit(1);
    const headers = { 'x-practice-id': session!.practiceId };
    const wrong = await t.call(bio, 'POST', `/api/assets/vendor-access/${session!.id}/approve`, { confirm: 'yes' }, headers);
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toBe('confirm_required');
    const right = await t.call(bio, 'POST', `/api/assets/vendor-access/${session!.id}/approve`, { confirm: session!.ref }, headers);
    expect(right.status).toBe(200);
    const [after] = await db.select().from(schema.vendorAccessSessions).where(eq(schema.vendorAccessSessions.id, session!.id)).limit(1);
    expect(after!.status).toBe('approved');
    expect(after!.recordingRef).toBeTruthy();
  });

  it('edge simulator takes a site offline, accumulates backlog and drains it on return', async () => {
    const db = t.services.db;
    const app = t.app;
    const post = async (path: string, body: unknown) => {
      const res = await app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      return { status: res.status, json: await res.json() as any };
    };
    const off = await post('/api/sim/edge/state', { siteId: 'site_san', state: 'offline' });
    expect(off.status).toBe(200);
    expect(off.json.backlog).toBeGreaterThan(0);
    const [gw] = await db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.siteId, 'site_san')).limit(1);
    expect(gw!.status).toBe('offline');
    expect(gw!.localWorklistMirror).toBe(true);
    // Draining is refused while the link is down.
    const early = await post('/api/sim/edge/drain', { siteId: 'site_san', batch: 5 });
    expect(early.status).toBe(409);
    await post('/api/sim/edge/state', { siteId: 'site_san', state: 'on_ups', backlog: 12 });
    const drained = await post('/api/sim/edge/drain', { siteId: 'site_san', batch: 12 });
    expect(drained.json.remaining).toBe(0);
    const status = await app.request('/api/sim/edge/status');
    const fleet = await status.json() as any;
    expect(fleet.gateways.find((g: any) => g.siteId === 'site_san').backlogStudies).toBe(0);
    // A simulated failure emits modality.down.v1 which the Maintenance Hand consumes.
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.siteId, 'site_rbg'), eq(schema.assets.kind, 'modality'))).limit(1);
    const fail = await post('/api/sim/edge/fail', { assetId: asset!.id, reason: 'heartbeat lost' });
    expect(fail.json.emitted).toBe('modality.down.v1');
    await t.flush();
    const wos = await db.select().from(schema.workOrders).where(eq(schema.workOrders.assetId, asset!.id));
    expect(wos.length).toBeGreaterThan(0);
  });

  it('load-shedding simulator publishes windows and puts sites on UPS', async () => {
    const app = t.app;
    const post = async (path: string, body: unknown) => {
      const res = await app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      return { status: res.status, json: await res.json() as any };
    };
    const staged = await post('/api/sim/loadshedding/stage', { stage: 4, siteIds: ['site_umh'] });
    expect(staged.json.windows.length).toBeGreaterThan(0);
    const status = await (await app.request('/api/sim/loadshedding/status')).json() as any;
    expect(status.windows.some((w: any) => w.siteId === 'site_umh' && w.stage === 4)).toBe(true);
    expect(status.generatorCover.site_bal).toEqual([]);
  });
});

describe('cluster D · M19 compliance', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('shows the board, the statutory register and the regulatory calendar', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const headers = { 'x-practice-id': PRAC_A };
    const board = await t.call(cmp, 'GET', '/api/compliance/board', undefined, headers);
    expect(board.status).toBe(200);
    expect(board.json.tiles.obligations.total).toBeGreaterThanOrEqual(60);
    expect(board.json.tiles.obligations.overdue).toBeGreaterThan(0);
    expect(board.json.tiles.reportableResults.open).toBeGreaterThan(0);
    const register = await t.call(cmp, 'GET', '/api/compliance/register', undefined, headers);
    expect(register.json.obligations.length).toBeGreaterThanOrEqual(60);
    expect(register.json.obligations.some((o: any) => o.status === 'confirm')).toBe(true);
    expect(register.json.obligations.some((o: any) => o.state === 'overdue')).toBe(true);
    expect(register.json.domains).toContain('radiation');
    const calendar = await t.call(cmp, 'GET', '/api/compliance/calendar?days=120', undefined, headers);
    expect(calendar.json.items.length).toBeGreaterThan(10);
    expect(calendar.json.leadDays).toEqual([90, 60, 30, 7, 0]);
  });

  it('a compliance persona with no practice selected sees every practice in scope', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    // No x-practice-id header: CMP is a cross-tenant oversight role.
    const board = await t.call(cmp, 'GET', '/api/compliance/board');
    expect(board.status).toBe(200);
    const scoped = await t.call(cmp, 'GET', '/api/compliance/board', undefined, { 'x-practice-id': PRAC_A });
    expect(board.json.tiles.obligations.total).toBeGreaterThan(scoped.json.tiles.obligations.total);
    const register = await t.call(cmp, 'GET', '/api/compliance/register');
    expect(register.json.obligations.length).toBeGreaterThan(scoped.json.tiles.obligations.total);
    // Writes still belong to one practice.
    const blocked = await t.call(cmp, 'POST', '/api/compliance/requests', { type: 'access', requesterMasked: '····0001' });
    expect(blocked.status).toBe(400);
    expect(blocked.json.error).toBe('practice_required');
  });

  it('Compliance Hand drafts a regulator report but can never submit it', async () => {
    const db = t.services.db;
    const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.category, 'contrast_reaction')).limit(1);
    const task = await runHand(t.services, 'compliance', { action: 'draft_regulator_report', incidentId: inc!.id }, { practiceId: inc!.practiceId, trigger: 'test', title: 'draft' });
    expect(task.status).toBe('done');
    expect(task.output!.submitted).toBe(false);
    expect(task.output!.draftStatus).toBe('awaiting_cmp');
    // The Hand has no tool that can transmit externally (M19-R-111).
    const handDef = (await import('../src/kernel/hands.js')).getHand('compliance')!.def;
    expect(Object.keys(handDef.tools).some((x) => /submit|regulator\.send|external/.test(x))).toBe(false);
    const [after] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, inc!.id)).limit(1);
    expect(after!.reportDraft!.status).toBe('awaiting_cmp');
    expect(after!.reportDraft!.text).toMatch(/not submitted/i);
    expect(after!.timeline.some((x: any) => x.kind === 'ai')).toBe(true);
  });

  it('CMP submission requires a typed confirmation and records the named submitter', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const db = t.services.db;
    const [inc] = await db.select().from(schema.incidents).where(eq(schema.incidents.ref, 'INC-2609-031')).limit(1);
    const headers = { 'x-practice-id': inc!.practiceId };
    expect(inc!.reportDraft!.status).toBe('awaiting_cmp');
    const wrong = await t.call(cmp, 'POST', `/api/compliance/incidents/${inc!.id}/submit-report`, { confirm: 'submit' }, headers);
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toBe('confirm_required');
    // A non-CMP persona cannot submit at all.
    const prm = await t.login('prm@demo.bonakala');
    const forbidden = await t.call(prm, 'POST', `/api/compliance/incidents/${inc!.id}/submit-report`, { confirm: inc!.ref }, headers);
    expect(forbidden.status).toBe(403);
    const ok = await t.call(cmp, 'POST', `/api/compliance/incidents/${inc!.id}/submit-report`, { confirm: inc!.ref, reference: 'SAHPRA-DEMO-0042' }, headers);
    expect(ok.status).toBe(200);
    const [after] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, inc!.id)).limit(1);
    expect(after!.reportDraft!.status).toBe('submitted');
    expect(after!.reportDraft!.submittedBy).toBeTruthy();
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'incident.report_submitted'));
    expect(audits.length).toBe(1);
  });

  it('a severity 1 incident cannot be closed without an RCA and corrective actions', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const headers = { 'x-practice-id': PRAC_A };
    const created = await t.call(cmp, 'POST', '/api/compliance/incidents', { category: 'radiation_overexposure', severity: 1, title: 'Test overexposure', siteId: 'site_san' }, headers);
    expect(created.status).toBe(201);
    const blocked = await t.call(cmp, 'POST', `/api/compliance/incidents/${created.json.id}/close`, { learningSummary: 'Closed without investigation' }, headers);
    expect(blocked.status).toBe(400);
    expect(blocked.json.message).toMatch(/root-cause/);
    await t.call(cmp, 'POST', `/api/compliance/incidents/${created.json.id}/investigate`, { rca: { method: 'Contributing-factor framework', factors: [{ factor: 'Task', finding: 'Protocol selection error' }] }, correctiveActions: [{ action: 'Protocol double-check', owner: 'RAD', due: '2026-12-01' }] }, headers);
    const closed = await t.call(cmp, 'POST', `/api/compliance/incidents/${created.json.id}/close`, { learningSummary: 'Protocol selection is now double-checked at the console across all sites.' }, headers);
    expect(closed.status).toBe(200);
    await t.flush();
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'incident.opened.v1'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('creates a reportable result from report.signed.v1 with reportableCategories', async () => {
    const db = t.services.db;
    const before = await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.practiceId, PRAC_B));
    await emitDirect(t.services, 'report.signed.v1', {
      reportId: 'rep_test_tb', studyId: 'std_test_tb', accession: 'BUMH-26-0000999-1', patientId: 'pat_nomvula', practiceId: PRAC_B, siteId: 'site_umh',
      referrerId: 'ref_naidoo', radiologistUserId: 'user_rgt', procedureCodes: ['30110'], icd10: ['A15.0'], critical: false,
      reportableCategories: ['tb_suggestive'], signedAt: new Date().toISOString(),
    }, { practiceId: PRAC_B });
    await t.flush();
    const after = await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.practiceId, PRAC_B));
    expect(after.length).toBe(before.length + 1);
    const created = after.find((x) => x.reportId === 'rep_test_tb')!;
    expect(created.category).toBe('tb_suggestive');
    expect(created.categoryLabel).toMatch(/notifiable medical condition/);
    expect(created.referrerName).toBe('Dr S. Naidoo');
    expect(created.patientMasked).toMatch(/^····\d{4}/);
    expect(created.ackWindowHours).toBe(24);
    expect(created.status).toBe('open');
    expect(created.notes).toMatch(/not a diagnosis/);
    // Re-emitting the same report does not duplicate the flag.
    await emitDirect(t.services, 'report.signed.v1', { reportId: 'rep_test_tb', studyId: 'std_test_tb', accession: 'BUMH-26-0000999-1', patientId: 'pat_nomvula', practiceId: PRAC_B, siteId: 'site_umh', referrerId: 'ref_naidoo', radiologistUserId: 'user_rgt', procedureCodes: ['30110'], icd10: ['A15.0'], critical: false, reportableCategories: ['tb_suggestive'], signedAt: new Date().toISOString() }, { practiceId: PRAC_B });
    await t.flush();
    const again = await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.practiceId, PRAC_B));
    expect(again.length).toBe(after.length);
    // A safeguarding category withholds patient-facing release.
    await emitDirect(t.services, 'report.signed.v1', { reportId: 'rep_test_nai', studyId: 'std_test_nai', accession: 'BUMH-26-0000998-4', practiceId: PRAC_B, siteId: 'site_umh', patientId: 'pat_nomvula', referrerId: 'ref_naidoo', radiologistUserId: 'user_rgt', procedureCodes: ['30110'], icd10: ['S02.0'], critical: false, reportableCategories: ['nai_child'], signedAt: new Date().toISOString() }, { practiceId: PRAC_B });
    await t.flush();
    const nai = (await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.reportId, 'rep_test_nai')))[0]!;
    expect(nai.patientReleaseWithheld).toBe(true);
    expect(nai.ackWindowHours).toBe(1);
  });

  it('a reportable result is acknowledged before it can be closed', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const db = t.services.db;
    const [rr] = await db.select().from(schema.reportableResults).where(and(eq(schema.reportableResults.practiceId, PRAC_B), eq(schema.reportableResults.status, 'open'))).limit(1);
    const headers = { 'x-practice-id': PRAC_B };
    const early = await t.call(cmp, 'POST', `/api/compliance/reportable-results/${rr!.id}/close`, { note: 'closing early' }, headers);
    expect(early.status).toBe(400);
    const ack = await t.call(cmp, 'POST', `/api/compliance/reportable-results/${rr!.id}/acknowledge`, { by: 'Dr S. Naidoo' }, headers);
    expect(ack.status).toBe(200);
    expect(ack.json.withinWindow).toBe(true);
    const closed = await t.call(cmp, 'POST', `/api/compliance/reportable-results/${rr!.id}/close`, { note: 'Referrer confirmed the notification route was followed' }, headers);
    expect(closed.status).toBe(200);
  });

  it('tracks data-subject request clocks and blocks fulfilment before the checklist is done', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const headers = { 'x-practice-id': PRAC_A };
    const list = await t.call(cmp, 'GET', '/api/compliance/requests', undefined, headers);
    expect(list.json.requests.length).toBeGreaterThan(0);
    for (const r of list.json.requests) {
      expect(r.statutoryDays).toBe(30);
      expect(r.statutoryPct).toBeGreaterThanOrEqual(0);
      expect(typeof r.statutoryDaysLeft).toBe('number');
    }
    const created = await t.call(cmp, 'POST', '/api/compliance/requests', { type: 'access', requesterMasked: '····9911' }, headers);
    expect(created.status).toBe(201);
    const early = await t.call(cmp, 'PATCH', `/api/compliance/requests/${created.json.id}`, { status: 'fulfilled' }, headers);
    expect(early.status).toBe(400);
    for (let i = 0; i < 6; i++) await t.call(cmp, 'PATCH', `/api/compliance/requests/${created.json.id}`, { checklistIndex: i }, headers);
    const done = await t.call(cmp, 'PATCH', `/api/compliance/requests/${created.json.id}`, { status: 'fulfilled' }, headers);
    expect(done.status).toBe(200);
    await t.flush();
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'data_subject_request.fulfilled.v1'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('generates an evidence pack with a manifest and an HTML rendering, and never submits it', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const headers = { 'x-practice-id': PRAC_A };
    const res = await t.call(cmp, 'POST', '/api/compliance/evidence-packs', { kind: 'sahpra' }, headers);
    expect(res.status).toBe(201);
    expect(res.json.task.status).toBe('done');
    expect(res.json.task.output.submitted).toBe(false);
    expect(res.json.task.output.items.length).toBeGreaterThan(3);
    const packId = res.json.packId as string;
    const pack = await t.call(cmp, 'GET', `/api/compliance/evidence-packs/${packId}`, undefined, headers);
    expect(pack.json.pack.manifest.items.every((x: any) => typeof x.hash === 'string' && x.hash.length === 16)).toBe(true);
    expect(pack.json.pack.html).toMatch(/evidence pack/i);
    expect(pack.json.pack.html).toMatch(/has been submitted to a regulator/);
  });

  it('serves complaints with SLA state and feature flags for the admin console', async () => {
    const cmp = await t.login('cmp@demo.bonakala');
    const headers = { 'x-practice-id': PRAC_A };
    const complaints = await t.call(cmp, 'GET', '/api/compliance/complaints', undefined, headers);
    expect(complaints.json.complaints.length).toBeGreaterThan(0);
    expect(complaints.json.complaints.some((x: any) => x.route === 'HPCSA' && x.legalHold === true)).toBe(true);
    const flags = await t.call(cmp, 'GET', '/api/compliance/feature-flags');
    expect(flags.json.flags.length).toBeGreaterThan(0);
    const patched = await t.call(cmp, 'PATCH', '/api/compliance/feature-flags/demo_mode', { value: true, reason: 'test' });
    expect(patched.status).toBe(200);
  });

  it('escalates unacknowledged reportable results weekly from the tick job', async () => {
    const db = t.services.db;
    const { modules } = await import('../src/modules/index.js');
    const m19 = modules.find((m) => m.code === 'M19')!;
    const [rr] = await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.status, 'open')).limit(1);
    await db.update(schema.reportableResults).set({ ackDueAt: new Date(Date.now() - 9 * 86400000).toISOString(), createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), lastEscalatedAt: null }).where(eq(schema.reportableResults.id, rr!.id));
    const out = await m19.tick!(t.services) as any;
    expect(out.reportableEscalations).toBeGreaterThan(0);
    const [after] = await db.select().from(schema.reportableResults).where(eq(schema.reportableResults.id, rr!.id)).limit(1);
    expect(after!.escalations).toBe(1);
    // It does not escalate again within the week.
    const second = await m19.tick!(t.services) as any;
    expect(second.reportableEscalations).toBe(0);
  });
});

describe('cluster D · admin surfaces', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('lists the Hands this cluster registers with their leashes, and a leash update flows through', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const list = await t.call(prm, 'GET', '/api/hands');
    const ids = list.json.hands.map((h: any) => h.id);
    expect(ids).toContain('roster');
    expect(ids).toContain('maintenance');
    expect(ids).toContain('compliance');
    expect(ids).toContain('insight');
    expect(ids).toContain('onboarding');
    const roster = list.json.hands.find((h: any) => h.id === 'roster');
    expect(roster.leash.maxAgencyCentsPerShift).toBe(400000);
    expect(roster.level).toBe('A3');
    const patched = await t.call(prm, 'PATCH', '/api/hands/roster', { leash: { maxAgencyCentsPerShift: 250000 }, status: 'shadow', reason: 'Tightening agency spend for the quarter' });
    expect(patched.status).toBe(200);
    const after = await t.call(prm, 'GET', '/api/hands');
    expect(after.json.hands.find((h: any) => h.id === 'roster').leash.maxAgencyCentsPerShift).toBe(250000);
    expect(after.json.hands.find((h: any) => h.id === 'roster').status).toBe('shadow');
    // The change is in the audit log with its reason, for the version history panel.
    const audits = await t.services.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'hand.updated'));
    expect(audits.length).toBeGreaterThan(0);
    expect((audits[audits.length - 1]!.details as any).reason).toMatch(/agency spend/);
  });

  it('exposes Hand tasks awaiting approval for the practice approvals page', async () => {
    const db = t.services.db;
    const id = 'shf_approval_demo';
    const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    await db.update(schema.hands).set({ leash: { maxAgencyCentsPerShift: 1000 }, status: 'active' }).where(eq(schema.hands.id, 'roster'));
    await db.update(schema.staff).set({ status: 'inactive' }).where(and(eq(schema.staff.practiceId, PRAC_B), eq(schema.staff.role, 'RAD')));
    await db.insert(schema.shifts).values({ id, practiceId: PRAC_B, siteId: 'site_umh', date, startTime: '08:00', endTime: '16:00', hours: 8, role: 'RAD', staffId: null, status: 'open_gap', gapReason: 'sick' });
    await runHand(t.services, 'roster', { shiftId: id }, { practiceId: PRAC_B, trigger: 'test', title: 'Roster Hand: fill gap' });
    const prm = await t.login('prm@demo.bonakala');
    const tasks = await t.call(prm, 'GET', '/api/hands/tasks?status=needs_approval');
    expect(tasks.json.tasks.length).toBeGreaterThan(0);
    expect(tasks.json.tasks[0].approvalPersona).toBe('PRM');
    expect(tasks.json.tasks[0].leashChecks.some((c: any) => !c.ok)).toBe(true);
  });
});
