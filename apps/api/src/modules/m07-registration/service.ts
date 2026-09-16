import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { schema, type CollectSnapshot } from '@bonakala/db';
import { defineHand, newId, notFound, conflict } from '@bonakala/domain';
import { emit, emitDirect, registerHand, runHand, type AppContext, type Services } from '../../kernel/index.js';
import { loadCatalogue, type ProcedureDef } from '../m04-referrals/catalogue.js';
import { ageFrom } from '../m04-referrals/appropriateness.js';
import { collectCard, fundingForOrder } from '../m06-funding/service.js';
import { sastDate, sastTime } from '../m05-scheduling/slots.js';
import { sendWhatsApp } from '../../sim/whatsapp.js';
import { consentTypesFor, evaluateSet, setsFor, QUESTION_SETS, type SafetySet } from './safety.js';

export async function proceduresForOrder(services: Services, orderId: string): Promise<ProcedureDef[]> {
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) throw notFound('Order');
  const cat = await loadCatalogue(services);
  return order.procedures.map((p) => cat.find((x) => x.code === p.code)).filter((x): x is ProcedureDef => !!x);
}

/** Create (or return) the encounter for an appointment and seed its questionnaires. */
export async function ensureEncounter(services: Services, input: { appointmentId?: string | null; orderId: string; channel?: string; c?: AppContext }) {
  const [existing] = await services.db.select().from(schema.encounters).where(input.appointmentId ? eq(schema.encounters.appointmentId, input.appointmentId) : eq(schema.encounters.orderId, input.orderId)).orderBy(desc(schema.encounters.createdAt)).limit(1);
  if (existing) return existing;
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, input.orderId)).limit(1);
  if (!order) throw notFound('Order');
  const appt = input.appointmentId ? (await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId)).limit(1))[0] : undefined;
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, order.patientId)).limit(1);
  const id = newId('enc');
  await services.db.insert(schema.encounters).values({
    id, practiceId: order.practiceId, siteId: appt?.siteId ?? order.siteId ?? 'site_san', appointmentId: input.appointmentId ?? null, orderId: order.id, patientId: order.patientId,
    status: 'pre_checked_in', channel: input.channel ?? 'patient_space', language: patient?.language ?? 'en', identityLevel: patient?.idVerifiedAt ? 2 : patient?.idNumber ? 1 : 0, identityVerifiedAt: patient?.idVerifiedAt ?? null,
    collect: null, stillNeeded: [],
  });
  const procs = await proceduresForOrder(services, order.id);
  const sets = setsFor(procs);
  for (const set of sets) {
    await services.db.insert(schema.safetyQuestionnaires).values({ id: newId('sfq'), practiceId: order.practiceId, encounterId: id, patientId: order.patientId, set, version: QUESTION_SETS[set].version, answers: {}, completeness: 0, status: 'not_started', blockingItems: [], conditions: [] });
  }
  await refreshCollect(services, id);
  const [row] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, id)).limit(1);
  if (input.c) await emit(input.c, 'visit.prechecked_in.v1', { encounterId: id, orderId: order.id, patientId: order.patientId, practiceId: order.practiceId }, { aggregateType: 'encounter', aggregateId: id, practiceId: order.practiceId });
  return row!;
}

export async function refreshCollect(services: Services, encounterId: string): Promise<CollectSnapshot | null> {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) return null;
  const card = await collectCard(services, enc.orderId);
  const snapshot: CollectSnapshot = { totalCents: card.totalCents, schemePortionCents: card.schemePortionCents, patientPortionCents: card.patientPortionCents, previousBalanceCents: card.previousBalanceCents, depositsPaidCents: card.depositsPaidCents, collectNowCents: card.collectNowCents, reasonCodes: card.reasonCodes, quoteVersion: card.quoteVersion ?? undefined };
  await services.db.update(schema.encounters).set({ collect: snapshot, updatedAt: new Date().toISOString() }).where(eq(schema.encounters.id, encounterId));
  return snapshot;
}

/** Items still needed before the visit (docs/processes/04 §6.9). */
export async function stillNeeded(services: Services, encounterId: string): Promise<string[]> {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) return [];
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, enc.patientId)).limit(1);
  const qs = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.encounterId, encounterId));
  const cons = await services.db.select().from(schema.consents).where(eq(schema.consents.encounterId, encounterId));
  const procs = await proceduresForOrder(services, enc.orderId);
  const needed: string[] = [];
  if (enc.identityLevel < 1) needed.push('ID document photo');
  if (!enc.schemeCardCaptured && patient?.schemeId) needed.push('Scheme card');
  for (const q of qs) if (q.completeness < 100) needed.push(`${QUESTION_SETS[q.set as SafetySet].title} questions`);
  for (const t of consentTypesFor(procs)) if (!cons.some((x) => x.type === t && x.granted && !x.withdrawnAt)) needed.push(`${t} consent`);
  const contrast = qs.find((q) => q.set === 'contrast');
  if (contrast && !contrast.answers['egfr_value'] && (contrast.answers['kidney_problems'] === 'yes' || contrast.answers['kidney_problems'] === 'unsure')) needed.push('Recent eGFR result');
  const card = enc.collect;
  if (card && card.collectNowCents > 0) needed.push(`Payment of R${Math.round(card.collectNowCents / 100)}`);
  await services.db.update(schema.encounters).set({ stillNeeded: needed }).where(eq(schema.encounters.id, encounterId));
  return needed;
}

export async function recomputeQuestionnaire(services: Services, id: string) {
  const [q] = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.id, id)).limit(1);
  if (!q) throw notFound('Questionnaire');
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, q.patientId)).limit(1);
  const res = evaluateSet(q.set as SafetySet, q.answers, { sex: patient?.sex, age: ageFrom(patient?.dateOfBirth) });
  const status = q.status === 'overridden' || (q.status === 'cleared_with_conditions' && res.status === 'needs_review') ? q.status : res.status;
  await services.db.update(schema.safetyQuestionnaires).set({ completeness: res.completeness, status, blockingItems: res.blockingItems, conditions: res.conditions, updatedAt: new Date().toISOString() }).where(eq(schema.safetyQuestionnaires.id, id));
  return { ...q, completeness: res.completeness, status, blockingItems: res.blockingItems, conditions: res.conditions };
}

export interface GateCheck { check: string; ok: boolean; severity: 'block' | 'warn'; detail: string }
export interface GateResult { encounterId: string; allowed: boolean; blocked: boolean; warnings: GateCheck[]; blocks: GateCheck[]; checks: GateCheck[]; overridden: boolean; override?: typeof schema.encounters.$inferSelect['gateOverride'] }

/** The acquisition gate (docs/processes/04 §7.4): deterministic, evaluated here, enforced by M08. */
export async function evaluateGate(services: Services, encounterId: string): Promise<GateResult> {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) throw notFound('Encounter');
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, enc.orderId)).limit(1);
  const qs = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.encounterId, encounterId));
  const cons = await services.db.select().from(schema.consents).where(eq(schema.consents.encounterId, encounterId));
  const procs = await proceduresForOrder(services, enc.orderId);
  const funding = await fundingForOrder(services, enc.orderId);
  const checks: GateCheck[] = [];
  checks.push({ check: 'identity', ok: enc.identityLevel >= 1, severity: 'block', detail: enc.identityLevel >= 1 ? `Identity level L${enc.identityLevel}` : 'Identity not documented (L0)' });
  checks.push({ check: 'justification', ok: order ? order.justification !== 'not_justified' : false, severity: 'block', detail: order ? `Justification ${order.justification}` : 'Order missing' });
  const needConsents = consentTypesFor(procs);
  const missingConsents = needConsents.filter((t) => !cons.some((x) => x.type === t && x.granted && !x.withdrawnAt));
  checks.push({ check: 'consent', ok: missingConsents.length === 0, severity: 'block', detail: missingConsents.length ? `Missing: ${missingConsents.join(', ')}` : `Signed: ${needConsents.join(', ')}` });
  for (const q of qs) {
    const title = QUESTION_SETS[q.set as SafetySet].title;
    const ok = ['cleared', 'cleared_with_conditions', 'overridden'].includes(q.status);
    const detail = ok ? (q.conditions?.length ? `${title}: cleared with conditions (${q.conditions.join('; ')})` : `${title}: cleared`) : q.status === 'blocked' ? `${title}: ${q.blockingItems.join('; ')}` : q.completeness < 100 ? `${title}: ${q.completeness} % answered` : `${title}: needs clinician review (${q.conditions.join('; ')})`;
    checks.push({ check: q.set, ok, severity: 'block', detail });
  }
  const fundingOk = !funding || !['expired'].includes(funding.fundingCase.status);
  checks.push({ check: 'funding', ok: fundingOk, severity: 'warn', detail: funding ? `Funding ${funding.fundingCase.status}${funding.fundingCase.authNumber ? ` · ${funding.fundingCase.authNumber}` : ''}` : 'No funding case' });
  if (enc.infectionControl) checks.push({ check: 'infection_control', ok: false, severity: 'warn', detail: `Infection control pathway: ${enc.infectionControl}` });
  const overridden = !!enc.gateOverride;
  const blocks = checks.filter((x) => !x.ok && x.severity === 'block');
  const warnings = checks.filter((x) => !x.ok && x.severity === 'warn');
  return { encounterId, allowed: blocks.length === 0 || overridden, blocked: blocks.length > 0 && !overridden, blocks, warnings, checks, overridden, override: enc.gateOverride };
}

export async function issueTicket(services: Services, encounterId: string) {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) throw notFound('Encounter');
  const [existing] = await services.db.select().from(schema.queueTickets).where(eq(schema.queueTickets.encounterId, encounterId)).limit(1);
  if (existing) return existing;
  const procs = await proceduresForOrder(services, enc.orderId);
  const roomType = procs[0]?.modality ?? 'XR';
  const today = sastDate(services.clock.now());
  const todays = await services.db.select({ n: sql<number>`count(*)` }).from(schema.queueTickets).where(and(eq(schema.queueTickets.siteId, enc.siteId), gte(schema.queueTickets.issuedAt, `${today}T00:00:00.000Z`)));
  const n = (todays[0]?.n ?? 0) + 1;
  const ticket = `${roomType.slice(0, 1)}-${String(n).padStart(3, '0')}`;
  const waiting = await services.db.select({ n: sql<number>`count(*)` }).from(schema.queueTickets).where(and(eq(schema.queueTickets.siteId, enc.siteId), eq(schema.queueTickets.roomType, roomType), eq(schema.queueTickets.status, 'waiting')));
  const estimated = Math.max(5, (waiting[0]?.n ?? 0) * (procs[0]?.durationMin ?? 15));
  const id = newId('tkt');
  await services.db.insert(schema.queueTickets).values({ id, practiceId: enc.practiceId, siteId: enc.siteId, encounterId, ticket, roomType, status: 'waiting', issuedAt: new Date().toISOString(), estimatedWaitMinutes: estimated });
  await services.db.update(schema.encounters).set({ queueTicket: ticket, updatedAt: new Date().toISOString() }).where(eq(schema.encounters.id, encounterId));
  const [row] = await services.db.select().from(schema.queueTickets).where(eq(schema.queueTickets.id, id)).limit(1);
  return row!;
}

/** Arrival: encounter becomes arrived, appointment arrived, ticket issued, patient.arrived.v1 emitted. */
export async function markArrived(services: Services, encounterId: string, opts: { c?: AppContext; channel?: string; actor?: string } = {}) {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) throw notFound('Encounter');
  if (['arrived', 'waiting', 'called', 'in_room', 'done'].includes(enc.status)) return enc;
  const now = new Date().toISOString();
  await services.db.update(schema.encounters).set({ status: 'waiting', arrivedAt: now, channel: opts.channel ?? enc.channel, updatedAt: now }).where(eq(schema.encounters.id, encounterId));
  if (enc.appointmentId) await services.db.update(schema.appointments).set({ status: 'arrived', updatedAt: now }).where(eq(schema.appointments.id, enc.appointmentId));
  await issueTicket(services, encounterId);
  await refreshCollect(services, encounterId);
  await stillNeeded(services, encounterId);
  const payload = { appointmentId: enc.appointmentId, orderId: enc.orderId, patientId: enc.patientId, practiceId: enc.practiceId, siteId: enc.siteId, encounterId };
  if (opts.c) await emit(opts.c, 'patient.arrived.v1', payload, { aggregateType: 'encounter', aggregateId: encounterId, practiceId: enc.practiceId });
  else await emitDirect(services, 'patient.arrived.v1', payload, { aggregateType: 'encounter', aggregateId: encounterId, practiceId: enc.practiceId });
  const [row] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  return row!;
}

export async function encounterDetail(services: Services, encounterId: string) {
  const [enc] = await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId)).limit(1);
  if (!enc) return null;
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, enc.patientId)).limit(1);
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, enc.orderId)).limit(1);
  const appt = enc.appointmentId ? (await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, enc.appointmentId)).limit(1))[0] ?? null : null;
  const questionnaires = await services.db.select().from(schema.safetyQuestionnaires).where(eq(schema.safetyQuestionnaires.encounterId, encounterId));
  const consents = await services.db.select().from(schema.consents).where(eq(schema.consents.encounterId, encounterId));
  const [ticket] = await services.db.select().from(schema.queueTickets).where(eq(schema.queueTickets.encounterId, encounterId)).limit(1);
  const referrer = order?.referrerId ? (await services.db.select({ id: schema.referrers.id, name: schema.referrers.name }).from(schema.referrers).where(eq(schema.referrers.id, order.referrerId)).limit(1))[0] ?? null : null;
  const [site] = await services.db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.id, enc.siteId)).limit(1);
  return {
    encounter: enc, patient: patient ? { ...patient, idNumber: undefined, idMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : '', age: ageFrom(patient.dateOfBirth) } : null,
    order: order ?? null, appointment: appt, referrer, site: site ?? null, questionnaires: questionnaires.map((q) => ({ ...q, title: QUESTION_SETS[q.set as SafetySet].title, questions: QUESTION_SETS[q.set as SafetySet].questions })),
    consents, ticket: ticket ?? null, collect: await collectCard(services, enc.orderId), gate: await evaluateGate(services, encounterId), stillNeeded: enc.stillNeeded ?? [],
  };
}

/* ---------------- Front Desk Hand ---------------- */
export const frontDeskHand = defineHand({
  id: 'front-desk', name: 'Front Desk Hand', module: 'M07', level: 'A3',
  mandate: 'Invite and guide pre-check-in, chase missing documents and answers, explain the Collect card in plain language, prepare the desk’s still-needed list and route clinical questions to NUR or RGT.',
  defaultLeash: { maxMessagesPerVisit: 4, maxDocumentRequests: 3 },
  approvalPersona: 'FDK', approvalPolicy: 'FDK confirms guardian consent flows and anything outside preparation, logistics and the Collect card.',
  tools: { 'visit.read': 'R0', 'patient.read': 'R0', 'collect_card.read': 'R0', 'questionnaire.read_status': 'R0', 'visit.update': 'R1', 'document.request': 'R2', 'message.send': 'R2', 'task.create': 'R1' },
});

export interface FrontDeskHandInput extends Record<string, unknown> { encounterId: string }

export function registerFrontDeskHand() {
  registerHand<FrontDeskHandInput, Record<string, unknown>>(frontDeskHand, async (input, ctx) => {
    const services = ctx.services;
    const enc = await ctx.step('visit.read', { encounterId: input.encounterId }, async () => (await services.db.select().from(schema.encounters).where(eq(schema.encounters.id, input.encounterId)).limit(1))[0]);
    if (!enc) throw new Error('Encounter not found');
    const patient = await ctx.step('patient.read', { patientId: enc.patientId }, async () => (await services.db.select().from(schema.patients).where(eq(schema.patients.id, enc.patientId)).limit(1))[0]);
    await ctx.step('collect_card.read', { orderId: enc.orderId }, () => refreshCollect(services, enc.id));
    const needed = await ctx.step('questionnaire.read_status', { encounterId: enc.id }, () => stillNeeded(services, enc.id));
    await ctx.step('visit.update', { stillNeeded: needed.length }, () => services.db.update(schema.encounters).set({ stillNeeded: needed, updatedAt: new Date().toISOString() }).where(eq(schema.encounters.id, enc.id)));
    if (!needed.length) { ctx.log('Nothing outstanding for this visit'); return { sent: 0, stillNeeded: [] }; }
    const sentSoFar = (enc.stillNeeded ?? []).length && enc.status !== 'pre_checked_in' ? 1 : 0;
    ctx.leashCheck([{ rule: 'maxMessagesPerVisit', actual: sentSoFar + 1 }]);
    const appt = enc.appointmentId ? (await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, enc.appointmentId)).limit(1))[0] : undefined;
    const procs = await proceduresForOrder(services, enc.orderId);
    const when = appt ? `on ${sastDate(appt.startsAt)} at ${sastTime(appt.startsAt)}` : 'for your visit';
    const prep = procs.map((p) => p.prep).filter((p) => p && p !== 'No preparation needed').join(' ');
    const card = enc.collect;
    const money = card && card.collectNowCents > 0 ? ` You pay R${Math.round(card.collectNowCents / 100)} on the day, nothing more later.` : '';
    const text = `Save time ${when}: we still need ${needed.slice(0, 3).join(', ')}. It takes about 3 minutes in Patient Space.${prep ? ` ${prep}` : ''}${money}`;
    if (patient?.mobile) {
      await ctx.step('message.send', { to: '[MOBILE]', template: 'precheckin.chase' }, () => sendWhatsApp(services, { practiceId: enc.practiceId, to: patient.mobile!, text, buttons: ['Pre-check-in', 'Call me'], by: 'hand:front-desk', patientId: patient.id }));
    }
    const contrast = await services.db.select().from(schema.safetyQuestionnaires).where(and(eq(schema.safetyQuestionnaires.encounterId, enc.id), eq(schema.safetyQuestionnaires.set, 'contrast')));
    if (contrast.some((q) => q.status === 'blocked' || q.status === 'needs_review')) await ctx.step('task.create', { queue: 'NUR', reason: 'contrast review' }, async () => ({ queue: 'nurse_review', encounterId: enc.id }));
    return { sent: patient?.mobile ? 1 : 0, stillNeeded: needed, provenance: { modelId: 'front-desk-hand', modelVersion: '2026.1', outputClass: 3 } };
  });
}

export async function runFrontDeskHand(services: Services, encounterId: string, practiceId: string, trigger = 'appointment.booked.v1') {
  return runHand<FrontDeskHandInput>(services, 'front-desk', { encounterId }, { practiceId, trigger, title: `Pre-arrival run ${encounterId.slice(-6)}`, aggregateType: 'encounter', aggregateId: encounterId });
}

export { QUESTION_SETS, evaluateSet, setsFor, consentTypesFor };
export type { SafetySet };
export { inArray, lt, desc };
