import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, forbidden, invalid, parseSaId } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { sastDate, sastTime } from '../m05-scheduling/slots.js';
import { refreshCollect } from './service.js';
import { QUESTION_SETS, encounterDetail, ensureEncounter, evaluateGate, markArrived, recomputeQuestionnaire, registerFrontDeskHand, runFrontDeskHand, stillNeeded } from './service.js';

const r = router();
const DESK = ['FDK', 'BKG', 'PRM', 'SUP', 'NUR', 'RAD', 'RGT', 'EXE', 'CMP'] as const;

/* ---------- Questionnaire definitions ---------- */
r.get('/questionnaires/definitions', allow(), (c) => c.json({ sets: QUESTION_SETS }));

/* ---------- Encounters ---------- */
r.get('/encounters', allow(...DESK), async (c) => {
  const practiceId = requirePractice(c);
  const { date, siteId, status } = query(c, z.object({ date: z.string().optional(), siteId: z.string().optional(), status: z.string().optional() }));
  const services = c.get('services');
  const day = date ?? sastDate(services.clock.now());
  const from = new Date(`${day}T00:00:00+02:00`).toISOString();
  const to = new Date(`${day}T23:59:59+02:00`).toISOString();
  const appts = await services.db.select().from(schema.appointments).where(and(eq(schema.appointments.practiceId, practiceId), gte(schema.appointments.startsAt, from), lt(schema.appointments.startsAt, to), ne(schema.appointments.status, 'cancelled'), siteId ? eq(schema.appointments.siteId, siteId) : undefined)).orderBy(schema.appointments.startsAt);
  const encs = await services.db.select().from(schema.encounters).where(and(eq(schema.encounters.practiceId, practiceId), siteId ? eq(schema.encounters.siteId, siteId) : undefined, status ? inArray(schema.encounters.status, status.split(',')) : undefined));
  const pids = [...new Set(appts.map((a) => a.patientId))];
  const patients = pids.length ? await services.db.select().from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const sites = await services.db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites);
  const rooms = await services.db.select({ id: schema.rooms.id, name: schema.rooms.name }).from(schema.rooms);
  const oids = [...new Set(appts.map((a) => a.orderId))];
  const fcs = oids.length ? await services.db.select({ orderId: schema.fundingCases.orderId, status: schema.fundingCases.status, patientPortionCents: schema.fundingCases.patientPortionCents, authStatus: schema.fundingCases.authStatus, authNumber: schema.fundingCases.authNumber }).from(schema.fundingCases).where(inArray(schema.fundingCases.orderId, oids)) : [];
  const orders = oids.length ? await services.db.select({ id: schema.orders.id, referrerId: schema.orders.referrerId, priority: schema.orders.priority }).from(schema.orders).where(inArray(schema.orders.id, oids)) : [];
  const referrers = await services.db.select({ id: schema.referrers.id, name: schema.referrers.name }).from(schema.referrers);
  const encIds = encs.map((e) => e.id);
  const qs = encIds.length ? await services.db.select().from(schema.safetyQuestionnaires).where(inArray(schema.safetyQuestionnaires.encounterId, encIds)) : [];
  const rows = appts.map((a) => {
    const enc = encs.find((e) => e.appointmentId === a.id) ?? null;
    const p = patients.find((x) => x.id === a.patientId);
    const o = orders.find((x) => x.id === a.orderId);
    const eq_ = enc ? qs.filter((q) => q.encounterId === enc.id) : [];
    return {
      appointmentId: a.id, orderId: a.orderId, encounterId: enc?.id ?? null, startsAt: a.startsAt, time: sastTime(a.startsAt), status: enc?.status ?? (a.status === 'booked' || a.status === 'confirmed' ? 'expected' : a.status),
      appointmentStatus: a.status, procedure: a.procedureDescription ?? a.procedureCode, modalityType: a.modalityType, room: rooms.find((x) => x.id === a.roomId)?.name ?? null, site: sites.find((x) => x.id === a.siteId)?.name ?? null, siteId: a.siteId,
      patient: p ? { id: p.id, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, sex: p.sex, language: p.language, schemeName: p.schemeName, flags: p.flags ?? [], idMasked: p.idNumber ? `····${p.idNumber.slice(-4)}` : '' } : null,
      referrer: referrers.find((x) => x.id === o?.referrerId)?.name ?? null, priority: o?.priority ?? 'routine', funding: fcs.find((x) => x.orderId === a.orderId) ?? null,
      collect: enc?.collect ?? null, stillNeeded: enc?.stillNeeded ?? [], queueTicket: enc?.queueTicket ?? null, arrivedAt: enc?.arrivedAt ?? null,
      safety: eq_.map((q) => ({ set: q.set, status: q.status, completeness: q.completeness })), preCheckedIn: !!enc && enc.status !== 'pre_checked_in' ? true : !!enc && (enc.stillNeeded ?? []).length === 0,
    };
  });
  const walkIns = encs.filter((e) => !e.appointmentId && (e.arrivedAt ?? '') >= from);
  return c.json({ date: day, rows, walkIns, counts: { booked: appts.length, arrived: rows.filter((x) => x.arrivedAt).length, needsAttention: rows.filter((x) => (x.stillNeeded ?? []).length).length, expectedCollectionsCents: rows.reduce((a, x) => a + (x.collect?.collectNowCents ?? 0), 0) } });
});

r.post('/encounters', allow(...DESK, 'PAT'), async (c) => {
  const { orderId, appointmentId, channel } = await body(c, z.object({ orderId: z.string(), appointmentId: z.string().optional(), channel: z.enum(['patient_space', 'whatsapp', 'kiosk', 'desk', 'adt']).optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [o] = await services.db.select({ patientId: schema.orders.patientId, appointmentId: schema.orders.appointmentId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  const enc = await ensureEncounter(services, { orderId, appointmentId: appointmentId ?? o.appointmentId, channel: channel ?? (user.persona === 'PAT' ? 'patient_space' : 'desk'), c });
  await stillNeeded(services, enc.id);
  await audit(c, 'encounter.created', { type: 'encounter', id: enc.id }, { orderId });
  return c.json({ encounter: enc }, 201);
});

r.get('/encounters/:id', allow(...DESK, 'PAT'), async (c) => {
  const detail = await encounterDetail(c.get('services'), param(c, 'id'));
  if (!detail) throw notFound('Encounter');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && detail.encounter.patientId !== user.patientId) throw forbidden();
  return c.json(detail);
});

/** The acquisition gate, consumed by cluster B (M08) by name. */
r.get('/encounters/:id/gate', allow(...DESK, 'BIO', 'AIO'), async (c) => c.json({ gate: await evaluateGate(c.get('services'), param(c, 'id')) }));

r.post('/encounters/:id/gate/override', allow('RGT', 'PRM', 'CMP', 'NUR'), async (c) => {
  const id = param(c, 'id');
  const { reason, items, confirm } = await body(c, z.object({ reason: z.string().min(10), items: z.array(z.string()).min(1), confirm: z.string() }));
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  const [patient] = await services.db.select({ lastName: schema.patients.lastName }).from(schema.patients).where(eq(schema.patients.id, enc.patientId)).limit(1);
  if (confirm.trim().toLowerCase() !== (patient?.lastName ?? '').toLowerCase()) throw invalid('Type the patient’s surname to confirm this override');
  const user = c.get('user')!;
  const gate = await evaluateGate(services, id);
  const clinicalItems = ['mri', 'contrast', 'ionising'];
  if (user.persona === 'NUR' && items.some((i) => clinicalItems.includes(i))) throw forbidden('A nurse may not override pregnancy, MRI or contrast items alone');
  const override = { by: user.id, persona: user.persona, reason, at: new Date().toISOString(), items };
  await services.db.update(schema.encounters).set({ gateOverride: override, updatedAt: override.at }).where(eq(schema.encounters.id, id));
  await services.db.update(schema.safetyQuestionnaires).set({ status: 'overridden', clearedBy: user.id, clearedAt: override.at, clearanceNote: reason }).where(and(eq(schema.safetyQuestionnaires.encounterId, id), inArray(schema.safetyQuestionnaires.set, items)));
  await audit(c, 'safety.gate_overridden', { type: 'encounter', id }, { items, reason, persona: user.persona, blocksAtOverride: gate.blocks.map((b) => b.check) });
  await emit(c, 'safety.overridden.v1', { encounterId: id, orderId: enc.orderId, patientId: enc.patientId, practiceId: enc.practiceId, items, reason, by: user.id, persona: user.persona }, { aggregateType: 'encounter', aggregateId: id });
  return c.json({ gate: await evaluateGate(services, id) });
});

/* ---------- Pre-check-in and questionnaires ---------- */
r.patch('/questionnaires/:id', allow(...DESK, 'PAT'), async (c) => {
  const id = param(c, 'id');
  const { answers, answeredBy, answeredVia } = await body(c, z.object({ answers: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])), answeredBy: z.enum(['patient', 'guardian', 'clinician']).default('patient'), answeredVia: z.enum(['patient_space', 'kiosk', 'desk', 'whatsapp']).default('patient_space') }));
  const services = c.get('services');
  const [q] = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.id, id)).limit(1);
  if (!q) throw notFound('Questionnaire');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && q.patientId !== user.patientId) throw forbidden();
  await services.db.update(schema.safetyQuestionnaires).set({ answers: { ...q.answers, ...answers }, answeredBy, answeredVia, updatedAt: new Date().toISOString() }).where(eq(schema.safetyQuestionnaires.id, id));
  const updated = await recomputeQuestionnaire(services, id);
  await stillNeeded(services, q.encounterId);
  await audit(c, 'safety.answered', { type: 'safety_questionnaire', id }, { set: q.set, status: updated.status, via: answeredVia });
  await emit(c, updated.status === 'blocked' ? 'safety.blocked.v1' : 'safety.answered.v1', { questionnaireId: id, encounterId: q.encounterId, patientId: q.patientId, set: q.set, status: updated.status, blockingItems: updated.blockingItems }, { aggregateType: 'encounter', aggregateId: q.encounterId });
  return c.json({ questionnaire: updated, gate: await evaluateGate(services, q.encounterId) });
});

r.post('/questionnaires/:id/clear', allow('NUR', 'RGT', 'RAD', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const { note, conditions } = await body(c, z.object({ note: z.string().min(3), conditions: z.array(z.string()).default([]) }));
  const services = c.get('services');
  const [q] = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.id, id)).limit(1);
  if (!q) throw notFound('Questionnaire');
  const user = c.get('user')!;
  if (q.blockingItems.length && !['RGT', 'PRM'].includes(user.persona)) throw forbidden('Blocked items need a radiologist decision');
  const at = new Date().toISOString();
  await services.db.update(schema.safetyQuestionnaires).set({ status: conditions.length ? 'cleared_with_conditions' : 'cleared', conditions: conditions.length ? conditions : q.conditions, blockingItems: [], clearedBy: user.id, clearedAt: at, clearanceNote: note, updatedAt: at }).where(eq(schema.safetyQuestionnaires.id, id));
  await audit(c, 'safety.cleared', { type: 'safety_questionnaire', id }, { note, conditions, persona: user.persona });
  await emit(c, 'safety.cleared.v1', { questionnaireId: id, encounterId: q.encounterId, set: q.set, by: user.id }, { aggregateType: 'encounter', aggregateId: q.encounterId });
  return c.json({ gate: await evaluateGate(services, q.encounterId) });
});

/* ---------- Consents ---------- */
r.post('/encounters/:id/consents', allow(...DESK, 'PAT'), async (c) => {
  const id = param(c, 'id');
  const { types, signedVia, language, evidence, signerRelationship } = await body(c, z.object({ types: z.array(z.string()).min(1), signedVia: z.enum(['patient_space', 'kiosk', 'desk', 'whatsapp']).default('patient_space'), language: z.string().default('en'), evidence: z.string().default('tap'), signerRelationship: z.enum(['self', 'guardian', 'proxy']).default('self') }));
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && enc.patientId !== user.patientId) throw forbidden();
  const at = new Date().toISOString();
  const existing = await services.db.select().from(schema.consents).where(eq(schema.consents.encounterId, id));
  for (const t of types) {
    if (existing.some((x) => x.type === t && x.granted && !x.withdrawnAt)) continue;
    await services.db.insert(schema.consents).values({ id: newId('cns'), practiceId: enc.practiceId, encounterId: id, patientId: enc.patientId, type: t, language, granted: true, signedVia, signerRelationship, evidence, signedAt: at });
  }
  await stillNeeded(services, id);
  await audit(c, 'consent.captured', { type: 'encounter', id }, { types, signedVia, signerRelationship });
  await emit(c, 'consent.captured.v1', { encounterId: id, patientId: enc.patientId, types, signedVia }, { aggregateType: 'encounter', aggregateId: id });
  return c.json({ gate: await evaluateGate(services, id) });
});

r.post('/consents/:id/withdraw', allow('PAT', 'FDK', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const [x] = await services.db.select().from(schema.consents).where(eq(schema.consents.id, id)).limit(1);
  if (!x) throw notFound('Consent');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && x.patientId !== user.patientId) throw forbidden();
  await services.db.update(schema.consents).set({ granted: false, withdrawnAt: new Date().toISOString() }).where(eq(schema.consents.id, id));
  await audit(c, 'consent.withdrawn', { type: 'consent', id }, { consentType: x.type });
  await emit(c, 'consent.withdrawn.v1', { consentId: id, encounterId: x.encounterId, patientId: x.patientId, type: x.type }, { aggregateType: 'encounter', aggregateId: x.encounterId });
  return c.json({ ok: true });
});

/* ---------- Kiosk ---------- */
r.post('/kiosk/identify', allow(...DESK, 'PAT'), async (c) => {
  const { idNumber, ticketCode, mobile } = await body(c, z.object({ idNumber: z.string().optional(), ticketCode: z.string().optional(), mobile: z.string().optional() }));
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const today = sastDate(services.clock.now());
  const from = new Date(`${today}T00:00:00+02:00`).toISOString();
  const to = new Date(`${today}T23:59:59+02:00`).toISOString();
  let patientId: string | null = null;
  if (idNumber) {
    if (!parseSaId(idNumber).valid && idNumber.length === 13) throw invalid('That ID number does not check out; ask for help at the desk');
    const [p] = await services.db.select({ id: schema.patients.id }).from(schema.patients).where(and(eq(schema.patients.practiceId, practiceId), eq(schema.patients.idNumber, idNumber))).limit(1);
    patientId = p?.id ?? null;
  } else if (mobile) {
    const digits = mobile.replace(/\D/g, '');
    const rows = await services.db.select({ id: schema.patients.id, mobile: schema.patients.mobile }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId));
    patientId = rows.find((x) => (x.mobile ?? '').replace(/\D/g, '') === digits)?.id ?? null;
  } else if (ticketCode) {
    const [t] = await services.db.select().from(schema.queueTickets).where(eq(schema.queueTickets.ticket, ticketCode)).limit(1);
    if (t) { const d = await encounterDetail(services, t.encounterId); return c.json({ found: !!d, encounter: d }); }
  }
  if (!patientId) return c.json({ found: false, message: 'We could not find you. Ask for help at the desk.' }, 404);
  const appts = await services.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, patientId), gte(schema.appointments.startsAt, from), lt(schema.appointments.startsAt, to), inArray(schema.appointments.status, ['booked', 'confirmed', 'arrived'])));
  if (!appts.length) return c.json({ found: false, message: 'No appointment for today at this site. Ask for help at the desk.' }, 404);
  const appt = appts[0]!;
  const enc = await ensureEncounter(services, { orderId: appt.orderId, appointmentId: appt.id, channel: 'kiosk', c });
  const detail = await encounterDetail(services, enc.id);
  await audit(c, 'kiosk.identified', { type: 'encounter', id: enc.id }, { method: idNumber ? 'id' : mobile ? 'mobile' : 'ticket' });
  return c.json({ found: true, encounter: detail });
});

r.post('/kiosk/:encounterId/check-in', allow(...DESK, 'PAT'), async (c) => {
  const id = param(c, 'encounterId');
  const { confirmed, answers, consents } = await body(c, z.object({ confirmed: z.boolean().default(true), answers: z.record(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).default({}), consents: z.array(z.string()).default([]) }));
  if (!confirmed) return c.json({ ok: false, message: 'A person from the front desk will come to you.' }, 200);
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  const qs = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.encounterId, id));
  for (const [set, a] of Object.entries(answers)) {
    const q = qs.find((x) => x.set === set);
    if (!q) continue;
    await services.db.update(schema.safetyQuestionnaires).set({ answers: { ...q.answers, ...a }, answeredBy: 'patient', answeredVia: 'kiosk', updatedAt: new Date().toISOString() }).where(eq(schema.safetyQuestionnaires.id, q.id));
    await recomputeQuestionnaire(services, q.id);
  }
  const at = new Date().toISOString();
  const existing = await services.db.select().from(schema.consents).where(eq(schema.consents.encounterId, id));
  for (const t of consents) if (!existing.some((x) => x.type === t && x.granted)) await services.db.insert(schema.consents).values({ id: newId('cns'), practiceId: enc.practiceId, encounterId: id, patientId: enc.patientId, type: t, language: enc.language ?? 'en', granted: true, signedVia: 'kiosk', signerRelationship: 'self', evidence: 'tap', signedAt: at });
  await services.db.update(schema.encounters).set({ identityLevel: Math.max(enc.identityLevel, 1), identityEvidence: enc.identityEvidence ?? 'kiosk id scan (demo)', updatedAt: at }).where(eq(schema.encounters.id, id));
  await markArrived(services, id, { c, channel: 'kiosk' });
  await stillNeeded(services, id);
  const gate = await evaluateGate(services, id);
  const [ticket] = await services.db.select().from(schema.queueTickets).where(eq(schema.queueTickets.encounterId, id)).limit(1);
  await audit(c, 'kiosk.checked_in', { type: 'encounter', id }, { ticket: ticket?.ticket, blocked: gate.blocked });
  return c.json({ ok: true, ticket: ticket ?? null, gate, waitMinutes: ticket?.estimatedWaitMinutes ?? null });
});

/* ---------- Front desk check-in ---------- */
r.post('/encounters/:id/check-in', allow('FDK', 'BKG', 'PRM', 'SUP', 'NUR'), async (c) => {
  const id = param(c, 'id');
  const { idVerified, schemeCardCaptured, interpreter, chaperone, accessibility, infectionControl, consents } = await body(c, z.object({ idVerified: z.boolean().default(false), schemeCardCaptured: z.boolean().default(false), interpreter: z.string().optional(), chaperone: z.boolean().default(false), accessibility: z.string().optional(), infectionControl: z.string().optional(), consents: z.array(z.string()).default([]) }));
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  const at = new Date().toISOString();
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, enc.patientId)).limit(1);
  let level = enc.identityLevel;
  if (idVerified) {
    const valid = patient?.idType === 'sa_id' ? parseSaId(patient.idNumber ?? '').valid : !!patient?.idNumber;
    if (!valid) throw invalid('The ID on file does not validate; correct it in the patient record first');
    level = patient?.schemeId ? 2 : 1;
    await services.db.update(schema.patients).set({ idVerifiedAt: at }).where(eq(schema.patients.id, enc.patientId));
  }
  await services.db.update(schema.encounters).set({ identityLevel: level, identityVerifiedAt: idVerified ? at : enc.identityVerifiedAt, identityEvidence: idVerified ? 'ID document seen at desk' : enc.identityEvidence, schemeCardCaptured: schemeCardCaptured || enc.schemeCardCaptured, interpreter: interpreter ?? enc.interpreter, chaperone: chaperone || enc.chaperone, accessibility: accessibility ?? enc.accessibility, infectionControl: infectionControl ?? enc.infectionControl, updatedAt: at }).where(eq(schema.encounters.id, id));
  for (const t of consents) {
    const ex = await services.db.select().from(schema.consents).where(and(eq(schema.consents.encounterId, id), eq(schema.consents.type, t)));
    if (!ex.some((x) => x.granted && !x.withdrawnAt)) await services.db.insert(schema.consents).values({ id: newId('cns'), practiceId: enc.practiceId, encounterId: id, patientId: enc.patientId, type: t, language: enc.language ?? 'en', granted: true, signedVia: 'desk', signerRelationship: 'self', evidence: 'signature', signedAt: at });
  }
  await markArrived(services, id, { c, channel: 'desk' });
  await stillNeeded(services, id);
  if (idVerified) await emit(c, 'identity.verified.v1', { encounterId: id, patientId: enc.patientId, level }, { aggregateType: 'encounter', aggregateId: id });
  await audit(c, 'visit.checked_in', { type: 'encounter', id }, { idVerified, schemeCardCaptured, consents });
  return c.json(await encounterDetail(services, id));
});

r.post('/encounters/:id/collect', allow('FDK', 'PRM', 'SUP', 'DEB'), async (c) => {
  const id = param(c, 'id');
  const { amountCents, method, reference } = await body(c, z.object({ amountCents: z.number().int().min(0), method: z.enum(['card', 'payshap', 'eft', 'cash', 'qr']), reference: z.string().optional() }));
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  await services.db.update(schema.encounters).set({ collectedCents: enc.collectedCents + amountCents, updatedAt: new Date().toISOString() }).where(eq(schema.encounters.id, id));
  await refreshCollect(services, id);
  await stillNeeded(services, id);
  await audit(c, 'visit.collected', { type: 'encounter', id }, { amountCents, method, reference });
  // M14 owns receipts and the ledger; this records the desk collection and tells them.
  await emit(c, 'payment.collected.v1', { encounterId: id, orderId: enc.orderId, patientId: enc.patientId, practiceId: enc.practiceId, amountCents, method, reference: reference ?? null }, { aggregateType: 'encounter', aggregateId: id });
  return c.json({ collect: (await encounterDetail(services, id))?.collect });
});

r.patch('/encounters/:id/status', allow('FDK', 'RAD', 'NUR', 'PRM', 'SUP', 'BKG'), async (c) => {
  const id = param(c, 'id');
  const { status, room } = await body(c, z.object({ status: z.enum(['waiting', 'called', 'in_room', 'done', 'left']), room: z.string().optional() }));
  const services = c.get('services');
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (!enc) throw notFound('Encounter');
  const at = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updatedAt: at, queueRoom: room ?? enc.queueRoom };
  if (status === 'called') patch['calledAt'] = at;
  if (status === 'in_room') { patch['inRoomAt'] = at; patch['waitMinutes'] = enc.arrivedAt ? Math.round((Date.now() - new Date(enc.arrivedAt).getTime()) / 60000) : null; }
  if (status === 'done') patch['doneAt'] = at;
  await services.db.update(schema.encounters).set(patch).where(eq(schema.encounters.id, id));
  const ticketStatus = status === 'called' ? 'called' : status === 'in_room' ? 'in_room' : status === 'done' ? 'done' : 'waiting';
  await services.db.update(schema.queueTickets).set({ status: ticketStatus, calledAt: status === 'called' ? at : undefined, room: room ?? undefined }).where(eq(schema.queueTickets.encounterId, id));
  if (enc.appointmentId) await services.db.update(schema.appointments).set({ status: status === 'in_room' ? 'in_room' : status === 'done' ? 'done' : 'arrived', updatedAt: at }).where(eq(schema.appointments.id, enc.appointmentId));
  await audit(c, 'queue.updated', { type: 'encounter', id }, { status, room });
  await emit(c, 'queue.updated.v1', { encounterId: id, status, room: room ?? null, siteId: enc.siteId }, { aggregateType: 'encounter', aggregateId: id });
  return c.json({ ok: true });
});

/* ---------- PAT-facing ---------- */
r.get('/mine', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ encounters: [] });
  const services = c.get('services');
  const rows = await services.db.select().from(schema.encounters).where(eq(schema.encounters.patientId, user.patientId)).orderBy(desc(schema.encounters.createdAt)).limit(5);
  const out = [];
  for (const e of rows) out.push(await encounterDetail(services, e.id));
  return c.json({ encounters: out });
});

/* ---------- Public queue display (no names) ---------- */
r.get('/queue/:siteId', async (c) => {
  const siteId = param(c, 'siteId');
  const services = c.get('services');
  const today = sastDate(services.clock.now());
  const rows = await services.db.select().from(schema.queueTickets).where(and(eq(schema.queueTickets.siteId, siteId), gte(schema.queueTickets.issuedAt, `${today}T00:00:00.000Z`))).orderBy(schema.queueTickets.issuedAt);
  const [site] = await services.db.select({ name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  return c.json({
    site: site?.name ?? siteId, at: new Date().toISOString(),
    nowServing: rows.filter((t) => t.status === 'called' || t.status === 'in_room').map((t) => ({ ticket: t.ticket, room: t.room ?? t.roomType, status: t.status })),
    waiting: rows.filter((t) => t.status === 'waiting').map((t) => ({ ticket: t.ticket, roomType: t.roomType, estimatedWaitMinutes: t.estimatedWaitMinutes })),
    done: rows.filter((t) => t.status === 'done').length,
  });
});

r.get('/status', (c) => c.json({ module: 'M07', status: 'ok' }));

export default defineModule({
  code: 'M07', name: 'Registration & Safety', basePath: 'registration', routes: r,
  boot: async () => {
    registerFrontDeskHand();
    on('appointment.booked.v1', async (evt, services) => {
      const enc = await ensureEncounter(services, { orderId: evt.payload['orderId'] as string, appointmentId: evt.payload['appointmentId'] as string, channel: 'patient_space' });
      await stillNeeded(services, enc.id);
      const startsAt = evt.payload['startsAt'] as string;
      // Pre-arrival run for appointments inside the next 3 days (A3, within leash).
      if (new Date(startsAt).getTime() - Date.now() < 3 * 86400_000) await runFrontDeskHand(services, enc.id, enc.practiceId).catch(() => undefined);
    });
    on('funding.quoted.v1', async (evt, services) => {
      const orderId = evt.payload['orderId'] as string;
      const [enc] = await services.db.select({ id: schema.encounters.id }).from(schema.encounters).where(eq(schema.encounters.orderId, orderId)).limit(1);
      if (enc) { await refreshCollect(services, enc.id); await stillNeeded(services, enc.id); }
    });
  },
  tick: async (services) => {
    // Front Desk Hand pre-arrival run for tomorrow's visits that still need something.
    const soon = new Date(Date.now() + 36 * 3600_000).toISOString();
    const appts = await services.db.select({ id: schema.appointments.id, practiceId: schema.appointments.practiceId }).from(schema.appointments).where(and(gte(schema.appointments.startsAt, new Date().toISOString()), lt(schema.appointments.startsAt, soon), inArray(schema.appointments.status, ['booked', 'confirmed']))).limit(20);
    let runs = 0;
    for (const a of appts) {
      const [enc] = await services.db.select().from(schema.encounters).where(and(eq(schema.encounters.appointmentId, a.id), isNotNull(schema.encounters.id))).limit(1);
      if (!enc || enc.status !== 'pre_checked_in') continue;
      const needed = await stillNeeded(services, enc.id);
      if (needed.length) { await runFrontDeskHand(services, enc.id, a.practiceId).catch(() => undefined); runs++; }
    }
    return { frontDeskRuns: runs };
  },
});
