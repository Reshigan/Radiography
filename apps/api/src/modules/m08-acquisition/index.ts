import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, conflict, defineHand, todaySast } from '@bonakala/domain';
import { findProcedure, PROCEDURES } from '@bonakala/domain/bci';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on, registerHand, runHand } from '../../kernel/index.js';
import { gateCheck } from './gate.js';
import { suggestProtocol, contrastCalc, completeAcquisition, recordRepeat, REPEAT_REASONS } from './service.js';
import { registerModalitySim } from '../../sim/modality.js';

const r = router();
const CONSOLE = ['RAD', 'NUR', 'RGT', 'PRM', 'FDK', 'BKG', 'BIO', 'CMP', 'EXE', 'SUP', 'AIO'] as const;

/* ---------- Protocol Hand (M20 registration) ---------- */
const protocolHand = defineHand({
  id: 'protocol', name: 'Protocol Hand', module: 'M08', level: 'A2',
  mandate: 'Pre-assign the protocol, contrast suggestion and DRL reference for every scheduled procedure step; place CT, MR and diagnostic mammography in the RGT protocolling queue; apply radiologist-approved standing rules.',
  defaultLeash: { maxDoseCeilingPct: 100, mayProposeContrastBelowEgfr: false, mayCreateStandingRules: false },
  approvalPersona: 'RGT', approvalPolicy: 'RAD accepts on the card for A2 modalities; RGT accepts in the protocolling queue for CT, MR and diagnostic MG',
  tools: { read_order: 'R0', read_patient_safety_profile: 'R0', read_priors_index: 'R0', read_protocol_library: 'R0', propose_protocol: 'R1', enqueue_for_protocolling: 'R1', propose_contrast_dose: 'R1', notify_rad: 'R1' },
});

async function dayRange(date: string) {
  // SAST day boundaries expressed in UTC
  const start = new Date(`${date}T00:00:00+02:00`).toISOString();
  const end = new Date(`${date}T23:59:59.999+02:00`).toISOString();
  return { start, end };
}

/* ---------- Worklist ---------- */
r.get('/worklist', allow(...CONSOLE), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId, roomId, date, status } = query(c, z.object({ siteId: z.string().optional(), roomId: z.string().optional(), date: z.string().optional(), status: z.string().optional() }));
  const db = c.get('services').db;
  const day = date ?? todaySast();
  const { start, end } = await dayRange(day);
  const rows = await db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.practiceId, practiceId), gte(schema.worklistItems.scheduledAt, start), lt(schema.worklistItems.scheduledAt, end), siteId ? eq(schema.worklistItems.siteId, siteId) : undefined, roomId ? eq(schema.worklistItems.roomId, roomId) : undefined, status ? eq(schema.worklistItems.status, status) : undefined)).orderBy(schema.worklistItems.scheduledAt);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth, flags: schema.patients.flags }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  const unmatched = await db.select({ id: schema.studies.id, accession: schema.studies.accession, receivedAt: schema.studies.receivedAt, modality: schema.studies.modality, roomId: schema.studies.roomId }).from(schema.studies).where(and(eq(schema.studies.practiceId, practiceId), eq(schema.studies.unmatched, true), siteId ? eq(schema.studies.siteId, siteId) : undefined));
  return c.json({ date: day, items: rows.map((x) => ({ ...x, patient: pmap.get(x.patientId) ?? null })), unmatched });
});

r.get('/rooms', allow(...CONSOLE), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId } = query(c, z.object({ siteId: z.string().optional() }));
  const db = c.get('services').db;
  const rooms = await db.select().from(schema.rooms).where(and(eq(schema.rooms.practiceId, practiceId), siteId ? eq(schema.rooms.siteId, siteId) : undefined));
  const mods = await db.select().from(schema.modalities).where(eq(schema.modalities.practiceId, practiceId));
  const sites = await db.select({ id: schema.sites.id, code: schema.sites.code, name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const now = c.get('services').clock.now().toISOString();
  const overdue = await db.select({ roomId: schema.qaTests.roomId, testType: schema.qaTests.testType, dueAt: schema.qaTests.dueAt }).from(schema.qaTests).where(and(eq(schema.qaTests.practiceId, practiceId), eq(schema.qaTests.blocking, true), isNull(schema.qaTests.doneAt), lt(schema.qaTests.dueAt, now)));
  return c.json({ sites, rooms: rooms.map((room) => ({ ...room, modality: mods.find((m) => m.roomId === room.id) ?? null, qaBlocked: overdue.filter((o) => o.roomId === room.id) })) });
});

r.get('/worklist/:id', allow(...CONSOLE), async (c) => {
  const db = c.get('services').db;
  const [item] = await db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, param(c, 'id'))).limit(1);
  if (!item) throw notFound('Worklist item');
  const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, item.patientId)).limit(1);
  const [protocol] = item.protocolId ? await db.select().from(schema.protocols).where(eq(schema.protocols.id, item.protocolId)).limit(1) : [];
  const [referrer] = item.referrerId ? await db.select({ id: schema.referrers.id, name: schema.referrers.name, discipline: schema.referrers.discipline }).from(schema.referrers).where(eq(schema.referrers.id, item.referrerId)).limit(1) : [];
  const [study] = item.studyId ? await db.select().from(schema.studies).where(eq(schema.studies.id, item.studyId)).limit(1) : [];
  const ser = item.studyId ? await db.select().from(schema.series).where(eq(schema.series.studyId, item.studyId)).orderBy(schema.series.number) : [];
  const inst = item.studyId ? await db.select().from(schema.instances).where(eq(schema.instances.studyId, item.studyId)).orderBy(schema.instances.number) : [];
  const qc = item.studyId ? await db.select().from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, item.studyId), eq(schema.inferenceResults.task, 'qc'))) : [];
  const dose = item.studyId ? await db.select().from(schema.doseRecords).where(eq(schema.doseRecords.studyId, item.studyId)).orderBy(desc(schema.doseRecords.version)).limit(1) : [];
  const repeats = await db.select().from(schema.repeatRejects).where(eq(schema.repeatRejects.worklistItemId, item.id));
  const contrast = await db.select().from(schema.contrastAdministrations).where(eq(schema.contrastAdministrations.worklistItemId, item.id));
  const priors = patient ? await db.select({ id: schema.studies.id, accession: schema.studies.accession, modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, receivedAt: schema.studies.receivedAt }).from(schema.studies).where(and(eq(schema.studies.patientId, patient.id), eq(schema.studies.practiceId, item.practiceId))).orderBy(desc(schema.studies.receivedAt)).limit(5) : [];
  const gate = patient ? await gateCheck(c.get('services'), { patientId: patient.id, appointmentId: item.appointmentId, orderId: item.orderId, modalityType: item.modalityType }) : null;
  return c.json({ item, patient: patient ? { ...patient, idNumber: undefined, idNumberMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : null } : null, protocol: protocol ?? null, referrer: referrer ?? null, study: study ?? null, series: ser, instances: inst, qc, dose: dose[0] ?? null, repeats, contrast, priors: priors.filter((p) => p.id !== item.studyId), gate, reasons: REPEAT_REASONS });
});

const createItem = z.object({ siteId: z.string(), roomId: z.string(), patientId: z.string().optional(), procedureCode: z.string(), scheduledAt: z.string().optional(), priority: z.enum(['routine', 'urgent', 'stat']).default('routine'), indication: z.string().optional(), laterality: z.enum(['L', 'R', 'B']).optional(), referrerId: z.string().optional(), orderId: z.string().optional(), appointmentId: z.string().optional(), emergency: z.boolean().default(false), emergencyName: z.string().optional() });
/** Manual or emergency worklist entry (M08-R-107). */
r.post('/worklist', allow('RAD', 'FDK', 'BKG', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, createItem);
  const services = c.get('services');
  const db = services.db;
  const proc = findProcedure(data.procedureCode);
  if (!proc) throw invalid(`Unknown procedure code ${data.procedureCode}`);
  const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, data.roomId)).limit(1);
  if (!room) throw notFound('Room');
  let patientId = data.patientId;
  if (!patientId) {
    if (!data.emergency) throw invalid('patientId is required unless emergency');
    patientId = newId('pat');
    await db.insert(schema.patients).values({ id: patientId, practiceId, epid: `TEMP${Date.now() % 1000000000}`, firstName: 'Unknown', lastName: data.emergencyName ?? `Emergency ${new Date().toISOString().slice(11, 16)}`, idType: 'temp', consents: {}, flags: ['temporary_identity'] });
  }
  const [pat] = await db.select({ firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(eq(schema.patients.id, patientId)).limit(1);
  const id = newId('wl');
  const scheduledAt = data.scheduledAt ?? services.clock.now().toISOString();
  await db.insert(schema.worklistItems).values({ id, practiceId, siteId: data.siteId, roomId: data.roomId, modalityType: proc.modality, orderId: data.orderId ?? null, appointmentId: data.appointmentId ?? null, patientId, patientName: pat ? `${pat.lastName}, ${pat.firstName}` : null, referrerId: data.referrerId ?? null, procedureCode: proc.code, procedureDescription: proc.description, bodyPart: proc.bodyPart, laterality: data.laterality ?? null, contrast: !!proc.contrast, priority: data.emergency ? 'stat' : data.priority, indication: data.indication ?? null, scheduledAt, status: data.emergency ? 'arrived' : 'scheduled', arrivedAt: data.emergency ? scheduledAt : null, emergency: data.emergency });
  await audit(c, 'worklist.created', { type: 'worklist_item', id }, { emergency: data.emergency, procedureCode: proc.code });
  await emit(c, 'worklist.item.created.v1', { worklistItemId: id, practiceId, siteId: data.siteId, roomId: data.roomId, patientId, procedureCode: proc.code, emergency: data.emergency }, { aggregateType: 'worklist_item', aggregateId: id });
  return c.json({ id, patientId }, 201);
});

async function loadItem(c: any, id: string) {
  const [item] = await c.get('services').db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, id)).limit(1);
  if (!item) throw notFound('Worklist item');
  return item as typeof schema.worklistItems.$inferSelect;
}
const transitions: Record<string, string[]> = { scheduled: ['arrived', 'cancelled'], arrived: ['in_room', 'cancelled', 'not_performed'], in_room: ['in_progress', 'arrived', 'not_performed'], in_progress: ['completed', 'not_performed'], completed: [], cancelled: [], not_performed: [] };
function assertTransition(from: string, to: string) {
  if (!transitions[from]?.includes(to)) throw conflict(`Cannot move a worklist item from ${from} to ${to}`);
}

r.post('/worklist/:id/arrive', allow('RAD', 'FDK', 'NUR', 'PRM', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  assertTransition(item.status, 'arrived');
  const at = c.get('services').clock.now().toISOString();
  await c.get('services').db.update(schema.worklistItems).set({ status: 'arrived', arrivedAt: at, updatedAt: at }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.arrived', { type: 'worklist_item', id: item.id });
  await emit(c, 'worklist.item.arrived.v1', { worklistItemId: item.id, patientId: item.patientId, siteId: item.siteId }, { aggregateType: 'worklist_item', aggregateId: item.id });
  return c.json({ ok: true, at });
});

/** Identity check: two identifiers confirmed with the patient plus a wristband or label scan where issued (M08-R-102). */
r.post('/worklist/:id/identity', allow('RAD', 'NUR', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const { identifiers, wristbandScanned, witness } = await body(c, z.object({ identifiers: z.array(z.enum(['full_name', 'id_number', 'date_of_birth', 'mobile'])).min(2), wristbandScanned: z.boolean().default(false), witness: z.string().optional() }));
  if (!wristbandScanned && !witness) throw invalid('A manual identity match needs two identifiers and a named witness');
  const user = c.get('user')!;
  const at = c.get('services').clock.now().toISOString();
  const identityCheck = { identifiers, wristbandScanned, checkedBy: user.id, checkedAt: at, witness };
  await c.get('services').db.update(schema.worklistItems).set({ identityCheck, technologistUserId: user.id, updatedAt: at }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.identity_checked', { type: 'worklist_item', id: item.id }, { identifiers, wristbandScanned });
  return c.json({ identityCheck });
});

/** Safety re-confirmation of the M07 answers; a changed answer re-opens the questionnaire (routes to M07 by event). */
r.post('/worklist/:id/safety', allow('RAD', 'NUR', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const data = await body(c, z.object({ pregnancy: z.enum(['no', 'yes', 'not_sure', 'n/a']).default('n/a'), egfr: z.number().nullable().optional(), allergies: z.string().default('none'), metformin: z.enum(['no', 'yes', 'n/a']).default('n/a'), changed: z.boolean().default(false), notes: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const at = services.clock.now().toISOString();
  const gate = await gateCheck(services, { patientId: item.patientId, appointmentId: item.appointmentId, orderId: item.orderId, modalityType: item.modalityType });
  const ionising = ['DX', 'CT', 'MG', 'DXA', 'RF', 'CR'].includes(item.modalityType);
  const pregnancyRoute = ionising && (data.pregnancy === 'yes' || data.pregnancy === 'not_sure');
  const safetyGate = { allowed: gate.allowed && !pregnancyRoute, reason: pregnancyRoute ? `pregnancy declared "${data.pregnancy}": pregnancy protocol, RGT justification required` : gate.reason, source: gate.source, checkedAt: at, pregnancy: data.pregnancy, egfr: data.egfr ?? null, allergies: data.allergies, metformin: data.metformin, reconfirmedAt: at, reconfirmedBy: user.id };
  await services.db.update(schema.worklistItems).set({ safetyGate, updatedAt: at }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.safety_reconfirmed', { type: 'worklist_item', id: item.id }, { pregnancy: data.pregnancy, changed: data.changed, pregnancyRoute });
  if (data.changed) await emit(c, 'safety.answer_changed.v1', { worklistItemId: item.id, patientId: item.patientId, appointmentId: item.appointmentId, notes: data.notes ?? null }, { aggregateType: 'worklist_item', aggregateId: item.id });
  return c.json({ safetyGate, pregnancyRoute });
});

/** Protocol Hand suggestion (A2; CT, MR and diagnostic MG need RGT acceptance). */
r.post('/worklist/:id/protocol/suggest', allow('RAD', 'RGT', 'NUR', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const services = c.get('services');
  const task = await runHand(services, 'protocol', { worklistItemId: item.id }, { practiceId: item.practiceId, trigger: 'manual', title: `Protocol for ${item.procedureDescription ?? item.procedureCode}`, aggregateType: 'worklist_item', aggregateId: item.id });
  await audit(c, 'worklist.protocol_suggested', { type: 'worklist_item', id: item.id }, { taskId: task.id, status: task.status });
  return c.json({ task, suggestion: task.output?.suggestion ?? null });
});

r.post('/worklist/:id/protocol', allow('RAD', 'RGT', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const { protocolId, source, provenance } = await body(c, z.object({ protocolId: z.string(), source: z.enum(['hand', 'rgt', 'rad', 'standing_rule']).default('rad'), provenance: z.object({ modelId: z.string(), modelVersion: z.string(), confidence: z.number(), reasons: z.array(z.string()) }).optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [proto] = await services.db.select().from(schema.protocols).where(eq(schema.protocols.id, protocolId)).limit(1);
  if (!proto) throw notFound('Protocol');
  if (proto.requiresRgt && !proto.standingRule && user.persona !== 'RGT' && source !== 'standing_rule') throw conflict('This protocol requires radiologist acceptance (A1)');
  const at = services.clock.now().toISOString();
  await services.db.update(schema.worklistItems).set({ protocolId, protocolSource: source, protocolProvenance: provenance ? { ...provenance, acceptedBy: user.id, acceptedAt: at } : null, updatedAt: at }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.protocol_set', { type: 'worklist_item', id: item.id }, { protocolId, source, acceptedBy: user.id });
  return c.json({ ok: true, protocol: proto });
});

r.post('/worklist/:id/contrast-calc', allow('RAD', 'NUR', 'RGT', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const { weightKg, egfr } = await body(c, z.object({ weightKg: z.number().min(2).max(300), egfr: z.number().nullable().optional() }));
  const db = c.get('services').db;
  const [proto] = item.protocolId ? await db.select().from(schema.protocols).where(eq(schema.protocols.id, item.protocolId)).limit(1) : [];
  const [pat] = await db.select({ flags: schema.patients.flags }).from(schema.patients).where(eq(schema.patients.id, item.patientId)).limit(1);
  const calc = contrastCalc(proto?.contrastRule ?? null, weightKg, egfr ?? item.safetyGate?.egfr ?? null, pat?.flags ?? []);
  return c.json({ calc, protocolId: proto?.id ?? null });
});

/** Start the study (MPPS N-CREATE, In Progress). Requires identity check, safety gate and no QA block. */
r.post('/worklist/:id/start', allow('RAD', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  if (!['arrived', 'in_room'].includes(item.status)) throw conflict(`Cannot start a study in status ${item.status}`);
  const services = c.get('services');
  const user = c.get('user')!;
  if (!item.identityCheck) throw conflict('Identity check must be recorded before the study can start');
  const gate = await gateCheck(services, { patientId: item.patientId, appointmentId: item.appointmentId, orderId: item.orderId, modalityType: item.modalityType });
  const localGate = item.safetyGate;
  if (!gate.allowed) return c.json({ error: 'safety_gate', message: gate.reason, gate }, 409);
  if (localGate && !localGate.allowed && !(await body(c, z.object({ rgtJustification: z.string().optional() }))).rgtJustification) return c.json({ error: 'safety_gate', message: localGate.reason, gate: localGate }, 409);
  const now = services.clock.now().toISOString();
  const qa = await services.db.select({ id: schema.qaTests.id, testType: schema.qaTests.testType }).from(schema.qaTests).where(and(eq(schema.qaTests.roomId, item.roomId), eq(schema.qaTests.blocking, true), isNull(schema.qaTests.doneAt), lt(schema.qaTests.dueAt, now)));
  if (qa.length) return c.json({ error: 'qa_blocked', message: `Room blocked: overdue ${qa.map((q) => q.testType).join(', ')} (M02-R-006); CMP override required`, qa }, 409);
  await services.db.update(schema.worklistItems).set({ status: 'in_progress', startedAt: now, technologistUserId: user.id, updatedAt: now }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.started', { type: 'worklist_item', id: item.id }, { gate: gate.reason });
  await emit(c, 'study.started.v1', { worklistItemId: item.id, patientId: item.patientId, siteId: item.siteId, roomId: item.roomId, technologistUserId: user.id }, { aggregateType: 'worklist_item', aggregateId: item.id });
  return c.json({ ok: true, startedAt: now, gate });
});

/** MPPS N-SET Completed: completeness check → study complete → study.completed.v1. */
r.post('/worklist/:id/complete', allow('RAD', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  if (item.status !== 'in_progress') throw conflict('Only a study in progress can be completed');
  if (!item.studyId) throw conflict('No images received yet; acquire the study first');
  const { note, overrideIncomplete } = await body(c, z.object({ note: z.string().optional(), overrideIncomplete: z.string().min(3).optional() }));
  const res = await completeAcquisition(c.get('services'), { studyId: item.studyId, worklistItemId: item.id, technologistUserId: c.get('user')!.id, note: note ?? null, overrideIncomplete: overrideIncomplete ?? null });
  if (!res.ok) return c.json({ error: 'incomplete', message: `Expected series missing: ${res.missing.join(', ')}. Acquire them or override with a reason.`, missing: res.missing }, 409);
  await audit(c, 'worklist.completed', { type: 'worklist_item', id: item.id }, { studyId: item.studyId, overrideIncomplete: overrideIncomplete ?? null });
  return c.json({ ok: true, dose: res.dose, completedAt: res.at });
});

r.post('/worklist/:id/repeat', allow('RAD', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const data = await body(c, z.object({ reasonCode: z.enum(REPEAT_REASONS), reasonText: z.string().optional(), seriesId: z.string().optional(), kind: z.enum(['repeat', 'reject']).default('repeat'), qcSuggested: z.boolean().default(false) }));
  if (data.reasonCode === 'other' && !data.reasonText) throw invalid('Reason "other" requires free text');
  const id = await recordRepeat(c.get('services'), { practiceId: item.practiceId, siteId: item.siteId, roomId: item.roomId, modalityType: item.modalityType, worklistItemId: item.id, studyId: item.studyId, seriesId: data.seriesId ?? null, kind: data.kind, reasonCode: data.reasonCode, reasonText: data.reasonText ?? null, technologistUserId: c.get('user')!.id, qcSuggested: data.qcSuggested });
  await audit(c, 'worklist.repeat_recorded', { type: 'worklist_item', id: item.id }, { repeatId: id, reasonCode: data.reasonCode });
  return c.json({ id }, 201);
});

r.post('/worklist/:id/note', allow('RAD', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const { text, keyImageIds } = await body(c, z.object({ text: z.string().max(2000).optional(), keyImageIds: z.array(z.string()).optional() }));
  const db = c.get('services').db;
  await db.update(schema.worklistItems).set({ technologistNote: text ?? item.technologistNote }).where(eq(schema.worklistItems.id, item.id));
  if (item.studyId) await db.update(schema.studies).set({ technologistNote: text ?? item.technologistNote, ...(keyImageIds ? { keyImageIds } : {}) }).where(eq(schema.studies.id, item.studyId));
  await audit(c, 'worklist.note', { type: 'worklist_item', id: item.id });
  return c.json({ ok: true });
});

r.post('/worklist/:id/cancel', allow('RAD', 'FDK', 'PRM', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'id'));
  const { reason, notPerformed } = await body(c, z.object({ reason: z.string().min(3), notPerformed: z.boolean().default(false) }));
  const to = notPerformed ? 'not_performed' : 'cancelled';
  assertTransition(item.status, to);
  await c.get('services').db.update(schema.worklistItems).set({ status: to, cancelReason: reason }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'worklist.cancelled', { type: 'worklist_item', id: item.id }, { reason, to });
  await emit(c, 'worklist.item.cancelled.v1', { worklistItemId: item.id, appointmentId: item.appointmentId, reason, status: to }, { aggregateType: 'worklist_item', aggregateId: item.id });
  return c.json({ ok: true });
});

/* ---------- Protocols ---------- */
r.get('/protocols', allow(...CONSOLE), async (c) => {
  const practiceId = c.get('practiceId');
  const { modality } = query(c, z.object({ modality: z.string().optional() }));
  const rows = await c.get('services').db.select().from(schema.protocols).where(and(or(isNull(schema.protocols.practiceId), practiceId ? eq(schema.protocols.practiceId, practiceId) : undefined), modality ? eq(schema.protocols.modalityType, modality) : undefined)).orderBy(schema.protocols.modalityType, schema.protocols.bodyPart, schema.protocols.ageBand);
  return c.json({ protocols: rows, procedures: PROCEDURES });
});
r.get('/protocols/queue', allow('RGT', 'RAD', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const rows = await c.get('services').db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.practiceId, practiceId), inArray(schema.worklistItems.modalityType, ['CT', 'MR']), inArray(schema.worklistItems.status, ['scheduled', 'arrived', 'in_room']), isNull(schema.worklistItems.protocolId))).orderBy(schema.worklistItems.scheduledAt).limit(100);
  return c.json({ queue: rows });
});
r.post('/protocols', allow('RGT', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ code: z.string(), name: z.string(), modalityType: z.string(), bodyPart: z.string(), procedureCodes: z.array(z.string()), ageBand: z.enum(['adult', 'paediatric']).default('adult'), contrast: z.boolean().default(false), parameters: z.record(z.union([z.string(), z.number()])).default({}), expectedSeries: z.array(z.string()).default([]), drlQuantity: z.string().optional(), drlValue: z.number().optional(), requiresRgt: z.boolean().default(false), contrastRule: z.object({ agent: z.string(), concentration: z.string(), mlPerKg: z.number(), maxMl: z.number(), rateMlS: z.number(), egfrMin: z.number() }).optional() }));
  const id = newId('prot');
  await c.get('services').db.insert(schema.protocols).values({ id, practiceId, ...data, drlValue: data.drlValue ? Math.round(data.drlValue * 1000) : null, drlQuantity: data.drlQuantity ?? null, contrastRule: data.contrastRule ?? null });
  await audit(c, 'protocol.created', { type: 'protocol', id }, { code: data.code });
  return c.json({ id }, 201);
});

/* ---------- Repeat / reject statistics ---------- */
r.get('/repeats', allow(...CONSOLE), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId, roomId, date } = query(c, z.object({ siteId: z.string().optional(), roomId: z.string().optional(), date: z.string().optional() }));
  const db = c.get('services').db;
  const day = date ?? todaySast();
  const { start, end } = await dayRange(day);
  const rows = await db.select().from(schema.repeatRejects).where(and(eq(schema.repeatRejects.practiceId, practiceId), gte(schema.repeatRejects.createdAt, start), lt(schema.repeatRejects.createdAt, end), siteId ? eq(schema.repeatRejects.siteId, siteId) : undefined, roomId ? eq(schema.repeatRejects.roomId, roomId) : undefined));
  const studies = await db.select({ id: schema.studies.id, instanceCount: schema.studies.instanceCount }).from(schema.studies).where(and(eq(schema.studies.practiceId, practiceId), gte(schema.studies.receivedAt, start), lt(schema.studies.receivedAt, end), siteId ? eq(schema.studies.siteId, siteId) : undefined, roomId ? eq(schema.studies.roomId, roomId) : undefined));
  const byReason: Record<string, number> = {};
  for (const x of rows) byReason[x.reasonCode] = (byReason[x.reasonCode] ?? 0) + 1;
  const exposures = studies.reduce((a, s) => a + s.instanceCount, 0) || 1;
  return c.json({ date: day, repeats: rows.filter((x) => x.kind === 'repeat').length, rejects: rows.filter((x) => x.kind === 'reject').length, studies: studies.length, exposures, ratePct: Math.round((rows.length / exposures) * 1000) / 10, byReason, rows });
});

/* ---------- Nurse: contrast administration and reactions ---------- */
r.get('/contrast', allow('NUR', 'RAD', 'RGT', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId, date } = query(c, z.object({ siteId: z.string().optional(), date: z.string().optional() }));
  const db = c.get('services').db;
  const { start, end } = await dayRange(date ?? todaySast());
  const items = await db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.practiceId, practiceId), gte(schema.worklistItems.scheduledAt, start), lt(schema.worklistItems.scheduledAt, end), siteId ? eq(schema.worklistItems.siteId, siteId) : undefined)).orderBy(schema.worklistItems.scheduledAt);
  const ids = items.map((i) => i.id);
  const admins = ids.length ? await db.select().from(schema.contrastAdministrations).where(inArray(schema.contrastAdministrations.worklistItemId, ids)) : [];
  const pids = [...new Set(items.map((i) => i.patientId))];
  const pats = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth, flags: schema.patients.flags }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  return c.json({ items: items.map((i) => ({ ...i, patient: pmap.get(i.patientId) ?? null, administration: admins.find((a) => a.worklistItemId === i.id) ?? null })) });
});
r.post('/contrast/:worklistItemId/administer', allow('NUR', 'RAD', 'SUP'), async (c) => {
  const item = await loadItem(c, param(c, 'worklistItemId'));
  const data = await body(c, z.object({ agent: z.string(), concentration: z.string().optional(), weightKg: z.number(), egfr: z.number().nullable().optional(), volumePlannedMl: z.number(), volumeDeliveredMl: z.number().optional(), rateMlS: z.number().default(3), batchNo: z.string().optional(), expiry: z.string().optional(), manualReason: z.string().optional() }));
  if (!data.batchNo && !data.manualReason) throw invalid('Contrast needs a batch scan or a documented manual reason (M08-R-104)');
  const services = c.get('services');
  const user = c.get('user')!;
  const [pat] = await services.db.select({ flags: schema.patients.flags }).from(schema.patients).where(eq(schema.patients.id, item.patientId)).limit(1);
  const [proto] = item.protocolId ? await services.db.select().from(schema.protocols).where(eq(schema.protocols.id, item.protocolId)).limit(1) : [];
  const calc = contrastCalc(proto?.contrastRule ?? null, data.weightKg, data.egfr ?? item.safetyGate?.egfr ?? null, pat?.flags ?? []);
  if (calc.blocked) return c.json({ error: 'contrast_blocked', message: calc.blocked, calc }, 409);
  const at = services.clock.now().toISOString();
  const id = newId('ctr');
  await services.db.insert(schema.contrastAdministrations).values({ id, practiceId: item.practiceId, siteId: item.siteId, worklistItemId: item.id, studyId: item.studyId, patientId: item.patientId, agent: data.agent, concentration: data.concentration ?? calc.concentration, weightKg: data.weightKg, egfr: data.egfr ?? item.safetyGate?.egfr ?? null, volumePlannedMl: data.volumePlannedMl, volumeDeliveredMl: data.volumeDeliveredMl ?? data.volumePlannedMl, rateMlS: Math.round(data.rateMlS * 10), batchNo: data.batchNo ?? null, expiry: data.expiry ?? null, manualReason: data.manualReason ?? null, status: 'administered', administeredBy: user.id, administeredAt: at });
  await audit(c, 'contrast.administered', { type: 'contrast_administration', id }, { batchNo: data.batchNo ?? null, manual: !!data.manualReason });
  await emit(c, 'contrast.administered.v1', { contrastId: id, worklistItemId: item.id, studyId: item.studyId, patientId: item.patientId, agent: data.agent, volumeMl: data.volumeDeliveredMl ?? data.volumePlannedMl, batchNo: data.batchNo ?? null }, { aggregateType: 'contrast_administration', aggregateId: id });
  return c.json({ id, calc }, 201);
});
r.post('/contrast/:id/reaction', allow('NUR', 'RAD', 'RGT', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ severity: z.enum(['mild', 'moderate', 'severe']), symptoms: z.string().min(2), treatment: z.string().min(2), radiologistCalled: z.boolean().default(true) }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [adm] = await services.db.select().from(schema.contrastAdministrations).where(eq(schema.contrastAdministrations.id, id)).limit(1);
  if (!adm) throw notFound('Contrast administration');
  const at = services.clock.now().toISOString();
  const incidentId = newId('inc');
  await services.db.update(schema.contrastAdministrations).set({ reaction: { ...data, incidentId, recordedBy: user.id, recordedAt: at } }).where(eq(schema.contrastAdministrations.id, id));
  const [pat] = await services.db.select({ flags: schema.patients.flags }).from(schema.patients).where(eq(schema.patients.id, adm.patientId)).limit(1);
  const flags = new Set(pat?.flags ?? []);
  flags.add('contrast_reaction');
  await services.db.update(schema.patients).set({ flags: [...flags] }).where(eq(schema.patients.id, adm.patientId));
  await audit(c, 'contrast.reaction', { type: 'contrast_administration', id }, { severity: data.severity, incidentId });
  await emit(c, 'incident.opened.v1', { incidentId, practiceId: adm.practiceId, siteId: adm.siteId, category: 'contrast_reaction', severity: data.severity === 'severe' ? 'high' : data.severity === 'moderate' ? 'medium' : 'low', source: 'M08', relatedType: 'contrast_administration', relatedId: id, patientId: adm.patientId, description: `${data.severity} contrast reaction: ${data.symptoms}` }, { aggregateType: 'incident', aggregateId: incidentId });
  return c.json({ ok: true, incidentId });
});

r.get('/status', (c) => c.json({ module: 'M08', status: 'ok' }));

export default defineModule({
  code: 'M08', name: 'Acquisition & Worklist', basePath: 'acquisition', routes: r,
  boot(services) {
    registerHand<{ worklistItemId: string }, { suggestion: unknown }>(protocolHand, async (input, ctx) => {
      const item = await ctx.step('read_order', { worklistItemId: input.worklistItemId }, async () => (await services.db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, input.worklistItemId)).limit(1))[0]);
      if (!item) throw new Error('Worklist item not found');
      const patient = await ctx.step('read_patient_safety_profile', { patientId: item.patientId }, async () => (await services.db.select({ dateOfBirth: schema.patients.dateOfBirth, flags: schema.patients.flags, sex: schema.patients.sex }).from(schema.patients).where(eq(schema.patients.id, item.patientId)).limit(1))[0] ?? null);
      await ctx.step('read_priors_index', { patientId: item.patientId }, async () => (await services.db.select({ id: schema.studies.id }).from(schema.studies).where(eq(schema.studies.patientId, item.patientId))).length);
      const suggestion = await ctx.step('read_protocol_library', { modality: item.modalityType }, async () => suggestProtocol(services, item, patient));
      if (suggestion.contrast?.blocked) ctx.leashCheck([{ rule: 'mayProposeContrastBelowEgfr', actual: false, compare: 'eq' }]);
      const provenance = { modelId: 'protocol-hand', modelVersion: '2.4.1', confidence: suggestion.confidence, reasons: suggestion.reasons };
      if (suggestion.requiresRgt) {
        await ctx.step('enqueue_for_protocolling', { worklistItemId: item.id, suggestion: suggestion.code }, async () => services.db.update(schema.worklistItems).set({ protocolProvenance: provenance, protocolSource: null }).where(eq(schema.worklistItems.id, item.id)));
        ctx.log('CT/MR/diagnostic MG or contrast block: placed in the RGT protocolling queue; not finalised by the Hand');
      } else if (suggestion.protocolId) {
        await ctx.step('propose_protocol', { protocolId: suggestion.protocolId }, async () => services.db.update(schema.worklistItems).set({ protocolId: suggestion.protocolId, protocolSource: suggestion.standingRule ? 'standing_rule' : 'hand', protocolProvenance: provenance }).where(eq(schema.worklistItems.id, item.id)));
      }
      if (suggestion.contrast?.suggested) await ctx.step('propose_contrast_dose', { egfr: item.safetyGate?.egfr ?? null }, async () => contrastCalc(null, 70, item.safetyGate?.egfr ?? null));
      return { suggestion, provenance };
    });

    // Cluster A events populate the MWL; the seed does the same for demo days.
    on('appointment.booked.v1', async (evt) => {
      const p = evt.payload as { appointmentId: string; orderId?: string; patientId: string; practiceId: string; siteId: string; roomId: string; modalityType?: string; procedureCode: string; startsAt: string; referrerId?: string; priority?: string; indication?: string; laterality?: string };
      const existing = await services.db.select({ id: schema.worklistItems.id }).from(schema.worklistItems).where(eq(schema.worklistItems.appointmentId, p.appointmentId)).limit(1);
      if (existing.length) return;
      const proc = findProcedure(p.procedureCode);
      const [pat] = await services.db.select({ firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(eq(schema.patients.id, p.patientId)).limit(1);
      const id = newId('wl');
      await services.db.insert(schema.worklistItems).values({ id, practiceId: p.practiceId, siteId: p.siteId, roomId: p.roomId, modalityType: p.modalityType ?? proc?.modality ?? 'DX', orderId: p.orderId ?? null, appointmentId: p.appointmentId, patientId: p.patientId, patientName: pat ? `${pat.lastName}, ${pat.firstName}` : null, referrerId: p.referrerId ?? null, procedureCode: p.procedureCode, procedureDescription: proc?.description ?? p.procedureCode, bodyPart: proc?.bodyPart ?? null, laterality: p.laterality ?? null, contrast: !!proc?.contrast, priority: p.priority ?? 'routine', indication: p.indication ?? null, scheduledAt: p.startsAt, status: 'scheduled' });
      await runHand(services, 'protocol', { worklistItemId: id }, { practiceId: p.practiceId, trigger: 'appointment.booked.v1', title: `Protocol for ${proc?.description ?? p.procedureCode}`, aggregateType: 'worklist_item', aggregateId: id });
    });
    on('patient.arrived.v1', async (evt) => {
      const p = evt.payload as { appointmentId: string; patientId: string; safety?: Record<string, unknown> };
      const at = services.clock.now().toISOString();
      const rows = await services.db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.appointmentId, p.appointmentId), eq(schema.worklistItems.status, 'scheduled')));
      for (const it of rows) {
        const gate = await gateCheck(services, { patientId: p.patientId, appointmentId: p.appointmentId, orderId: it.orderId, modalityType: it.modalityType });
        await services.db.update(schema.worklistItems).set({ status: 'arrived', arrivedAt: at, updatedAt: at, safetyGate: { ...gate, checkedAt: at, ...(p.safety ?? {}) } as any }).where(eq(schema.worklistItems.id, it.id));
      }
    });
    // Modality simulator (demo only)
    registerModalitySim();
  },
});
