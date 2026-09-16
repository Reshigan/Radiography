import { z } from 'zod';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId, notFound, invalid, conflict, todaySast, maskId, Refused } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, registerHand, runHand, on } from '../../kernel/index.js';
import type { Services } from '../../kernel/ports.js';
import { REPORTABLE_CATEGORIES, categoryFor } from './categories.js';

const r = router();
const READERS = ['CMP', 'PRM', 'EXE', 'SUP', 'BIO', 'AIO', 'RGT', 'RAD', 'NUR', 'SHR', 'BIL'] as const;

function addDays(date: string, n: number): string {
  const d = new Date(date.length > 10 ? date : `${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.round((new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${todaySast()}T00:00:00Z`).getTime()) / 86400000);
}
async function nextRef(services: Services, prefix: string, practiceId: string): Promise<string> {
  const { nextSequence } = await import('../../kernel/events.js');
  const yymm = todaySast().slice(2, 4) + todaySast().slice(5, 7);
  const n = await nextSequence(services, `${prefix}:${practiceId}:${yymm}`);
  return `${prefix}-${yymm}-${String(n).padStart(3, '0')}`;
}

/* ================= Board ================= */
r.get('/board', allow(...READERS), async (c) => {
  const services = c.get('services');
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const today = todaySast();
  const obligations = await services.db.select().from(schema.obligations).where(practiceId ? eq(schema.obligations.practiceId, practiceId) : undefined);
  const overdue = obligations.filter((o) => o.dueDate && o.dueDate < today && (!o.lastDoneAt || o.lastDoneAt < o.dueDate));
  const due30 = obligations.filter((o) => o.dueDate && o.dueDate >= today && (daysUntil(o.dueDate) ?? 999) <= 30);
  const incidents = await services.db.select().from(schema.incidents).where(and(practiceId ? eq(schema.incidents.practiceId, practiceId) : undefined, sql`${schema.incidents.status} != 'closed'`));
  const rr = await services.db.select().from(schema.reportableResults).where(and(practiceId ? eq(schema.reportableResults.practiceId, practiceId) : undefined, sql`${schema.reportableResults.status} != 'closed'`));
  const dsr = await services.db.select().from(schema.dataSubjectRequests).where(and(practiceId ? eq(schema.dataSubjectRequests.practiceId, practiceId) : undefined, sql`${schema.dataSubjectRequests.status} not in ('fulfilled','refused')`));
  const findings = await services.db.select({ f: schema.auditFindings, a: schema.audits }).from(schema.auditFindings).innerJoin(schema.audits, eq(schema.audits.id, schema.auditFindings.auditId)).where(and(practiceId ? eq(schema.auditFindings.practiceId, practiceId) : undefined, eq(schema.auditFindings.status, 'open')));
  const rooms = await services.db.select({ room: schema.rooms, site: schema.sites }).from(schema.rooms).innerJoin(schema.sites, eq(schema.sites.id, schema.rooms.siteId)).where(practiceId ? eq(schema.rooms.practiceId, practiceId) : undefined);
  const licences = rooms.filter((x) => x.room.licenceNo && (daysUntil(x.room.licenceExpiry) ?? 999) <= 90).map((x) => ({ roomId: x.room.id, label: `${x.site.name} ${x.room.name}`, licenceNo: x.room.licenceNo, expiry: x.room.licenceExpiry, days: daysUntil(x.room.licenceExpiry) }));
  const creds = await services.db.select({ c: schema.credentials, s: schema.staff }).from(schema.credentials).innerJoin(schema.staff, eq(schema.staff.id, schema.credentials.staffId)).where(and(practiceId ? eq(schema.credentials.practiceId, practiceId) : undefined, sql`${schema.credentials.expiry} <= ${addDays(today, 90)}`));
  return c.json({
    tiles: {
      obligations: { total: obligations.length, current: obligations.length - overdue.length - due30.length, due30: due30.length, overdue: overdue.length },
      incidentsByRegulator: ['SAHPRA', 'Information Regulator', 'HPCSA', 'DoEL'].map((reg) => ({ regulator: reg, open: incidents.filter((i) => i.regulator === reg).length })),
      incidentsOpen: incidents.length,
      reportableResults: { open: rr.length, awaitingAck: rr.filter((x) => x.status === 'open').length, acknowledged: rr.filter((x) => x.status === 'acknowledged').length },
      licenceExpiries: licences,
      credentialExpiries: creds.map((x) => ({ staff: x.s.name, type: x.c.type, expiry: x.c.expiry, days: daysUntil(x.c.expiry) })),
      dataSubjectRequests: { open: dsr.length, withinPolicy: dsr.filter((x) => x.policyDueAt >= new Date().toISOString()).length, pastStatutory: dsr.filter((x) => x.statutoryDueAt < new Date().toISOString()).length },
      auditFindings: { open: findings.length, major: findings.filter((x) => x.f.grade === 'major').length, pastDue: findings.filter((x) => x.f.dueDate && x.f.dueDate < today).length, byType: [...new Set(findings.map((x) => x.a.type))].map((t) => ({ type: t, n: findings.filter((x) => x.a.type === t).length })) },
    },
    asOf: new Date().toISOString(),
  });
});

/* ================= Statutory register ================= */
r.get('/register', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const { domain, status, q } = query(c, z.object({ domain: z.string().optional(), status: z.string().optional(), q: z.string().optional() }));
  const rows = await c.get('services').db.select().from(schema.obligations).where(and(practiceId ? eq(schema.obligations.practiceId, practiceId) : undefined, domain ? eq(schema.obligations.domain, domain) : undefined, status ? eq(schema.obligations.status, status) : undefined)).orderBy(asc(schema.obligations.dueDate));
  const today = todaySast();
  const filtered = q ? rows.filter((o) => `${o.instrument} ${o.obligation} ${o.section ?? ''}`.toLowerCase().includes(q.toLowerCase())) : rows;
  return c.json({
    obligations: filtered.map((o) => ({ ...o, daysToDue: daysUntil(o.dueDate), state: o.dueDate && o.dueDate < today && (!o.lastDoneAt || o.lastDoneAt < o.dueDate) ? 'overdue' : (daysUntil(o.dueDate) ?? 999) <= 30 ? 'due' : 'current' })),
    domains: [...new Set(rows.map((o) => o.domain))],
  });
});
const obligationInput = z.object({
  domain: z.string(), instrument: z.string().min(2), section: z.string().optional(), obligation: z.string().min(5), responsibleEntity: z.string(), ownerPersona: z.string(), trigger: z.string().optional(),
  control: z.string().optional(), output: z.string().optional(), evidence: z.string().optional(), automation: z.string().default('A2'), status: z.enum(['confirmed', 'confirm']).default('confirmed'),
  frequency: z.string().default('annual'), dueDate: z.string().optional(), siteId: z.string().optional(),
});
r.post('/register', allow('CMP', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, obligationInput);
  const id = newId('obl');
  await c.get('services').db.insert(schema.obligations).values({ id, practiceId, ...data, evidenceRefs: [] });
  await audit(c, 'obligation.created', { type: 'obligation', id }, { instrument: data.instrument });
  await generateCalendar(c.get('services'), practiceId, id);
  return c.json({ id }, 201);
});
r.patch('/register/:id', allow('CMP', 'SUP', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, obligationInput.partial().extend({ lastDoneAt: z.string().optional(), submissionRef: z.string().optional(), evidenceRefs: z.array(z.string()).optional() }));
  const [row] = await services.db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
  if (!row) throw notFound('Obligation');
  await services.db.update(schema.obligations).set({ ...data, version: row.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.obligations.id, id));
  await audit(c, 'obligation.updated', { type: 'obligation', id }, { fields: Object.keys(data), version: row.version + 1 });
  if (data.lastDoneAt) await emit(c, 'obligation.discharged.v1', { obligationId: id, at: data.lastDoneAt, submissionRef: data.submissionRef ?? null }, { aggregateType: 'obligation', aggregateId: id });
  return c.json({ ok: true, version: row.version + 1 });
});

/* ================= Regulatory calendar ================= */
const LEADS = [90, 60, 30, 7, 0];
async function generateCalendar(services: Services, practiceId: string, obligationId?: string): Promise<number> {
  const rows = await services.db.select().from(schema.obligations).where(and(eq(schema.obligations.practiceId, practiceId), obligationId ? eq(schema.obligations.id, obligationId) : undefined));
  const existing = await services.db.select({ obligationId: schema.obligationEvents.obligationId, leadDays: schema.obligationEvents.leadDays, dueDate: schema.obligationEvents.dueDate }).from(schema.obligationEvents).where(eq(schema.obligationEvents.practiceId, practiceId));
  const have = new Set(existing.map((e) => `${e.obligationId}:${e.dueDate}:${e.leadDays}`));
  const today = todaySast();
  let made = 0;
  for (const o of rows) {
    if (!o.dueDate) continue;
    for (const lead of LEADS) {
      const key = `${o.id}:${o.dueDate}:${lead}`;
      if (have.has(key)) continue;
      const fire = addDays(o.dueDate, -lead);
      await services.db.insert(schema.obligationEvents).values({
        id: newId('oev'), practiceId, obligationId: o.id, dueDate: o.dueDate, leadDays: lead, fireDate: fire,
        title: `${o.instrument}${o.section ? ` ${o.section}` : ''} · ${lead ? `${lead}-day lead` : 'due'}`,
        assignee: o.ownerPersona, status: fire < today ? (o.lastDoneAt && o.lastDoneAt >= o.dueDate ? 'done' : o.dueDate < today ? 'overdue' : 'notified') : 'pending',
      });
      made++;
    }
  }
  return made;
}
r.get('/calendar', allow(...READERS), async (c) => {
  const services = c.get('services');
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const { days } = query(c, z.object({ days: z.coerce.number().min(30).max(365).default(90) }));
  const rows = await services.db.select({ e: schema.obligationEvents, o: schema.obligations }).from(schema.obligationEvents).innerJoin(schema.obligations, eq(schema.obligations.id, schema.obligationEvents.obligationId))
    .where(and(practiceId ? eq(schema.obligationEvents.practiceId, practiceId) : undefined, gte(schema.obligationEvents.dueDate, addDays(todaySast(), -30)), lte(schema.obligationEvents.dueDate, addDays(todaySast(), days)))).orderBy(asc(schema.obligationEvents.dueDate));
  const byDue = new Map<string, { dueDate: string; obligationId: string; title: string; instrument: string; owner: string; automation: string; leads: number[]; state: string; daysToDue: number | null; evidenceCount: number }>();
  for (const { e, o } of rows) {
    const key = `${o.id}:${e.dueDate}`;
    const cur = byDue.get(key) ?? { dueDate: e.dueDate, obligationId: o.id, title: o.obligation, instrument: o.instrument, owner: o.ownerPersona, automation: o.automation, leads: [], state: e.status, daysToDue: daysUntil(e.dueDate), evidenceCount: (o.evidenceRefs ?? []).length };
    cur.leads.push(e.leadDays);
    if (e.status === 'overdue') cur.state = 'overdue';
    byDue.set(key, cur);
  }
  return c.json({ items: [...byDue.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), leadDays: LEADS, days });
});
r.post('/calendar/generate', allow('CMP', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const made = await generateCalendar(c.get('services'), practiceId);
  await audit(c, 'calendar.generated', { type: 'practice', id: practiceId }, { made });
  return c.json({ generated: made });
});

/* ================= Incidents ================= */
r.get('/incidents', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const { status } = query(c, z.object({ status: z.string().optional() }));
  const rows = await c.get('services').db.select().from(schema.incidents).where(and(practiceId ? eq(schema.incidents.practiceId, practiceId) : undefined, status ? eq(schema.incidents.status, status) : undefined)).orderBy(desc(schema.incidents.reportedAt));
  return c.json({ incidents: rows });
});
r.get('/incidents/:id', allow(...READERS), async (c) => {
  const [row] = await c.get('services').db.select().from(schema.incidents).where(eq(schema.incidents.id, param(c, 'id'))).limit(1);
  if (!row) throw notFound('Incident');
  return c.json({ incident: row });
});
const INCIDENT_CATEGORIES = ['radiation_wrong_patient', 'radiation_wrong_site', 'radiation_overexposure', 'contrast_reaction', 'data_breach', 'mri_safety', 'fall', 'needle_stick', 'equipment', 'critical_result_failure', 'ai_performance', 'ai_slip', 'near_miss'] as const;
const REGULATOR_FOR: Record<string, string> = {
  radiation_wrong_patient: 'SAHPRA', radiation_wrong_site: 'SAHPRA', radiation_overexposure: 'SAHPRA', contrast_reaction: 'SAHPRA', mri_safety: 'SAHPRA', equipment: 'SAHPRA',
  data_breach: 'Information Regulator', needle_stick: 'DoEL', fall: 'none', critical_result_failure: 'none', ai_performance: 'SAHPRA', ai_slip: 'SAHPRA', near_miss: 'none',
};
r.post('/incidents', allow('CMP', 'PRM', 'RAD', 'RGT', 'NUR', 'BIO', 'FDK', 'SUP', 'AIO'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({
    category: z.enum(INCIDENT_CATEGORIES), severity: z.number().int().min(1).max(4).default(3), title: z.string().min(4), description: z.string().optional(), siteId: z.string().optional(),
    occurredAt: z.string().optional(), patientMasked: z.string().optional(), patientId: z.string().optional(), modalityId: z.string().optional(), roomId: z.string().optional(), immediateActions: z.array(z.string()).optional(),
  }));
  const now = new Date().toISOString();
  const id = newId('inc');
  const ref = await nextRef(services, 'INC', practiceId);
  await services.db.insert(schema.incidents).values({
    id, practiceId, siteId: data.siteId ?? null, ref, category: data.category, severity: data.severity, title: data.title, description: data.description ?? null,
    occurredAt: data.occurredAt ?? now, reportedAt: now, reportedBy: c.get('user')!.id, patientMasked: data.patientMasked ?? null, patientId: data.patientId ?? null,
    modalityId: data.modalityId ?? null, roomId: data.roomId ?? null, status: 'open',
    timeline: [{ at: now, text: `Incident reported: ${data.title}`, kind: 'crit', source: 'report' }],
    immediateActions: (data.immediateActions ?? []).map((item) => ({ item, done: false })),
    rca: null, correctiveActions: [], disclosure: {}, regulator: REGULATOR_FOR[data.category] ?? 'none',
    reportDraft: { status: 'none' }, linkedRefs: [],
  });
  await audit(c, 'incident.opened', { type: 'incident', id }, { ref, category: data.category, severity: data.severity });
  await emit(c, 'incident.opened.v1', { incidentId: id, practiceId, category: data.category, severity: data.severity }, { aggregateType: 'incident', aggregateId: id });
  return c.json({ id, ref }, 201);
});
r.post('/incidents/:id/investigate', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ rca: z.object({ method: z.string(), factors: z.array(z.object({ factor: z.string(), finding: z.string() })), conclusion: z.string().optional(), investigator: z.string().optional() }).optional(), correctiveActions: z.array(z.object({ action: z.string(), owner: z.string(), due: z.string() })).optional(), note: z.string().optional(), disclosure: z.record(z.string()).optional() }));
  const [row] = await services.db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  if (!row) throw notFound('Incident');
  if (row.status === 'closed') throw conflict('Incident is closed');
  const now = new Date().toISOString();
  const timeline = [...row.timeline, { at: now, text: data.note ?? 'Investigation updated', kind: 'neutral' as const, source: 'investigation' }];
  await services.db.update(schema.incidents).set({
    status: 'investigating', rca: data.rca ?? row.rca, timeline,
    correctiveActions: data.correctiveActions ? data.correctiveActions.map((a) => ({ ...a, status: 'open' as const })) : row.correctiveActions,
    disclosure: { ...(row.disclosure ?? {}), ...(data.disclosure ?? {}) }, updatedAt: now,
  }).where(eq(schema.incidents.id, id));
  await audit(c, 'incident.investigated', { type: 'incident', id }, { rca: !!data.rca, actions: data.correctiveActions?.length ?? 0 });
  return c.json({ ok: true });
});
r.post('/incidents/:id/close', allow('CMP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { learningSummary } = await body(c, z.object({ learningSummary: z.string().min(10) }));
  const [row] = await services.db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  if (!row) throw notFound('Incident');
  if (row.severity <= 2 && (!row.rca || !(row.correctiveActions ?? []).length)) throw invalid('Severity 1–2 incidents need a completed root-cause analysis and at least one corrective action before closure (M19-R-106)');
  if (row.reportDraft?.status === 'draft' || row.reportDraft?.status === 'awaiting_cmp') throw invalid('A regulator report is still awaiting submission; submit or withdraw it before closing');
  const now = new Date().toISOString();
  await services.db.update(schema.incidents).set({ status: 'closed', closedAt: now, closedBy: c.get('user')!.id, learningSummary, timeline: [...row.timeline, { at: now, text: 'Closed by CMP with learning summary', kind: 'ok' as const }], updatedAt: now }).where(eq(schema.incidents.id, id));
  await audit(c, 'incident.closed', { type: 'incident', id }, { ref: row.ref });
  await emit(c, 'incident.closed.v1', { incidentId: id, practiceId: row.practiceId, category: row.category }, { aggregateType: 'incident', aggregateId: id });
  return c.json({ ok: true });
});
/** The Compliance Hand drafts a regulator report. It can never submit (R19-R-301, M19-R-111). */
r.post('/incidents/:id/draft-report', allow('CMP', 'PRM', 'SUP', 'BIO'), async (c) => {
  const id = param(c, 'id');
  const task = await runHand(c.get('services'), 'compliance', { action: 'draft_regulator_report', incidentId: id }, { practiceId: requirePractice(c), trigger: 'manual', title: 'Compliance Hand: draft regulator report', aggregateType: 'incident', aggregateId: id });
  await audit(c, 'incident.report_drafted', { type: 'incident', id }, { taskId: task.id, status: task.status });
  return c.json({ task });
});
/** Human submission only: CMP, with a typed confirmation of the incident reference. */
r.post('/incidents/:id/submit-report', allow('CMP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { confirm, reference, channel } = await body(c, z.object({ confirm: z.string(), reference: z.string().optional(), channel: z.string().default('SAHPRA Radiation Control portal') }));
  const [row] = await services.db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
  if (!row) throw notFound('Incident');
  if (confirm !== row.ref) return c.json({ error: 'confirm_required', message: `Type the incident reference ${row.ref} to confirm submission`, expected: row.ref }, 400);
  if (!row.reportDraft || row.reportDraft.status === 'none') throw invalid('There is no draft report to submit');
  if (row.reportDraft.status === 'submitted') throw conflict('This report has already been submitted');
  const now = new Date().toISOString();
  const user = c.get('user')!;
  await services.db.update(schema.incidents).set({
    reportDraft: { ...row.reportDraft, status: 'submitted' as const, submittedBy: user.id, submittedAt: now, reference: reference ?? undefined },
    status: row.status === 'open' ? 'investigating' : row.status,
    timeline: [...row.timeline, { at: now, text: `Report submitted to ${row.regulator} by ${user.name} (${channel})${reference ? ` · reference ${reference}` : ''}`, kind: 'ok' as const, source: 'submission' }], updatedAt: now,
  }).where(eq(schema.incidents.id, id));
  await audit(c, 'incident.report_submitted', { type: 'incident', id }, { regulator: row.regulator, reference, submitter: user.id, channel });
  await emit(c, 'incident.report_submitted.v1', { incidentId: id, regulator: row.regulator, submittedBy: user.id, reference: reference ?? null }, { aggregateType: 'incident', aggregateId: id });
  return c.json({ ok: true, submittedBy: user.name, at: now });
});

/* ================= Complaints ================= */
r.get('/complaints', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.complaints).where(practiceId ? eq(schema.complaints.practiceId, practiceId) : undefined).orderBy(desc(schema.complaints.receivedAt));
  const now = new Date().toISOString();
  return c.json({ complaints: rows.map((x) => ({ ...x, ackOverdue: !x.acknowledgedAt && x.acknowledgeBy < now, respondOverdue: !x.respondedAt && x.respondBy < now, slaPct: Math.min(100, Math.round(((Date.now() - new Date(x.receivedAt).getTime()) / (new Date(x.respondBy).getTime() - new Date(x.receivedAt).getTime())) * 100)) })) });
});
r.post('/complaints', allow('CMP', 'PRM', 'FDK', 'BKG', 'SUP', 'BIL'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ channel: z.string(), route: z.enum(['internal', 'CPA', 'HPCSA', 'CMS']).default('internal'), category: z.string(), subject: z.string().min(4), detail: z.string().optional(), complainantMasked: z.string().optional(), severity: z.enum(['minor', 'moderate', 'major']).default('minor'), siteId: z.string().optional(), externalRef: z.string().optional() }));
  const now = new Date().toISOString();
  const id = newId('cmp');
  const ref = await nextRef(services, 'CPL', practiceId);
  const respondDays = data.route === 'HPCSA' ? 21 : data.route === 'CMS' ? 14 : 20;
  await services.db.insert(schema.complaints).values({
    id, practiceId, siteId: data.siteId ?? null, ref, channel: data.channel, route: data.route, category: data.category, subject: data.subject, detail: data.detail ?? null,
    complainantMasked: data.complainantMasked ?? null, severity: data.severity, receivedAt: now, acknowledgeBy: new Date(Date.now() + 86400000).toISOString(), respondBy: new Date(Date.now() + respondDays * 86400000).toISOString(),
    status: 'received', externalRef: data.externalRef ?? null, legalHold: data.route === 'HPCSA',
  });
  await audit(c, 'complaint.received', { type: 'complaint', id }, { ref, route: data.route });
  await emit(c, 'complaint.received.v1', { complaintId: id, practiceId, route: data.route, category: data.category }, { aggregateType: 'complaint', aggregateId: id });
  return c.json({ id, ref }, 201);
});
r.patch('/complaints/:id', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ status: z.enum(['acknowledged', 'investigating', 'responded', 'closed']).optional(), response: z.string().optional(), externalRef: z.string().optional() }));
  const [row] = await services.db.select().from(schema.complaints).where(eq(schema.complaints.id, id)).limit(1);
  if (!row) throw notFound('Complaint');
  const now = new Date().toISOString();
  await services.db.update(schema.complaints).set({
    status: data.status ?? row.status,
    acknowledgedAt: data.status === 'acknowledged' && !row.acknowledgedAt ? now : row.acknowledgedAt,
    respondedAt: data.status === 'responded' || data.status === 'closed' ? row.respondedAt ?? now : row.respondedAt,
    responseDraft: data.response ? { text: data.response, provenance: { modelId: 'human', modelVersion: 'n/a', outputClass: 4, createdAt: now }, accepted: true } : row.responseDraft,
    externalRef: data.externalRef ?? row.externalRef, updatedAt: now,
  }).where(eq(schema.complaints.id, id));
  await audit(c, 'complaint.updated', { type: 'complaint', id }, data);
  return c.json({ ok: true });
});

/* ================= Data-subject requests ================= */
const DSR_CHECKLIST = ['Identity verified (ID match plus OTP to the registered number)', 'Record set collected (studies, reports, claims, disclosure log)', 'Third-party data reviewed for redaction under PAIA grounds', 'Response drafted', 'Information Officer approved release', 'Delivered through the Patient Space share link'];
r.get('/requests', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.dataSubjectRequests).where(practiceId ? eq(schema.dataSubjectRequests.practiceId, practiceId) : undefined).orderBy(desc(schema.dataSubjectRequests.receivedAt));
  const now = Date.now();
  return c.json({
    requests: rows.map((x) => {
      const total = new Date(x.statutoryDueAt).getTime() - new Date(x.receivedAt).getTime();
      const policyTotal = new Date(x.policyDueAt).getTime() - new Date(x.receivedAt).getTime();
      return { ...x, statutoryPct: Math.min(100, Math.round(((now - new Date(x.receivedAt).getTime()) / total) * 100)), policyPct: Math.min(100, Math.round(((now - new Date(x.receivedAt).getTime()) / policyTotal) * 100)), statutoryDaysLeft: Math.round((new Date(x.statutoryDueAt).getTime() - now) / 86400000), pastStatutory: x.statutoryDueAt < new Date().toISOString() && !x.fulfilledAt };
    }),
    note: 'Statutory period 30 days (illustrative; POPIA and PAIA timelines are configurable reference data). Policy clock is the Practice’s internal target.',
  });
});
r.post('/requests', allow('CMP', 'PRM', 'FDK', 'SUP', 'PAT'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ type: z.enum(['access', 'correction', 'deletion', 'objection', 'paia']), requesterMasked: z.string().min(3).optional(), patientId: z.string().optional(), channel: z.string().default('patient_space'), statutoryDays: z.number().int().default(30), policyDays: z.number().int().default(14) }));
  // A patient can only ever request their own data: identity and subject are derived from the
  // session, never taken from the request body, so a PAT user cannot name another patientId or
  // impersonate a different requester string.
  let patientId = data.patientId ?? null;
  let requesterMasked = data.requesterMasked;
  if (user.persona === 'PAT') {
    if (!user.patientId) return c.json({ error: 'no_patient' }, 404);
    const [p] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, user.patientId)).limit(1);
    if (!p) throw notFound('Patient');
    patientId = p.id;
    requesterMasked = `${p.firstName[0] ?? ''}. ${p.lastName} · ${maskId(p.idNumber)}`;
  } else if (!requesterMasked) {
    throw invalid('requesterMasked is required');
  }
  const now = new Date();
  const id = newId('dsr');
  const ref = await nextRef(services, 'DSR', practiceId);
  await services.db.insert(schema.dataSubjectRequests).values({
    id, practiceId, ref, type: data.type, requesterMasked: requesterMasked!, patientId, channel: data.channel,
    receivedAt: now.toISOString(), statutoryDays: data.statutoryDays, statutoryDueAt: new Date(now.getTime() + data.statutoryDays * 86400000).toISOString(),
    policyDays: data.policyDays, policyDueAt: new Date(now.getTime() + data.policyDays * 86400000).toISOString(),
    status: 'received', checklist: DSR_CHECKLIST.map((item) => ({ item, done: false })),
  });
  await audit(c, 'dsr.received', { type: 'data_subject_request', id }, { ref, type: data.type });
  await emit(c, 'data_subject_request.received.v1', { requestId: id, practiceId, type: data.type }, { aggregateType: 'data_subject_request', aggregateId: id });
  return c.json({ id, ref }, 201);
});
r.patch('/requests/:id', allow('CMP', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ status: z.enum(['verifying', 'collecting', 'awaiting_approval', 'fulfilled', 'refused', 'extended']).optional(), checklistIndex: z.number().int().optional(), identityVerified: z.boolean().optional(), extensionReason: z.string().optional(), redactions: z.array(z.object({ item: z.string(), ground: z.string() })).optional() }));
  const [row] = await services.db.select().from(schema.dataSubjectRequests).where(eq(schema.dataSubjectRequests.id, id)).limit(1);
  if (!row) throw notFound('Request');
  const now = new Date().toISOString();
  const checklist = [...row.checklist];
  if (data.checklistIndex !== undefined && checklist[data.checklistIndex]) checklist[data.checklistIndex] = { ...checklist[data.checklistIndex]!, done: true, at: now };
  if (data.status === 'fulfilled' && checklist.some((x) => !x.done)) throw invalid('Complete the request checklist before recording fulfilment');
  await services.db.update(schema.dataSubjectRequests).set({
    status: data.status ?? row.status, checklist, identityVerified: data.identityVerified ?? row.identityVerified,
    fulfilledAt: data.status === 'fulfilled' ? now : row.fulfilledAt, releasedBy: data.status === 'fulfilled' ? c.get('user')!.id : row.releasedBy,
    extensionReason: data.extensionReason ?? row.extensionReason, redactions: data.redactions ?? row.redactions,
    statutoryDueAt: data.status === 'extended' ? new Date(new Date(row.statutoryDueAt).getTime() + 30 * 86400000).toISOString() : row.statutoryDueAt, updatedAt: now,
  }).where(eq(schema.dataSubjectRequests.id, id));
  await audit(c, 'dsr.updated', { type: 'data_subject_request', id }, data);
  if (data.status === 'fulfilled') await emit(c, 'data_subject_request.fulfilled.v1', { requestId: id, practiceId: row.practiceId, inTime: now <= row.statutoryDueAt }, { aggregateType: 'data_subject_request', aggregateId: id });
  return c.json({ ok: true });
});

/* ================= Audits, findings and policies ================= */
r.get('/audits', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const services = c.get('services');
  const audits = await services.db.select().from(schema.audits).where(practiceId ? eq(schema.audits.practiceId, practiceId) : undefined).orderBy(desc(schema.audits.scheduledAt));
  const findings = await services.db.select().from(schema.auditFindings).where(practiceId ? eq(schema.auditFindings.practiceId, practiceId) : undefined);
  return c.json({ audits: audits.map((a) => ({ ...a, findings: findings.filter((f) => f.auditId === a.id) })) });
});
r.post('/audits/:id/findings', allow('CMP', 'SUP'), async (c) => {
  const auditId = param(c, 'id');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ grade: z.enum(['major', 'minor', 'observation']), description: z.string().min(5), owner: z.string().optional(), dueDate: z.string().optional(), capa: z.string().optional() }));
  const id = newId('fnd');
  await c.get('services').db.insert(schema.auditFindings).values({ id, practiceId, auditId, ...data });
  await audit(c, 'audit.finding_raised', { type: 'audit_finding', id }, { auditId, grade: data.grade });
  return c.json({ id }, 201);
});
r.post('/findings/:id/close', allow('CMP', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { capa } = await body(c, z.object({ capa: z.string().min(5) }));
  await c.get('services').db.update(schema.auditFindings).set({ status: 'closed', capa, closedAt: new Date().toISOString() }).where(eq(schema.auditFindings.id, id));
  await audit(c, 'audit.finding_closed', { type: 'audit_finding', id }, { capa });
  return c.json({ ok: true });
});
r.get('/policies', allow(...READERS), async (c) => {
  const services = c.get('services');
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const pols = await services.db.select().from(schema.policies).where(practiceId ? sql`${schema.policies.practiceId} is null or ${schema.policies.practiceId} = ${practiceId}` : undefined).orderBy(asc(schema.policies.category));
  const staffRows = await services.db.select({ id: schema.staff.id }).from(schema.staff).where(and(practiceId ? eq(schema.staff.practiceId, practiceId) : undefined, eq(schema.staff.status, 'active')));
  const acks = await services.db.select().from(schema.policyAcknowledgements).where(practiceId ? eq(schema.policyAcknowledgements.practiceId, practiceId) : undefined);
  return c.json({ policies: pols.map((p) => ({ ...p, acknowledged: acks.filter((a) => a.policyId === p.id && a.version === p.version).length, inScope: staffRows.length, coveragePct: staffRows.length ? Math.round((acks.filter((a) => a.policyId === p.id && a.version === p.version).length / staffRows.length) * 100) : null })) });
});
r.post('/policies/:id/acknowledge', allow('CMP', 'PRM', 'RAD', 'RGT', 'NUR', 'FDK', 'BIO', 'SUP', 'BIL', 'DEB', 'BKG'), async (c) => {
  const policyId = param(c, 'id');
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { staffId } = await body(c, z.object({ staffId: z.string() }));
  const [p] = await services.db.select().from(schema.policies).where(eq(schema.policies.id, policyId)).limit(1);
  if (!p) throw notFound('Policy');
  const exists = await services.db.select({ id: schema.policyAcknowledgements.id }).from(schema.policyAcknowledgements).where(and(eq(schema.policyAcknowledgements.policyId, policyId), eq(schema.policyAcknowledgements.staffId, staffId), eq(schema.policyAcknowledgements.version, p.version))).limit(1);
  if (exists.length) return c.json({ ok: true, already: true });
  const id = newId('ack');
  await services.db.insert(schema.policyAcknowledgements).values({ id, practiceId, policyId, staffId, version: p.version, acknowledgedAt: new Date().toISOString() });
  await audit(c, 'policy.acknowledged', { type: 'policy', id: policyId }, { staffId, version: p.version });
  return c.json({ ok: true });
});

/* ================= Reportable results (docs/24 §3) ================= */
r.get('/reportable-results', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.reportableResults).where(practiceId ? eq(schema.reportableResults.practiceId, practiceId) : undefined).orderBy(desc(schema.reportableResults.createdAt));
  const now = new Date().toISOString();
  return c.json({
    results: rows.map((x) => ({ ...x, ackOverdue: !x.ackAt && x.ackDueAt < now, ackPct: Math.min(100, Math.round(((Date.now() - new Date(x.createdAt).getTime()) / Math.max(1, new Date(x.ackDueAt).getTime() - new Date(x.createdAt).getTime())) * 100)) })),
    categories: REPORTABLE_CATEGORIES,
    note: 'The Platform never notifies a regulator from a report: the referrer acknowledges, the practitioner notifies (docs/24 §3).',
  });
});
r.post('/reportable-results', allow('CMP', 'RGT', 'PRM', 'SUP'), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ category: z.string(), patientMasked: z.string().optional(), patientId: z.string().optional(), reportId: z.string().optional(), studyId: z.string().optional(), accession: z.string().optional(), referrerId: z.string().optional(), referrerName: z.string().optional(), siteId: z.string().optional() }));
  const id = await createReportableResult(services, { practiceId, ...data });
  await audit(c, 'reportable_result.created', { type: 'reportable_result', id }, { category: data.category });
  return c.json({ id }, 201);
});
export async function createReportableResult(services: Services, input: { practiceId: string; category: string; patientMasked?: string | null; patientId?: string | null; reportId?: string | null; studyId?: string | null; accession?: string | null; referrerId?: string | null; referrerName?: string | null; siteId?: string | null; linkedIncidentId?: string | null }): Promise<string> {
  const cat = categoryFor(input.category);
  const id = newId('rr');
  const ref = await nextRef(services, 'RR', input.practiceId);
  const now = new Date();
  await services.db.insert(schema.reportableResults).values({
    id, practiceId: input.practiceId, siteId: input.siteId ?? null, ref, category: cat.id, categoryLabel: cat.label,
    patientMasked: input.patientMasked ?? null, patientId: input.patientId ?? null, reportId: input.reportId ?? null, studyId: input.studyId ?? null, accession: input.accession ?? null,
    referrerId: input.referrerId ?? null, referrerName: input.referrerName ?? null, ackWindowHours: cat.ackWindowHours,
    ackDueAt: new Date(now.getTime() + cat.ackWindowHours * 3600000).toISOString(),
    packName: cat.pack, packSentAt: now.toISOString(), packChannel: 'Referrer Space and WhatsApp',
    status: 'open', patientReleaseWithheld: cat.withholdPatientRelease, escalations: 0, linkedIncidentId: input.linkedIncidentId ?? null, notes: cat.statement,
  });
  return id;
}
r.post('/reportable-results/:id/acknowledge', allow('CMP', 'PRM', 'RGT', 'SUP', 'FDK'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { by } = await body(c, z.object({ by: z.string().min(2) }));
  const [row] = await services.db.select().from(schema.reportableResults).where(eq(schema.reportableResults.id, id)).limit(1);
  if (!row) throw notFound('Reportable result');
  const now = new Date().toISOString();
  await services.db.update(schema.reportableResults).set({ status: 'acknowledged', ackAt: now, ackBy: by, updatedAt: now }).where(eq(schema.reportableResults.id, id));
  await audit(c, 'reportable_result.acknowledged', { type: 'reportable_result', id }, { by, withinWindow: now <= row.ackDueAt });
  await emit(c, 'reportable_result.acknowledged.v1', { reportableResultId: id, practiceId: row.practiceId, category: row.category, withinWindow: now <= row.ackDueAt }, { aggregateType: 'reportable_result', aggregateId: id });
  return c.json({ ok: true, withinWindow: now <= row.ackDueAt });
});
r.post('/reportable-results/:id/close', allow('CMP', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { note } = await body(c, z.object({ note: z.string().min(3) }));
  const [row] = await services.db.select().from(schema.reportableResults).where(eq(schema.reportableResults.id, id)).limit(1);
  if (!row) throw notFound('Reportable result');
  if (row.status === 'open') throw invalid('The referrer must acknowledge before the flag can be closed');
  const now = new Date().toISOString();
  await services.db.update(schema.reportableResults).set({ status: 'closed', closedAt: now, closedBy: c.get('user')!.id, notes: `${row.notes ?? ''}\nClosure: ${note}`, updatedAt: now }).where(eq(schema.reportableResults.id, id));
  await audit(c, 'reportable_result.closed', { type: 'reportable_result', id }, { note });
  await emit(c, 'reportable_result.closed.v1', { reportableResultId: id, practiceId: row.practiceId, category: row.category }, { aggregateType: 'reportable_result', aggregateId: id });
  return c.json({ ok: true });
});

/* ================= Evidence packs ================= */
const PACK_SECTIONS: Record<string, Array<{ section: string; source: string }>> = {
  sahpra: [{ section: 'Radiation licence register', source: 'rooms' }, { section: 'QA schedule and due dates', source: 'modalities' }, { section: 'Radiation incidents', source: 'incidents' }, { section: 'Radiation worker register and dosimetry badges', source: 'staff' }, { section: 'Equipment register and service contracts', source: 'assets' }, { section: 'Obligations: radiation domain', source: 'obligations' }],
  hpcsa: [{ section: 'Practitioner registration verification', source: 'credentials' }, { section: 'CPD status per practitioner', source: 'cpd_points' }, { section: 'Peer review programme summary', source: 'obligations' }, { section: 'Practice ethics policies', source: 'policies' }],
  popia: [{ section: 'Data-subject requests and fulfilment', source: 'data_subject_requests' }, { section: 'Breach register', source: 'incidents' }, { section: 'Access audit summary', source: 'audit_log' }, { section: 'Information policies and acknowledgements', source: 'policies' }],
  ohsc: [{ section: 'Facility obligations', source: 'obligations' }, { section: 'Incidents and complaints', source: 'incidents' }, { section: 'Policies', source: 'policies' }],
  cms: [{ section: 'Complaints register (CMS route)', source: 'complaints' }, { section: 'Obligations: funders domain', source: 'obligations' }],
  accreditation: [{ section: 'Audits and findings', source: 'audits' }, { section: 'Policies and acknowledgements', source: 'policies' }, { section: 'Incident and complaint trends', source: 'incidents' }],
  internal: [{ section: 'Obligations', source: 'obligations' }, { section: 'Incidents', source: 'incidents' }, { section: 'Audits', source: 'audits' }],
};
r.get('/evidence-packs', allow(...READERS), async (c) => {
  // Compliance is a cross-tenant oversight role: with no practice selected the read
  // surfaces aggregate across the practices in scope (docs/12 §17, aggregated view).
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.evidencePacks).where(practiceId ? eq(schema.evidencePacks.practiceId, practiceId) : undefined).orderBy(desc(schema.evidencePacks.createdAt)).limit(30);
  return c.json({ packs: rows.map((p) => ({ ...p, html: undefined })), kinds: Object.keys(PACK_SECTIONS) });
});
r.get('/evidence-packs/:id', allow(...READERS), async (c) => {
  const [row] = await c.get('services').db.select().from(schema.evidencePacks).where(eq(schema.evidencePacks.id, param(c, 'id'))).limit(1);
  if (!row) throw notFound('Evidence pack');
  if (c.req.query('format') === 'html') return c.html(row.html ?? '<p>No rendering stored.</p>');
  return c.json({ pack: row });
});
r.post('/evidence-packs', allow('CMP', 'SUP', 'PRM'), async (c) => {
  const practiceId = requirePractice(c);
  const { kind, siteId } = await body(c, z.object({ kind: z.enum(['sahpra', 'hpcsa', 'popia', 'ohsc', 'cms', 'accreditation', 'internal']).default('sahpra'), siteId: z.string().optional() }));
  const task = await runHand(c.get('services'), 'compliance', { action: 'collect_evidence', kind, siteId: siteId ?? null }, { practiceId, trigger: 'manual', title: `Compliance Hand: ${kind.toUpperCase()} evidence pack` });
  await audit(c, 'evidence_pack.generated', { type: 'evidence_pack', id: (task.output?.packId as string) ?? task.id }, { kind, taskId: task.id });
  return c.json({ task, packId: task.output?.packId ?? null }, 201);
});

/* ================= Feature flags (M19 owns the governance surface) ================= */
r.get('/feature-flags', allow('CMP', 'SUP', 'EXE', 'PRM', 'AIO'), async (c) => {
  const rows = await c.get('services').db.select().from(schema.featureFlags);
  return c.json({ flags: rows });
});
r.patch('/feature-flags/:key', allow('CMP', 'SUP', 'EXE'), async (c) => {
  const key = param(c, 'key');
  const services = c.get('services');
  const { value, reason } = await body(c, z.object({ value: z.unknown(), reason: z.string().min(3) }));
  const [row] = await services.db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, key)).limit(1);
  if (row) await services.db.update(schema.featureFlags).set({ value, updatedAt: new Date().toISOString() }).where(eq(schema.featureFlags.key, key));
  else await services.db.insert(schema.featureFlags).values({ key, value, practiceId: c.get('practiceId') });
  await audit(c, 'feature_flag.updated', { type: 'feature_flag', id: key }, { from: row?.value, to: value, reason });
  return c.json({ ok: true });
});

/* ================= Compliance Hand ================= */
const complianceHand = defineHand({
  id: 'compliance', name: 'Compliance Hand', module: 'M19', level: 'A2',
  mandate: 'Keep the compliance calendar current and evidenced; draft submissions, notifications and responses; chase expiring items; prepare audit and inspection packs. Never submits to a regulator, never closes an incident, never changes a severity or a policy.',
  defaultLeash: { maxRemindersPerDay: 50, canSubmitExternally: false, maxEvidenceItems: 500 },
  approvalPersona: 'CMP',
  approvalPolicy: 'Drafts stay drafts. External submission is a human action by CMP with a typed confirmation (M19-R-301, M19-R-111).',
  tools: { 'registers.read': 'R0', 'evidence.collect': 'R0', 'pack.generate': 'R1', 'draft.write': 'R1', 'task.create': 'R1', 'reminder.internal': 'R2', 'llm.summarise': 'R0' },
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}

export default defineModule({
  code: 'M19', name: 'Quality, Risk & Compliance', basePath: 'compliance', routes: r,
  boot(services) {
    registerHand<{ action: string; incidentId?: string; kind?: string; siteId?: string | null }, Record<string, unknown>>(complianceHand, async (input, ctx) => {
      const practiceId = ctx.practiceId!;
      if (input.action === 'draft_regulator_report') {
        const [inc] = await ctx.services.db.select().from(schema.incidents).where(eq(schema.incidents.id, input.incidentId!)).limit(1);
        if (!inc) throw new Error('Incident not found');
        if (inc.regulator === 'none') throw new Refused('This incident category carries no regulator notification duty; no report drafted.');
        const context = await ctx.step('registers.read', { incidentId: inc.id }, async () => {
          const site = inc.siteId ? (await ctx.services.db.select().from(schema.sites).where(eq(schema.sites.id, inc.siteId)).limit(1))[0] : null;
          const room = inc.roomId ? (await ctx.services.db.select().from(schema.rooms).where(eq(schema.rooms.id, inc.roomId)).limit(1))[0] : null;
          return { site: site?.name ?? 'site not recorded', licence: room?.licenceNo ?? 'licence not recorded', room: room?.name ?? 'room not recorded' };
        });
        const factLines = [
          `Incident reference: ${inc.ref}`,
          `Category: ${inc.category.replace(/_/g, ' ')} · severity ${inc.severity}`,
          `Licence holder site: ${context.site} · room ${context.room} · licence ${context.licence}`,
          `Occurred: ${inc.occurredAt} · reported: ${inc.reportedAt}`,
          `Patient (masked): ${inc.patientMasked ?? 'not applicable'}`,
          `Description: ${inc.description ?? inc.title}`,
          `Immediate actions: ${(inc.immediateActions ?? []).map((a) => `${a.item}${a.done ? ' (done)' : ' (open)'}`).join('; ') || 'none recorded'}`,
          `Investigation: ${inc.rca ? `${inc.rca.method}; ${inc.rca.factors.map((f) => `${f.factor}: ${f.finding}`).join('; ')}` : 'in progress'}`,
          `Corrective actions: ${(inc.correctiveActions ?? []).map((a) => `${a.action} (owner ${a.owner}, due ${a.due})`).join('; ') || 'to be confirmed'}`,
          `Timeline reconstructed from Platform events: ${inc.timeline.map((t) => `${t.at.slice(11, 16)} ${t.text}`).join(' · ')}`,
        ];
        let text = `DRAFT notification to ${inc.regulator} — not submitted.\n\n${factLines.join('\n')}\n\nThis draft is prepared from Platform records for CMP review. Submission to ${inc.regulator} is a human action with a named submitter (docs/24 §6, M19-R-301).`;
        if (ctx.services.llm.available) {
          text = await ctx.step('llm.summarise', { incidentRef: inc.ref }, () => ctx.services.llm.complete({
            system: 'You draft a factual regulator notification for a South African radiology practice. Use only the facts given, no speculation, no legal conclusions, South African English, no exclamation marks. Start with "DRAFT notification — not submitted."',
            user: factLines.join('\n'),
          }), 'Drafted from de-identified incident facts only');
        }
        const now = new Date().toISOString();
        await ctx.step('draft.write', { incidentId: inc.id }, async () => {
          await ctx.services.db.update(schema.incidents).set({
            reportDraft: { status: 'awaiting_cmp', text, draftedAt: now, provenance: { modelId: 'compliance-draft', modelVersion: '1.4.0', outputClass: 3, createdAt: now, demo: ctx.services.demoMode, llm: ctx.services.llm.available } },
            status: inc.status === 'open' ? 'investigating' : inc.status,
            timeline: [...inc.timeline, { at: now, text: `Compliance Hand drafted the ${inc.regulator} notification; awaiting CMP review`, kind: 'ai' as const, source: 'hand' }], updatedAt: now,
          }).where(eq(schema.incidents.id, inc.id));
          return { drafted: true };
        }, 'Draft stored on the incident; the Hand has no tool that can submit it');
        await ctx.step('task.create', { for: 'CMP', incidentRef: inc.ref }, async () => ({ task: `Review and submit ${inc.regulator} notification for ${inc.ref}` }));
        return { incidentId: inc.id, ref: inc.ref, regulator: inc.regulator, draftStatus: 'awaiting_cmp', text, submitted: false, note: 'The Compliance Hand cannot submit; CMP submits with a typed confirmation.' };
      }

      if (input.action === 'collect_evidence') {
        const kind = input.kind ?? 'sahpra';
        const sections = PACK_SECTIONS[kind] ?? PACK_SECTIONS.internal!;
        const items: Array<{ section: string; source: string; count: number; hash: string; note?: string }> = [];
        const details: Array<{ section: string; rows: string[] }> = [];
        for (const s of sections) {
          const collected = await ctx.step('evidence.collect', { section: s.section, source: s.source }, async () => {
            const rows: string[] = [];
            switch (s.source) {
              case 'rooms': {
                const q = await ctx.services.db.select({ room: schema.rooms, site: schema.sites }).from(schema.rooms).innerJoin(schema.sites, eq(schema.sites.id, schema.rooms.siteId)).where(and(eq(schema.rooms.practiceId, practiceId), input.siteId ? eq(schema.rooms.siteId, input.siteId) : undefined));
                for (const x of q) if (x.room.licenceNo) rows.push(`${x.site.name} ${x.room.name} · licence ${x.room.licenceNo} · expires ${x.room.licenceExpiry ?? 'not recorded'}`);
                break;
              }
              case 'modalities': {
                const q = await ctx.services.db.select().from(schema.modalities).where(and(eq(schema.modalities.practiceId, practiceId), input.siteId ? eq(schema.modalities.siteId, input.siteId) : undefined));
                for (const m of q) rows.push(`${m.type} ${m.model ?? ''} (${m.serial ?? 'no serial'}) · last QA ${m.lastQaAt ?? 'not recorded'} · next QA ${m.nextQaDue ?? 'not scheduled'} · status ${m.status}`);
                break;
              }
              case 'incidents': {
                const q = await ctx.services.db.select().from(schema.incidents).where(eq(schema.incidents.practiceId, practiceId));
                const relevant = kind === 'sahpra' ? q.filter((i) => i.regulator === 'SAHPRA') : kind === 'popia' ? q.filter((i) => i.category === 'data_breach') : q;
                for (const i of relevant) rows.push(`${i.ref} · ${i.category.replace(/_/g, ' ')} · severity ${i.severity} · ${i.status} · report ${i.reportDraft?.status ?? 'none'}`);
                break;
              }
              case 'staff': {
                const q = await ctx.services.db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, practiceId), eq(schema.staff.radiationWorker, true)));
                for (const s2 of q) rows.push(`${s2.name} · ${s2.role} · badge ${s2.dosimetryBadge ?? 'not issued'} · HPCSA ${s2.hpcsaNo ?? 'n/a'} expires ${s2.hpcsaExpiry ?? 'n/a'}`);
                break;
              }
              case 'assets': {
                const q = await ctx.services.db.select().from(schema.assets).where(and(eq(schema.assets.practiceId, practiceId), eq(schema.assets.kind, 'modality')));
                for (const a of q) rows.push(`${a.name} · ${a.vendor ?? ''} ${a.model ?? ''} · status ${a.status} · uptime 30 d ${a.uptime30dPct ?? '—'} % · contract to ${a.serviceContract?.expires ?? 'n/a'}`);
                break;
              }
              case 'credentials': {
                const q = await ctx.services.db.select({ c: schema.credentials, s: schema.staff }).from(schema.credentials).innerJoin(schema.staff, eq(schema.staff.id, schema.credentials.staffId)).where(eq(schema.credentials.practiceId, practiceId));
                for (const x of q) rows.push(`${x.s.name} · ${x.c.type} ${x.c.number ?? ''} · expires ${x.c.expiry ?? 'n/a'} · ${x.c.verified ? 'verified' : 'unverified'}`);
                break;
              }
              case 'cpd_points': {
                const q = await ctx.services.db.select({ staffId: schema.cpdPoints.staffId, pts: sql<number>`sum(${schema.cpdPoints.points})`, eth: sql<number>`sum(${schema.cpdPoints.ethicsPoints})` }).from(schema.cpdPoints).where(eq(schema.cpdPoints.practiceId, practiceId)).groupBy(schema.cpdPoints.staffId);
                const names = await ctx.services.db.select({ id: schema.staff.id, name: schema.staff.name }).from(schema.staff).where(eq(schema.staff.practiceId, practiceId));
                for (const x of q) rows.push(`${names.find((n) => n.id === x.staffId)?.name ?? x.staffId} · ${Number(x.pts)} CEUs (${Number(x.eth)} ethics) this cycle`);
                break;
              }
              case 'obligations': {
                const q = await ctx.services.db.select().from(schema.obligations).where(eq(schema.obligations.practiceId, practiceId));
                const dom = kind === 'sahpra' ? 'radiation' : kind === 'popia' ? 'information' : kind === 'cms' ? 'funders' : null;
                for (const o of q.filter((x) => !dom || x.domain === dom)) rows.push(`${o.instrument}${o.section ? ` ${o.section}` : ''} · ${o.obligation.slice(0, 90)} · due ${o.dueDate ?? 'n/a'} · ${o.status === 'confirm' ? '[confirm]' : 'confirmed'}`);
                break;
              }
              case 'data_subject_requests': {
                const q = await ctx.services.db.select().from(schema.dataSubjectRequests).where(eq(schema.dataSubjectRequests.practiceId, practiceId));
                for (const x of q) rows.push(`${x.ref} · ${x.type} · received ${x.receivedAt.slice(0, 10)} · due ${x.statutoryDueAt.slice(0, 10)} · ${x.status}`);
                break;
              }
              case 'audit_log': {
                const q = await ctx.services.db.select({ n: sql<number>`count(*)` }).from(schema.auditLog).where(eq(schema.auditLog.practiceId, practiceId));
                rows.push(`${Number(q[0]?.n ?? 0)} audit entries in range, hash-chained (chain verification on the board)`);
                break;
              }
              case 'policies': {
                const q = await ctx.services.db.select().from(schema.policies).where(practiceId ? sql`${schema.policies.practiceId} is null or ${schema.policies.practiceId} = ${practiceId}` : undefined);
                for (const p of q) rows.push(`${p.title} v${p.version} · effective ${p.effectiveDate} · ${p.category}`);
                break;
              }
              case 'complaints': {
                const q = await ctx.services.db.select().from(schema.complaints).where(eq(schema.complaints.practiceId, practiceId));
                for (const x of q) rows.push(`${x.ref} · ${x.route} · ${x.category} · ${x.status} · respond by ${x.respondBy.slice(0, 10)}`);
                break;
              }
              case 'audits': {
                const q = await ctx.services.db.select().from(schema.audits).where(eq(schema.audits.practiceId, practiceId));
                for (const x of q) rows.push(`${x.ref} · ${x.type} · ${x.scope} · ${x.status}`);
                break;
              }
            }
            return rows;
          });
          const { sha256Hex } = await import('@bonakala/domain');
          items.push({ section: s.section, source: s.source, count: collected.length, hash: (await sha256Hex(collected.join('|'))).slice(0, 16), note: collected.length ? undefined : 'no records for this section' });
          details.push({ section: s.section, rows: collected });
        }
        const now = new Date().toISOString();
        const manifest = { generatedAt: now, definitionsVersion: 'statutory register v1 (docs/24)', auditRange: { from: addDays(todaySast(), -365), to: todaySast() }, items };
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(kind.toUpperCase())} evidence pack</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#14324A}h1{font-size:22px}h2{font-size:15px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:4px}li{margin:2px 0}code{font-family:ui-monospace,monospace;font-size:12px;color:#555}</style></head><body><h1>${escapeHtml(kind.toUpperCase())} evidence pack</h1><p>Generated ${escapeHtml(now)} · ${escapeHtml(manifest.definitionsVersion)} · audit range ${escapeHtml(manifest.auditRange.from)} to ${escapeHtml(manifest.auditRange.to)}${ctx.services.demoMode ? ' · DEMO synthetic data' : ''}</p>${details.map((d, i) => `<h2>${escapeHtml(d.section)} <code>${escapeHtml(items[i]!.hash)} · ${d.rows.length} items</code></h2><ul>${d.rows.map((x) => `<li>${escapeHtml(x)}</li>`).join('') || '<li>No records for this section.</li>'}</ul>`).join('')}<p><small>Prepared by the Compliance Hand for CMP review. Nothing in this pack has been submitted to a regulator.</small></p></body></html>`;
        const packId = await ctx.step('pack.generate', { kind, sections: items.length }, async () => {
          const id = newId('pack');
          await ctx.services.db.insert(schema.evidencePacks).values({ id, practiceId, siteId: input.siteId ?? null, kind, title: `${kind.toUpperCase()} evidence pack · ${todaySast()}`, status: 'ready', manifest, html, generatedBy: 'compliance_hand' });
          return id;
        });
        return { packId, kind, items, totalRecords: items.reduce((a, b) => a + b.count, 0), submitted: false };
      }

      if (input.action === 'chase_expiries') {
        const today = todaySast();
        const obligations = await ctx.step('registers.read', { window: 30 }, async () => ctx.services.db.select().from(schema.obligations).where(and(eq(schema.obligations.practiceId, practiceId), sql`${schema.obligations.dueDate} <= ${addDays(today, 30)}`)));
        const creds = await ctx.step('registers.read', { window: 30, kind: 'credentials' }, async () => ctx.services.db.select().from(schema.credentials).where(and(eq(schema.credentials.practiceId, practiceId), sql`${schema.credentials.expiry} <= ${addDays(today, 30)}`)));
        const reminders = [...obligations.map((o) => ({ to: o.ownerPersona, about: `${o.instrument} due ${o.dueDate}` })), ...creds.map((x) => ({ to: 'PRM', about: `${x.type} credential expires ${x.expiry}` }))];
        ctx.leashCheck([{ rule: 'maxRemindersPerDay', actual: reminders.length }]);
        await ctx.step('reminder.internal', { count: reminders.length }, async () => ({ sent: reminders.length }), 'Internal reminders only; nothing leaves the Practice');
        return { reminders, obligations: obligations.length, credentials: creds.length };
      }
      throw new Refused(`Unknown action ${input.action}`);
    });

    /* Reportable results are created from report.signed.v1 when it carries reportableCategories. */
    on('report.signed.v1', async (evt, svcs) => {
      const p = evt.payload as { reportId?: string; studyId?: string; accession?: string; patientId?: string; practiceId?: string; siteId?: string; referrerId?: string; reportableCategories?: string[]; critical?: boolean };
      const practiceId = p.practiceId ?? evt.practiceId;
      if (!practiceId || !p.reportableCategories?.length) return;
      for (const cat of p.reportableCategories) {
        const existing = await svcs.db.select({ id: schema.reportableResults.id }).from(schema.reportableResults).where(and(eq(schema.reportableResults.practiceId, practiceId), eq(schema.reportableResults.category, categoryFor(cat).id), p.reportId ? eq(schema.reportableResults.reportId, p.reportId) : sql`1=0`)).limit(1);
        if (existing.length) continue;
        let referrerName: string | null = null;
        if (p.referrerId) {
          const [ref] = await svcs.db.select({ name: schema.referrers.name }).from(schema.referrers).where(eq(schema.referrers.id, p.referrerId)).limit(1);
          referrerName = ref?.name ?? null;
        }
        let patientMasked: string | null = null;
        if (p.patientId) {
          const [pat] = await svcs.db.select({ idNumber: schema.patients.idNumber, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth }).from(schema.patients).where(eq(schema.patients.id, p.patientId)).limit(1);
          if (pat) {
            const age = pat.dateOfBirth ? Math.floor((Date.now() - new Date(pat.dateOfBirth).getTime()) / (365.25 * 86400000)) : null;
            patientMasked = `····${(pat.idNumber ?? '0000').slice(-4)} · ${pat.sex ?? '?'} ${age ?? '?'}`;
          }
        }
        const id = await createReportableResult(svcs, { practiceId, category: cat, patientMasked, patientId: p.patientId ?? null, reportId: p.reportId ?? null, studyId: p.studyId ?? null, accession: p.accession ?? null, referrerId: p.referrerId ?? null, referrerName, siteId: p.siteId ?? null });
        const { emitDirect } = await import('../../kernel/events.js');
        await emitDirect(svcs, 'reportable_result.raised.v1', { reportableResultId: id, practiceId, category: categoryFor(cat).id, reportId: p.reportId ?? null }, { aggregateType: 'reportable_result', aggregateId: id, practiceId });
      }
    });

    /* An AI slip anywhere opens a compliance incident immediately (docs/12). */
    on('bci.slip.detected.v1', async (evt, svcs) => {
      const p = evt.payload as { practiceId?: string; detail?: string; surface?: string };
      const practiceId = p.practiceId ?? evt.practiceId;
      if (!practiceId) return;
      const now = new Date().toISOString();
      const id = newId('inc');
      const ref = await nextRef(svcs, 'INC', practiceId);
      await svcs.db.insert(schema.incidents).values({
        id, practiceId, siteId: null, ref, category: 'ai_slip', severity: 1, title: 'AI slip detected', description: p.detail ?? `Unverified AI output reached ${p.surface ?? 'a surface'}`,
        occurredAt: now, reportedAt: now, reportedBy: 'system', status: 'open', regulator: 'SAHPRA',
        timeline: [{ at: now, text: 'AI slip detected by monitoring; CMP, AIO and EXE alerted immediately (no batching)', kind: 'crit' as const, source: 'bci' }],
        immediateActions: [{ item: 'Model version flagged and candidate surface suspended', done: false }, { item: 'AIO and CMP notified', done: true, at: now }],
        rca: null, correctiveActions: [], disclosure: {}, reportDraft: { status: 'none' }, linkedRefs: [],
      });
      const { emitDirect } = await import('../../kernel/events.js');
      await emitDirect(svcs, 'incident.opened.v1', { incidentId: id, practiceId, category: 'ai_slip', severity: 1 }, { aggregateType: 'incident', aggregateId: id, practiceId });
    });

    void services;
  },
  /** Daily: refresh calendar items, escalate unacknowledged reportable results, mark overdue obligations. */
  async tick(services) {
    const practices = await services.db.select({ id: schema.legalEntities.id }).from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
    let generated = 0;
    let escalated = 0;
    const now = new Date().toISOString();
    for (const p of practices) {
      generated += await generateCalendar(services, p.id);
      const open = await services.db.select().from(schema.reportableResults).where(and(eq(schema.reportableResults.practiceId, p.id), eq(schema.reportableResults.status, 'open')));
      for (const rrRow of open) {
        if (rrRow.ackDueAt > now) continue;
        const lastEsc = rrRow.lastEscalatedAt ?? rrRow.createdAt;
        if (new Date(now).getTime() - new Date(lastEsc).getTime() < 7 * 86400000) continue;
        await services.db.update(schema.reportableResults).set({ escalations: rrRow.escalations + 1, lastEscalatedAt: now, updatedAt: now }).where(eq(schema.reportableResults.id, rrRow.id));
        const { emitDirect } = await import('../../kernel/events.js');
        await emitDirect(services, 'reportable_result.escalated.v1', { reportableResultId: rrRow.id, practiceId: p.id, category: rrRow.category, escalations: rrRow.escalations + 1 }, { aggregateType: 'reportable_result', aggregateId: rrRow.id, practiceId: p.id });
        escalated++;
      }
    }
    return { calendarItems: generated, reportableEscalations: escalated };
  },
});
