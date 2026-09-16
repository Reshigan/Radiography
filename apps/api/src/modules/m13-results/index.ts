import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, conflict, forbidden, defineHand, minutesBetween, formatSast } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on, registerHand, runHand, emitDirect } from '../../kernel/index.js';
import { placeCall, maskPhone, listCalls, registerTelephonySim } from '../../sim/telephony.js';
import { REPORTABLE_CATEGORIES, CRITICAL_CATEGORIES } from '../m12-reporting/service.js';

const r = router();
const STAFF = ['RGT', 'PRM', 'CMP', 'FDK', 'BKG', 'EXE', 'SUP'] as const;

/**
 * Critical Results Hand (A3 with a leash). It works the contact chain, records every attempt and
 * escalates on timers. It never conveys a finding to a patient and never closes a loop without an
 * identified clinician's acknowledgement (M13-R-103, M13-R-104).
 */
const criticalHand = defineHand({
  id: 'critical-results', name: 'Critical Results Hand', module: 'M13', level: 'A3',
  mandate: 'On a critical, urgent or unexpected significant flag, identify the responsible clinician and their contact chain, initiate contact in policy order, record every attempt, escalate on timers and close the loop only on an identified clinician’s acknowledgement.',
  defaultLeash: { maxAttemptsPerStep: 2, escalationMinutes: 15, maxEscalationLevel: 3, mayConveyFindingsToPatient: false, mayCloseWithoutAcknowledgement: false },
  approvalPersona: 'PRM', approvalPolicy: 'Contact attempts and escalations are A3 within the policy; the voice conversation is A0 (radiologist to clinician); patient-facing emergency instructions are A1 on the radiologist’s explicit instruction',
  tools: { read_flag: 'R0', read_referrer_contacts: 'R0', read_oncall_roster: 'R0', place_call: 'R2', send_whatsapp_template: 'R2', send_sms: 'R2', send_referrer_push: 'R1', record_attempt: 'R1', record_acknowledgement: 'R1', escalate: 'R1', notify_prm: 'R2' },
});

/** Follow-up Hand: turns signed recommendations into tracked items and chases them within the leash. */
const followupHand = defineHand({
  id: 'followup', name: 'Follow-up Hand', module: 'M13', level: 'A3',
  mandate: 'Turn radiologist-confirmed recommendations into tracked follow-up items with due dates, owners and the schedule source; remind the referrer (and, where policy allows, the patient) about the next step; close only on evidence.',
  defaultLeash: { maxRemindersPerItem: 4, mayContactPatientAboutMeaning: false, mayCloseWithoutEvidence: false },
  approvalPersona: 'RGT', approvalPolicy: 'Item creation is A1 at signing; tracking and chasing are A3; closure without evidence is not possible',
  tools: { read_signed_report: 'R0', read_followup_schedules: 'R0', create_followup_item: 'R1', watch_orders: 'R0', notify_referrer: 'R2', notify_patient: 'R2', escalate_to_rgt: 'R1', escalate_to_prm: 'R1', close_followup_item: 'R1' },
});

async function notify(services: any, input: { practiceId: string; channel: string; recipientType: string; recipient: string; template: string; body: string; relatedType?: string; relatedId?: string }) {
  const id = newId('ntf');
  await services.db.insert(schema.notifications).values({ id, practiceId: input.practiceId, channel: input.channel, recipientType: input.recipientType, recipientMasked: maskPhone(input.recipient) === '(no number)' ? input.recipient.replace(/(.{2}).*(@.*)/, '$1···$2') : maskPhone(input.recipient), template: input.template, body: input.body, relatedType: input.relatedType ?? null, relatedId: input.relatedId ?? null, status: 'sent', sentAt: services.clock.now().toISOString() });
  return id;
}

/* ---------- Referrer results ---------- */
r.get('/referrer', allow('REF', ...STAFF), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const q = query(c, z.object({ referrerId: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().min(1).max(200).default(60) }));
  const referrerId = user.persona === 'REF' ? user.referrerId : q.referrerId;
  if (!referrerId) throw invalid('referrerId is required');
  if (user.persona === 'REF' && q.referrerId && q.referrerId !== user.referrerId) throw forbidden();
  // Only signed reports are ever returned (Class 1 gate).
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.referrerId, referrerId), inArray(schema.reports.status, ['signed', 'amended']))).orderBy(desc(schema.reports.signedAt)).limit(q.limit);
  const deliveries = rows.length ? await services.db.select().from(schema.resultDeliveries).where(and(inArray(schema.resultDeliveries.reportId, rows.map((x) => x.id)), eq(schema.resultDeliveries.recipientType, 'referrer'))) : [];
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  const studies = rows.length ? await services.db.select({ id: schema.studies.id, modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, completedAt: schema.studies.completedAt, receivedAt: schema.studies.receivedAt }).from(schema.studies).where(inArray(schema.studies.id, rows.map((x) => x.studyId))) : [];
  const smap = new Map(studies.map((s) => [s.id, s]));
  const crit = rows.length ? await services.db.select().from(schema.criticalResults).where(inArray(schema.criticalResults.reportId, rows.map((x) => x.id))) : [];
  const items = rows.map((rep) => ({
    id: rep.id, accession: rep.accession, studyId: rep.studyId, status: rep.status, signedAt: rep.signedAt, critical: rep.critical, criticalCategory: rep.criticalCategory,
    reportableCategories: rep.reportableCategories, sections: rep.sections, followups: rep.followups, patient: pmap.get(rep.patientId) ?? null, study: smap.get(rep.studyId) ?? null,
    delivery: deliveries.find((d) => d.reportId === rep.id && d.channel === 'referrer_portal') ?? null, criticalLoop: crit.find((x) => x.reportId === rep.id) ?? null,
  })).filter((x) => !q.status || x.delivery?.status === q.status);
  await audit(c, 'results.referrer_list', undefined, { referrerId, count: items.length });
  return c.json({ referrerId, reports: items, unacknowledged: items.filter((x) => x.delivery && x.delivery.status !== 'acknowledged').length });
});

/** Patient results, respecting the release delay flag and withheld categories (M13-R-105). */
r.get('/mine', allow('PAT'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  if (!user.patientId) throw notFound('Patient');
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.patientId, user.patientId), inArray(schema.reports.status, ['signed', 'amended']))).orderBy(desc(schema.reports.signedAt)).limit(50);
  const [flag] = await services.db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, 'results.patient_release_delay_hours')).limit(1);
  const delayHours = typeof flag?.value === 'number' ? flag.value : 2;
  const now = services.clock.now();
  const deliveries = rows.length ? await services.db.select().from(schema.resultDeliveries).where(inArray(schema.resultDeliveries.reportId, rows.map((x) => x.id))) : [];
  const studies = rows.length ? await services.db.select({ id: schema.studies.id, modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, receivedAt: schema.studies.receivedAt, keyImageIds: schema.studies.keyImageIds }).from(schema.studies).where(inArray(schema.studies.id, rows.map((x) => x.studyId))) : [];
  const smap = new Map(studies.map((s) => [s.id, s]));
  const out = rows.map((rep) => {
    const withheldCat = (rep.reportableCategories ?? []).find((cat) => REPORTABLE_CATEGORIES.find((x) => x.code === cat)?.releaseWithheld);
    const referrerOpened = deliveries.some((d) => d.reportId === rep.id && d.recipientType === 'referrer' && (d.openedAt || d.acknowledgedAt));
    const elapsedH = rep.signedAt ? minutesBetween(rep.signedAt, now.toISOString()) / 60 : 0;
    const released = withheldCat ? referrerOpened : referrerOpened || elapsedH >= delayHours;
    const study = smap.get(rep.studyId);
    return released
      ? { id: rep.id, accession: rep.accession, studyId: rep.studyId, signedAt: rep.signedAt, released: true, study: study ?? null, plainLanguage: plainLanguage(rep, study?.procedureDescription ?? ''), sections: rep.sections, followups: rep.followups }
      : { id: rep.id, accession: rep.accession, studyId: rep.studyId, signedAt: rep.signedAt, released: false, study: study ?? null, message: withheldCat ? 'Your report is ready and has been sent to your doctor. It will appear here after your doctor has seen it.' : `Your report is ready and has been sent to your doctor. It will appear here by ${formatSast(new Date(new Date(rep.signedAt!).getTime() + delayHours * 3600_000))}.` };
  });
  await audit(c, 'results.patient_list', undefined, { count: out.length });
  return c.json({ reports: out, releaseDelayHours: delayHours });
});

/** Plain-language layer (Class 3): built only from the signed report; labelled and provenance-carrying. */
function plainLanguage(rep: typeof schema.reports.$inferSelect, procedure: string) {
  const impression = (rep.sections as any)?.impression ?? '';
  const rec = (rep.sections as any)?.recommendation ?? '';
  return {
    label: 'Plain-language summary, not the medical report',
    whatWasExamined: procedure || 'An imaging study was performed.',
    whatWasFound: impression ? impression.replace(/\n/g, ' ') : 'The radiologist’s impression is in the full report below.',
    nextStep: rec || 'Your doctor will discuss the result with you and advise the next step.',
    whoSigned: 'The full report was written and signed by a registered radiologist. Questions about what it means for you should go to your doctor.',
    provenance: { modelId: 'plain-language', modelVersion: '1.2.0', outputClass: 3, demo: true, createdAt: rep.signedAt },
  };
}

r.post('/:reportId/acknowledge', allow('REF', ...STAFF), async (c) => {
  const reportId = param(c, 'reportId');
  const services = c.get('services');
  const user = c.get('user')!;
  const at = services.clock.now().toISOString();
  const rows = await services.db.select().from(schema.resultDeliveries).where(and(eq(schema.resultDeliveries.reportId, reportId), eq(schema.resultDeliveries.recipientType, 'referrer')));
  for (const d of rows) await services.db.update(schema.resultDeliveries).set({ status: 'acknowledged', openedAt: d.openedAt ?? at, acknowledgedAt: at, acknowledgedBy: user.id }).where(eq(schema.resultDeliveries.id, d.id));
  await audit(c, 'result.acknowledged', { type: 'report', id: reportId }, { by: user.id });
  await emit(c, 'report.acknowledged.v1', { reportId, acknowledgedBy: user.id, at }, { aggregateType: 'report', aggregateId: reportId });
  return c.json({ ok: true, at });
});
r.post('/:reportId/open', allow('REF', 'PAT', ...STAFF), async (c) => {
  const reportId = param(c, 'reportId');
  const services = c.get('services');
  const user = c.get('user')!;
  const at = services.clock.now().toISOString();
  const type = user.persona === 'PAT' ? 'patient' : 'referrer';
  const rows = await services.db.select().from(schema.resultDeliveries).where(and(eq(schema.resultDeliveries.reportId, reportId), eq(schema.resultDeliveries.recipientType, type)));
  for (const d of rows) if (!d.openedAt) await services.db.update(schema.resultDeliveries).set({ status: d.status === 'acknowledged' ? d.status : 'opened', openedAt: at }).where(eq(schema.resultDeliveries.id, d.id));
  await audit(c, 'report.opened_by_recipient', { type: 'report', id: reportId }, { persona: user.persona });
  await emit(c, 'report.opened.v1', { reportId, persona: user.persona, at }, { aggregateType: 'report', aggregateId: reportId });
  return c.json({ ok: true });
});

/* ---------- Deliveries ---------- */
r.get('/deliveries/:reportId', allow(...STAFF, 'REF'), async (c) => {
  const rows = await c.get('services').db.select().from(schema.resultDeliveries).where(eq(schema.resultDeliveries.reportId, param(c, 'reportId'))).orderBy(schema.resultDeliveries.sentAt);
  return c.json({ deliveries: rows });
});

/** PDF-like HTML render of a signed report (letterhead, radiologist identity, HPCSA number). */
r.get('/:reportId/render', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const [rep] = await services.db.select().from(schema.reports).where(eq(schema.reports.id, param(c, 'reportId'))).limit(1);
  if (!rep) throw notFound('Report');
  if (rep.status !== 'signed' && rep.status !== 'amended') return c.json({ error: 'not_signed', message: 'Only a signed report can be rendered or distributed' }, 409);
  if (user.persona === 'PAT' && rep.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && rep.referrerId !== user.referrerId) throw forbidden();
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, rep.studyId)).limit(1);
  const [pat] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, rep.patientId)).limit(1);
  const [rad] = rep.radiologistUserId ? await services.db.select({ name: schema.users.name, hpcsaNo: schema.users.hpcsaNo }).from(schema.users).where(eq(schema.users.id, rep.radiologistUserId)).limit(1) : [];
  const [prac] = await services.db.select().from(schema.legalEntities).where(eq(schema.legalEntities.id, rep.practiceId)).limit(1);
  const adds = await services.db.select().from(schema.addenda).where(eq(schema.addenda.reportId, rep.id)).orderBy(schema.addenda.createdAt);
  const s = rep.sections as any;
  const esc = (v: unknown) => String(v ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]!);
  const statements = (rep.reportableCategories ?? []).map((code) => REPORTABLE_CATEGORIES.find((x) => x.code === code)).filter(Boolean);
  await audit(c, 'report.rendered', { type: 'report', id: rep.id }, { persona: user.persona });
  const html = `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><title>${esc(rep.accession)}</title>
<style>body{font:14px/1.6 system-ui,sans-serif;color:#15181a;max-width:780px;margin:32px auto;padding:0 24px}h1{font-size:18px;margin:0}h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7073;margin:18px 0 4px}.hd{border-bottom:2px solid #15181a;padding-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start}.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 16px;font-size:13px;margin-top:10px}.kv span{color:#6b7073}.sig{margin-top:28px;border-top:1px solid #d5d9dc;padding-top:10px;font-size:13px}.note{background:#f3f1ec;border-left:3px solid #6b7073;padding:8px 10px;font-size:13px;margin-top:10px}.demo{margin-top:24px;font-size:11px;color:#6b7073}p{margin:0 0 6px;white-space:pre-wrap}</style></head><body>
<div class="hd"><div><h1>${esc(prac?.tradingName ?? 'Bonakala Imaging')}</h1><div style="font-size:12px;color:#6b7073">Practice number ${esc(prac?.bhfPracticeNo ?? '')} · ${esc(rep.status === 'amended' ? 'AMENDED REPORT' : 'RADIOLOGY REPORT')}</div></div><div style="text-align:right;font-family:ui-monospace,monospace;font-size:12px">${esc(rep.accession)}<br>${esc(formatSast(rep.signedAt ?? ''))}</div></div>
<div class="kv"><span>Patient</span><b>${esc(pat?.lastName)}, ${esc(pat?.firstName)}</b><span>Date of birth</span><b>${esc(pat?.dateOfBirth ?? '')}</b><span>Study</span><b>${esc(study?.procedureDescription ?? '')}</b><span>Date of study</span><b>${esc(formatSast(study?.receivedAt ?? '', { date: true, time: false }))}</b></div>
<h2>Clinical information</h2><p>${esc(s.clinicalInfo)}</p><h2>Technique</h2><p>${esc(s.technique)}</p>${s.comparison ? `<h2>Comparison</h2><p>${esc(s.comparison)}</p>` : ''}<h2>Findings</h2><p>${esc(s.findings)}</p><h2>Impression</h2><p>${esc(s.impression)}</p>${s.recommendation ? `<h2>Recommendation</h2><p>${esc(s.recommendation)}</p>` : ''}
${statements.map((x) => `<div class="note"><b>${esc(x!.label)}</b><br>${esc(x!.statement)}</div>`).join('')}
${rep.critical ? `<div class="note"><b>${esc(rep.criticalCategory)} result</b><br>This result was communicated to the referring clinician; the communication record is attached to the report.</div>` : ''}
${adds.map((a) => `<h2>${esc(a.kind)} · ${esc(formatSast(a.signedAt))}</h2><p>${esc(a.text)}</p>`).join('')}
<div class="sig">Reported and electronically signed by <b>${esc(rad?.name ?? '')}</b>, registered radiologist · HPCSA ${esc(rep.signedHpcsaNo ?? rad?.hpcsaNo ?? '')}<br>Signed ${esc(formatSast(rep.signedAt ?? ''))}</div>
<div class="demo">DEMO · synthetic data. Generated by the Bonakala Platform.</div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
});

/* ---------- Critical results ---------- */
r.get('/critical', allow(...STAFF, 'RAD'), async (c) => {
  const practiceId = requirePractice(c);
  const { status } = query(c, z.object({ status: z.string().optional() }));
  const services = c.get('services');
  const rows = await services.db.select().from(schema.criticalResults).where(and(eq(schema.criticalResults.practiceId, practiceId), status ? eq(schema.criticalResults.status, status) : undefined)).orderBy(desc(schema.criticalResults.openedAt)).limit(100);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  const refs = await services.db.select({ id: schema.referrers.id, name: schema.referrers.name, phone: schema.referrers.phone }).from(schema.referrers);
  const rmap = new Map(refs.map((x) => [x.id, x]));
  const now = services.clock.now().toISOString();
  return c.json({ critical: rows.map((x) => ({ ...x, patientInitials: pmap.get(x.patientId) ? `${pmap.get(x.patientId)!.firstName[0]}${pmap.get(x.patientId)!.lastName[0]}` : '··', referrerName: x.referrerId ? rmap.get(x.referrerId)?.name ?? null : null, referrerPhoneMasked: maskPhone(x.referrerId ? rmap.get(x.referrerId)?.phone : null), ageMinutes: minutesBetween(x.openedAt, now), overdue: minutesBetween(x.openedAt, now) > x.windowMinutes && x.status !== 'acknowledged' && x.status !== 'closed', calls: listCalls(x.id).map((cl) => ({ ...cl, to: undefined })) })), categories: CRITICAL_CATEGORIES });
});

r.post('/critical/:id/acknowledge', allow('REF', 'RGT', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { acknowledgedBy, channel } = await body(c, z.object({ acknowledgedBy: z.string().min(2), channel: z.enum(['voice', 'portal', 'whatsapp', 'hl7']).default('portal') }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [row] = await services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.id, id)).limit(1);
  if (!row) throw notFound('Critical result');
  if (row.status === 'closed') throw conflict('This loop is already closed');
  const at = services.clock.now().toISOString();
  await services.db.update(schema.criticalResults).set({ status: 'closed', acknowledgedBy, acknowledgedAt: at, acknowledgementChannel: channel, closedAt: at, attempts: [...row.attempts, { at, step: row.escalationLevel, channel, to: acknowledgedBy, outcome: 'acknowledged', by: user.id }] }).where(eq(schema.criticalResults.id, id));
  await audit(c, 'critical.acknowledged', { type: 'critical_result', id }, { acknowledgedBy, channel });
  await emit(c, 'critical.closed.v1', { criticalId: id, reportId: row.reportId, acknowledgedBy, channel, at }, { aggregateType: 'critical_result', aggregateId: id });
  return c.json({ ok: true, at });
});
r.post('/critical/:id/take-over', allow('RGT', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const user = c.get('user')!;
  await services.db.update(schema.criticalResults).set({ takenOverBy: user.id }).where(eq(schema.criticalResults.id, id));
  await audit(c, 'critical.taken_over', { type: 'critical_result', id });
  return c.json({ ok: true });
});
/** Run the Hand's next escalation step now (the tick does this on the timer). */
r.post('/critical/:id/escalate', allow('RGT', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.id, id)).limit(1);
  if (!row) throw notFound('Critical result');
  const task = await runHand(services, 'critical-results', { criticalId: id }, { practiceId: row.practiceId, trigger: 'manual', title: `Critical result ${row.accession}`, aggregateType: 'critical_result', aggregateId: id });
  await audit(c, 'critical.escalated', { type: 'critical_result', id }, { taskId: task.id, status: task.status });
  return c.json({ task });
});

/* ---------- Follow-ups ---------- */
r.get('/followups', allow(...STAFF, 'REF'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const { status } = query(c, z.object({ status: z.string().optional() }));
  const where = user.persona === 'REF' ? eq(schema.followups.referrerId, user.referrerId ?? '-') : eq(schema.followups.practiceId, requirePractice(c));
  const rows = await services.db.select().from(schema.followups).where(and(where, status ? eq(schema.followups.status, status) : undefined)).orderBy(schema.followups.dueAt).limit(200);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  const now = services.clock.now().toISOString();
  return c.json({ followups: rows.map((x) => ({ ...x, patient: pmap.get(x.patientId) ?? null, overdue: x.dueAt < now && x.status !== 'closed' })), openCount: rows.filter((x) => x.status !== 'closed').length });
});
r.post('/followups/:id/close', allow(...STAFF, 'REF'), async (c) => {
  const id = param(c, 'id');
  const { reason, evidence } = await body(c, z.object({ reason: z.enum(['performed', 'not_indicated', 'managed_elsewhere', 'patient_declined', 'deceased', 'transferred']), evidence: z.string().min(3) }));
  const services = c.get('services');
  const at = services.clock.now().toISOString();
  await services.db.update(schema.followups).set({ status: 'closed', closedReason: reason, closedEvidence: evidence, closedBy: c.get('user')!.id, closedAt: at }).where(eq(schema.followups.id, id));
  await audit(c, 'followup.closed', { type: 'followup', id }, { reason, evidence });
  await emit(c, 'followup.closed.v1', { followupId: id, reason, at }, { aggregateType: 'followup', aggregateId: id });
  return c.json({ ok: true });
});

/* ---------- Referrer analytics ---------- */
r.get('/analytics/referrers', allow(...STAFF, 'REF'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const { days } = query(c, z.object({ days: z.coerce.number().min(1).max(365).default(90) }));
  const since = new Date(services.clock.now().getTime() - days * 86400_000).toISOString();
  const scope = user.persona === 'REF' ? eq(schema.reports.referrerId, user.referrerId ?? '-') : eq(schema.reports.practiceId, requirePractice(c));
  const reports = await services.db.select().from(schema.reports).where(and(scope, inArray(schema.reports.status, ['signed', 'amended']), gte(schema.reports.signedAt, since)));
  const studies = reports.length ? await services.db.select({ id: schema.studies.id, completedAt: schema.studies.completedAt, receivedAt: schema.studies.receivedAt, modality: schema.studies.modality }).from(schema.studies).where(inArray(schema.studies.id, reports.map((x) => x.studyId))) : [];
  const smap = new Map(studies.map((s) => [s.id, s]));
  const deliveries = reports.length ? await services.db.select().from(schema.resultDeliveries).where(and(inArray(schema.resultDeliveries.reportId, reports.map((x) => x.id)), eq(schema.resultDeliveries.recipientType, 'referrer'))) : [];
  const fups = reports.length ? await services.db.select().from(schema.followups).where(inArray(schema.followups.reportId, reports.map((x) => x.id))) : [];
  const refs = await services.db.select({ id: schema.referrers.id, name: schema.referrers.name, discipline: schema.referrers.discipline }).from(schema.referrers);
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
  const byRef = new Map<string, { volumes: number; tats: number[]; opens: number; acks: number; modalities: Record<string, number> }>();
  for (const rep of reports) {
    const k = rep.referrerId ?? 'unknown';
    const e = byRef.get(k) ?? { volumes: 0, tats: [], opens: 0, acks: 0, modalities: {} };
    e.volumes++;
    const s = smap.get(rep.studyId);
    if (s && rep.signedAt) e.tats.push(minutesBetween(s.completedAt ?? s.receivedAt, rep.signedAt));
    if (s) e.modalities[s.modality] = (e.modalities[s.modality] ?? 0) + 1;
    const d = deliveries.find((x) => x.reportId === rep.id);
    if (d?.openedAt || d?.acknowledgedAt) e.opens++;
    if (d?.acknowledgedAt) e.acks++;
    byRef.set(k, e);
  }
  return c.json({
    days,
    referrers: [...byRef.entries()].map(([id, v]) => ({ referrerId: id, name: refs.find((x) => x.id === id)?.name ?? 'Unknown', discipline: refs.find((x) => x.id === id)?.discipline ?? null, volumes: v.volumes, tatMedianMinutes: median(v.tats), openRatePct: Math.round((v.opens / v.volumes) * 1000) / 10, ackRatePct: Math.round((v.acks / v.volumes) * 1000) / 10, modalities: v.modalities })).sort((a, b) => b.volumes - a.volumes),
    followupCompletionPct: fups.length ? Math.round((fups.filter((x) => x.status === 'closed').length / fups.length) * 1000) / 10 : null,
    tatMedianMinutes: median(reports.map((rep) => { const s = smap.get(rep.studyId); return s && rep.signedAt ? minutesBetween(s.completedAt ?? s.receivedAt, rep.signedAt) : 0; }).filter(Boolean)),
  });
});

r.get('/status', (c) => c.json({ module: 'M13', status: 'ok' }));

/** Contact chain for a report: referrer → practice → on-call → PRM (process 08 §7.1). */
async function contactChain(services: any, referrerId: string | null, practiceId: string) {
  const chain: Array<{ step: number; role: string; name: string; phoneMasked?: string; phone?: string; channel: string[] }> = [];
  if (referrerId) {
    const [ref] = await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, referrerId)).limit(1);
    if (ref) chain.push({ step: 1, role: 'referring clinician', name: ref.name, phone: ref.deliveryPrefs?.phoneCritical ?? ref.phone ?? '', phoneMasked: maskPhone(ref.deliveryPrefs?.phoneCritical ?? ref.phone), channel: ['call', 'whatsapp', 'portal'] });
    if (ref?.practiceName) chain.push({ step: 2, role: 'referrer practice', name: ref.practiceName, phone: ref.phone ?? '', phoneMasked: maskPhone(ref.phone), channel: ['call'] });
  }
  const [prm] = await services.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(and(eq(schema.users.persona, 'PRM'), eq(schema.users.practiceId, practiceId))).limit(1);
  chain.push({ step: chain.length + 1, role: 'practice manager', name: prm?.name ?? 'Practice manager', channel: ['portal', 'call'] });
  return chain;
}

export default defineModule({
  code: 'M13', name: 'Results & Communication', basePath: 'results', routes: r,
  boot(services) {
    registerTelephonySim();

    registerHand<{ criticalId: string }, { status: string; escalationLevel: number; attempts: number }>(criticalHand, async (input, ctx) => {
      const [row] = await services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.id, input.criticalId)).limit(1);
      if (!row) throw new Error('Critical result not found');
      if (row.status === 'closed' || row.status === 'acknowledged') return { status: row.status, escalationLevel: row.escalationLevel, attempts: row.attempts.length };
      await ctx.step('read_flag', { criticalId: row.id }, async () => ({ category: row.category, window: row.windowMinutes }));
      const chain = row.contactChain.length ? row.contactChain : await ctx.step('read_referrer_contacts', { referrerId: row.referrerId }, async () => contactChain(services, row.referrerId, row.practiceId));
      const level = row.escalationLevel;
      const maxLevel = Number(ctx.leash.maxEscalationLevel ?? 3);
      // The leash caps escalation: past the last step the Hand hands over to PRM and RGT with the full log.
      ctx.leashCheck([{ rule: 'maxEscalationLevel', actual: level + 1 }, { rule: 'maxAttemptsPerStep', actual: row.attempts.filter((a) => a.step === level).length + 1 }]);
      const target = chain[Math.min(level, chain.length - 1)]!;
      const attempts = [...row.attempts];
      const at = services.clock.now().toISOString();
      // No clinical content on unauthenticated channels (M13-R-113): initials, study and how to reach the radiologist only.
      const script = `A radiologist at Bonakala Imaging needs to speak to the doctor about a patient (${row.category} result, accession ${row.accession}).`;
      const call = await ctx.step('place_call', { step: target.step, toMasked: target.phoneMasked }, async () => placeCall(services, { to: (target as any).phone, script, attempt: attempts.filter((a) => a.step === level).length + 1, relatedId: row.id }));
      attempts.push({ at, step: level, channel: 'call', to: target.phoneMasked ?? target.name, outcome: call.outcome, by: 'critical-results-hand', callId: call.id });
      if (call.outcome !== 'answered') {
        await ctx.step('send_whatsapp_template', { toMasked: target.phoneMasked }, async () => notify(services, { practiceId: row.practiceId, channel: 'whatsapp', recipientType: 'referrer', recipient: (target as any).phone ?? target.name, template: 'critical_result_notice', body: `Bonakala Imaging: a radiologist needs to speak to you about a patient result (${row.accession}). Please call the reading room.`, relatedType: 'critical_result', relatedId: row.id }));
        attempts.push({ at, step: level, channel: 'whatsapp', to: target.phoneMasked ?? target.name, outcome: 'sent', by: 'critical-results-hand' });
      }
      await ctx.step('send_referrer_push', { reportId: row.reportId }, async () => notify(services, { practiceId: row.practiceId, channel: 'portal', recipientType: 'referrer', recipient: target.name, template: 'critical_result_push', body: `A ${row.category} result is waiting for your acknowledgement in the Referrer Space.`, relatedType: 'critical_result', relatedId: row.id }));
      const answered = call.outcome === 'answered';
      const nextLevel = answered ? level : level + 1;
      const status = answered ? 'open' : nextLevel >= Math.min(maxLevel, chain.length) ? 'escalated' : 'open';
      await ctx.step('record_attempt', { attempts: attempts.length }, async () => services.db.update(schema.criticalResults).set({ attempts, escalationLevel: nextLevel, status }).where(eq(schema.criticalResults.id, row.id)));
      if (!answered && nextLevel >= Math.min(maxLevel, chain.length)) {
        await ctx.step('notify_prm', { criticalId: row.id }, async () => notify(services, { practiceId: row.practiceId, channel: 'portal', recipientType: 'prm', recipient: 'practice manager', template: 'critical_escalation', body: `Critical result ${row.accession}: contact chain exhausted after ${attempts.length} attempts. Radiologist and practice manager to decide the next step.`, relatedType: 'critical_result', relatedId: row.id }));
        ctx.log('Contact chain exhausted: handed to PRM and RGT with the full log. The Hand never conveys the finding to the patient.');
      }
      // The Hand can never mark the loop closed: closure needs an identified clinician's acknowledgement.
      ctx.leashCheck([{ rule: 'mayCloseWithoutAcknowledgement', actual: false, compare: 'eq' }]);
      await emitDirect(services, answered ? 'critical.communicated.v1' : 'critical.escalated.v1', { criticalId: row.id, reportId: row.reportId, practiceId: row.practiceId, step: level, outcome: call.outcome, escalationLevel: nextLevel }, { aggregateType: 'critical_result', aggregateId: row.id, practiceId: row.practiceId });
      return { status, escalationLevel: nextLevel, attempts: attempts.length };
    });

    registerHand<{ reportId: string }, { created: number }>(followupHand, async (input, ctx) => {
      const [rep] = await ctx.step('read_signed_report', { reportId: input.reportId }, async () => services.db.select().from(schema.reports).where(eq(schema.reports.id, input.reportId)).limit(1));
      if (!rep) throw new Error('Report not found');
      if (rep.status !== 'signed' && rep.status !== 'amended') throw new Error('Follow-ups are created only from signed reports');
      const existing = await services.db.select({ id: schema.followups.id }).from(schema.followups).where(eq(schema.followups.reportId, rep.id));
      if (existing.length) return { created: 0 };
      await ctx.step('read_followup_schedules', {}, async () => (rep.followups ?? []).length);
      let created = 0;
      for (const f of rep.followups ?? []) {
        const id = newId('fup');
        await ctx.step('create_followup_item', { what: f.what }, async () => services.db.insert(schema.followups).values({ id, practiceId: rep.practiceId, reportId: rep.id, studyId: rep.studyId, patientId: rep.patientId, referrerId: rep.referrerId, what: f.what, whenText: f.when, why: f.why, who: f.who, scheduleSource: f.source ?? null, dueAt: f.dueAt, status: 'open', reminders: [] }));
        created++;
      }
      return { created };
    });

    /** Distribution on signing: referrer channels first, then the patient release rule. */
    on('report.signed.v1', async (evt) => {
      const p = evt.payload as { reportId: string; studyId: string; practiceId: string; patientId: string; referrerId?: string | null; signedAt: string; reportableCategories?: string[] };
      const already = await services.db.select({ id: schema.resultDeliveries.id }).from(schema.resultDeliveries).where(eq(schema.resultDeliveries.reportId, p.reportId)).limit(1);
      if (already.length) return;
      const at = p.signedAt ?? services.clock.now().toISOString();
      const [ref] = p.referrerId ? await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, p.referrerId)).limit(1) : [];
      const rows: (typeof schema.resultDeliveries.$inferInsert)[] = [];
      if (ref) {
        rows.push({ id: newId('del'), practiceId: p.practiceId, reportId: p.reportId, studyId: p.studyId, referrerId: ref.id, recipientType: 'referrer', channel: 'referrer_portal', recipientMasked: ref.name, status: 'delivered', sentAt: at, deliveredAt: at });
        if (ref.deliveryPrefs?.whatsapp) rows.push({ id: newId('del'), practiceId: p.practiceId, reportId: p.reportId, studyId: p.studyId, referrerId: ref.id, recipientType: 'referrer', channel: 'whatsapp', recipientMasked: maskPhone(ref.phone), status: 'delivered', sentAt: at, deliveredAt: at });
        if (ref.deliveryPrefs?.fhir) rows.push({ id: newId('del'), practiceId: p.practiceId, reportId: p.reportId, studyId: p.studyId, referrerId: ref.id, recipientType: 'referrer', channel: 'hl7', recipientMasked: ref.practiceName ?? ref.name, status: 'delivered', sentAt: at, deliveredAt: at });
      }
      const withheld = (p.reportableCategories ?? []).some((cat) => REPORTABLE_CATEGORIES.find((x) => x.code === cat)?.releaseWithheld);
      rows.push({ id: newId('del'), practiceId: p.practiceId, reportId: p.reportId, studyId: p.studyId, patientId: p.patientId, recipientType: 'patient', channel: 'patient_space', recipientMasked: 'Patient Space', status: withheld ? 'withheld' : 'sent', sentAt: at });
      await services.db.insert(schema.resultDeliveries).values(rows);
      if (ref) await notify(services, { practiceId: p.practiceId, channel: 'whatsapp', recipientType: 'referrer', recipient: ref.phone ?? ref.name, template: 'report_ready', body: 'A report is ready for your patient in the Referrer Space.', relatedType: 'report', relatedId: p.reportId });
      await runHand(services, 'followup', { reportId: p.reportId }, { practiceId: p.practiceId, trigger: 'report.signed.v1', title: 'Follow-up items', aggregateType: 'report', aggregateId: p.reportId });
      await emitDirect(services, 'report.distributed.v1', { reportId: p.reportId, channels: rows.map((x) => x.channel), practiceId: p.practiceId }, { aggregateType: 'report', aggregateId: p.reportId, practiceId: p.practiceId });
    });

    /** Critical flag confirmed by the radiologist: open the loop and start the Hand. */
    on('report.critical_flag.confirmed.v1', async (evt) => {
      const p = evt.payload as { reportId: string; studyId: string; accession: string; patientId: string; practiceId: string; siteId: string; referrerId?: string | null; category: string; radiologistUserId: string };
      const already = await services.db.select({ id: schema.criticalResults.id }).from(schema.criticalResults).where(eq(schema.criticalResults.reportId, p.reportId)).limit(1);
      if (already.length) return;
      const cat = CRITICAL_CATEGORIES.find((x) => x.code === p.category) ?? CRITICAL_CATEGORIES[0];
      const chain = await contactChain(services, p.referrerId ?? null, p.practiceId);
      const id = newId('crit');
      const at = services.clock.now().toISOString();
      await services.db.insert(schema.criticalResults).values({ id, practiceId: p.practiceId, siteId: p.siteId, reportId: p.reportId, studyId: p.studyId, accession: p.accession, patientId: p.patientId, referrerId: p.referrerId ?? null, radiologistUserId: p.radiologistUserId, category: p.category, windowMinutes: cat.windowMinutes, contactChain: chain.map(({ phone: _phone, ...rest }) => rest) as any, attempts: [], status: 'open', openedAt: at });
      const task = await runHand(services, 'critical-results', { criticalId: id }, { practiceId: p.practiceId, trigger: 'report.critical_flag.confirmed.v1', title: `Critical result ${p.accession}`, aggregateType: 'critical_result', aggregateId: id });
      await services.db.update(schema.criticalResults).set({ handTaskId: task.id }).where(eq(schema.criticalResults.id, id));
    });

    /** Amendments re-run distribution to everyone who received the original. */
    on('report.addended.v1', async (evt) => redistribute(services, evt.payload as any));
    on('report.corrected.v1', async (evt) => redistribute(services, evt.payload as any));
  },
  async tick(services) {
    const now = services.clock.now();
    // Escalate open critical loops past their window.
    const open = await services.db.select().from(schema.criticalResults).where(inArray(schema.criticalResults.status, ['open', 'escalated']));
    let escalated = 0;
    for (const row of open) {
      const last = row.attempts[row.attempts.length - 1];
      const since = minutesBetween(last?.at ?? row.openedAt, now.toISOString());
      if (since < 15) continue;
      if (row.escalationLevel >= 3) continue;
      await runHand(services, 'critical-results', { criticalId: row.id }, { practiceId: row.practiceId, trigger: 'schedule', title: `Critical result ${row.accession}`, aggregateType: 'critical_result', aggregateId: row.id });
      escalated++;
    }
    // Follow-up reminders within the leash.
    const due = await services.db.select().from(schema.followups).where(and(inArray(schema.followups.status, ['open', 'reminded']), lt(schema.followups.dueAt, new Date(now.getTime() + 14 * 86400_000).toISOString())));
    let reminded = 0;
    for (const f of due) {
      if (f.reminders.length >= 4) {
        if (f.dueAt < now.toISOString() && f.status !== 'overdue') await services.db.update(schema.followups).set({ status: 'overdue', escalatedTo: 'PRM' }).where(eq(schema.followups.id, f.id));
        continue;
      }
      const last = f.reminders[f.reminders.length - 1];
      if (last && minutesBetween(last.at, now.toISOString()) < 14 * 24 * 60) continue;
      const at = now.toISOString();
      await services.db.update(schema.followups).set({ status: f.dueAt < at ? 'overdue' : 'reminded', reminders: [...f.reminders, { at, channel: 'portal', to: f.who, kind: f.dueAt < at ? 'overdue' : 'due_window' }] }).where(eq(schema.followups.id, f.id));
      await notify(services, { practiceId: f.practiceId, channel: 'portal', recipientType: 'referrer', recipient: f.who, template: 'followup_reminder', body: `Follow-up due: ${f.what} (${f.whenText}).`, relatedType: 'followup', relatedId: f.id });
      reminded++;
    }
    // Unread-report chasing (process 08 §9).
    const stale = await services.db.select().from(schema.resultDeliveries).where(and(eq(schema.resultDeliveries.recipientType, 'referrer'), eq(schema.resultDeliveries.channel, 'referrer_portal'), isNull(schema.resultDeliveries.openedAt), lt(schema.resultDeliveries.sentAt, new Date(now.getTime() - 48 * 3600_000).toISOString())));
    return { criticalEscalated: escalated, followupsReminded: reminded, unreadReports: stale.length };
  },
});

async function redistribute(services: any, p: { reportId: string; practiceId: string; kind?: string }) {
  const rows = await services.db.select().from(schema.resultDeliveries).where(eq(schema.resultDeliveries.reportId, p.reportId));
  const at = services.clock.now().toISOString();
  const amendment = Math.max(0, ...rows.map((x: any) => x.amendment)) + 1;
  for (const d of rows) {
    await services.db.insert(schema.resultDeliveries).values({ id: newId('del'), practiceId: d.practiceId, reportId: d.reportId, studyId: d.studyId, referrerId: d.referrerId, patientId: d.patientId, recipientType: d.recipientType, channel: d.channel, recipientMasked: d.recipientMasked, status: 'sent', sentAt: at, amendment });
  }
  await emitDirect(services, 'report.distributed.v1', { reportId: p.reportId, amendment, practiceId: p.practiceId }, { aggregateType: 'report', aggregateId: p.reportId, practiceId: p.practiceId });
}
