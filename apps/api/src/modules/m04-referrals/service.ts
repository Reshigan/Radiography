import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { schema, type OrderProcedure, type ParsedReferral, type RecentStudyAlert, type AppropriatenessResult } from '@bonakala/db';
import { defineHand, newId, invalid, notFound, conflict } from '@bonakala/domain';
import { emit, emitDirect, nextSequence, registerHand, runHand, type AppContext, type Services } from '../../kernel/index.js';
import { loadCatalogue, type ProcedureDef } from './catalogue.js';
import { parseReferralText, REFERRAL_MODEL, type ReferrerLike } from './parser.js';
import { evaluateAppropriateness, ageFrom } from './appropriateness.js';
import { sendWhatsApp } from '../../sim/whatsapp.js';

export const ORDER_STATUSES = ['draft', 'ordered', 'scheduled', 'arrived', 'in_progress', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['scheduled', 'arrived', 'cancelled'],
  scheduled: ['ordered', 'arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled', 'scheduled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function transitionOrder(services: Services, orderId: string, to: OrderStatus, opts: { c?: AppContext; reason?: string; patch?: Partial<typeof schema.orders.$inferInsert>; actor?: string } = {}) {
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  const from = o.status as OrderStatus;
  if (from === to) return o;
  if (!ORDER_TRANSITIONS[from]?.includes(to)) throw conflict(`Order cannot move from ${from} to ${to}`);
  await services.db.update(schema.orders).set({ status: to, updatedAt: new Date().toISOString(), ...(opts.patch ?? {}) }).where(eq(schema.orders.id, orderId));
  const payload = { orderId, patientId: o.patientId, practiceId: o.practiceId, from, to, reason: opts.reason ?? null, actor: opts.actor ?? 'system' };
  if (opts.c) await emit(opts.c, `order.${to}.v1`, payload, { aggregateType: 'order', aggregateId: orderId, practiceId: o.practiceId });
  else await emitDirect(services, `order.${to}.v1`, payload, { aggregateType: 'order', aggregateId: orderId, practiceId: o.practiceId });
  return { ...o, status: to };
}

/** Recent-study detection across own orders and, by table name only, cluster B's studies table. */
export async function recentStudyCheck(services: Services, patientId: string, modality: string, bodyPart: string, excludeOrderId?: string): Promise<RecentStudyAlert> {
  const windowDays = modality === 'MG' ? 365 : modality === 'CT' || modality === 'MR' ? 90 : 30;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const matches: RecentStudyAlert['matches'] = [];
  const own = await services.db.select().from(schema.orders).where(and(eq(schema.orders.patientId, patientId), gte(schema.orders.createdAt, since), inArray(schema.orders.status, ['scheduled', 'arrived', 'in_progress', 'completed'])));
  for (const o of own) {
    if (excludeOrderId && o.id === excludeOrderId) continue;
    for (const p of o.procedures) if (p.modality === modality && p.bodyPart.toLowerCase() === bodyPart.toLowerCase()) matches.push({ source: 'order', id: o.id, modality, bodyPart: p.bodyPart, at: o.createdAt });
  }
  try {
    const rows = (await services.db.all(sql`select id, modality, procedure_code as procedureCode, created_at as createdAt from studies where patient_id = ${patientId} and modality = ${modality === 'XR' ? 'DX' : modality} and created_at >= ${since}`)) as Array<{ id: string; modality: string; procedureCode: string | null; createdAt: string }>;
    for (const r of rows) if (!r.procedureCode || r.procedureCode.toLowerCase().includes(bodyPart.toLowerCase().split(' ')[0]!)) matches.push({ source: 'study', id: r.id, modality, at: r.createdAt });
  } catch {
    /* studies table belongs to cluster B and may not exist yet */
  }
  return { found: matches.length > 0, matches, windowDays };
}

export interface CreateOrderInput {
  practiceId: string;
  patientId: string;
  referrerId?: string | null;
  referralId?: string | null;
  siteId?: string | null;
  channel?: string;
  procedures: Array<{ code: string; laterality?: OrderProcedure['laterality']; contrast?: boolean }>;
  priority?: 'routine' | 'priority' | 'urgent' | 'stat';
  icd10?: string[];
  clinicalInfo?: string | null;
  appropriatenessOverride?: { reason: string; by: string } | null;
  funderType?: string | null;
  createdBy: string;
  status?: 'draft' | 'ordered';
  justificationNote?: string | null;
}

export async function createOrder(services: Services, input: CreateOrderInput, c?: AppContext) {
  const catalogue = await loadCatalogue(services);
  if (!input.procedures.length) throw invalid('At least one procedure is required');
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, input.patientId)).limit(1);
  if (!patient) throw notFound('Patient');
  const referrer = input.referrerId ? (await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, input.referrerId)).limit(1))[0] : undefined;
  const procedures: OrderProcedure[] = [];
  let ionising = false;
  for (const p of input.procedures) {
    const def = catalogue.find((x) => x.code === p.code);
    if (!def) throw invalid(`Unknown procedure ${p.code}`);
    if (def.lateralityRequired && (!p.laterality || p.laterality === 'na')) throw invalid(`Laterality is required for ${def.description}`, { code: p.code });
    const contrast = def.contrast === 'required' ? true : def.contrast === 'none' ? false : !!p.contrast;
    ionising ||= def.ionising;
    procedures.push({ code: def.code, description: def.description, modality: def.modality, bodyPart: def.bodyPart, laterality: def.lateralityRequired ? p.laterality : 'na', contrast, tariffCode: def.tariffCode, durationMin: def.durationMin, ionising: def.ionising });
  }
  const priority = input.priority ?? 'routine';
  // Justification policy engine (docs/processes/01 §7.7): deterministic, human-only overrides.
  let justification: 'justified' | 'justified_pending_confirmation' | 'not_justified' = 'justified';
  if (ionising) {
    if (!referrer) justification = procedures.every((p) => p.modality === 'MG') ? 'justified' : 'not_justified';
    else if (referrer.status !== 'active' || !referrer.hpcsaVerifiedAt) justification = 'justified_pending_confirmation';
    else if (['phone', 'whatsapp'].includes(input.channel ?? '') && !input.referralId) justification = 'justified_pending_confirmation';
  }
  if (priority === 'stat' && justification === 'not_justified') justification = 'justified_pending_confirmation';
  const first = catalogue.find((x) => x.code === procedures[0]!.code)!;
  const appropriateness: AppropriatenessResult = { ...evaluateAppropriateness(first, input.clinicalInfo, { age: ageFrom(patient.dateOfBirth), sex: patient.sex ?? undefined }) };
  if (input.appropriatenessOverride) { appropriateness.overrideReason = input.appropriatenessOverride.reason; appropriateness.overriddenBy = input.appropriatenessOverride.by; }
  if (appropriateness.band === 'usually_not_appropriate' && !input.appropriatenessOverride && priority !== 'stat' && priority !== 'urgent') throw invalid('Guidance marks this request usually not appropriate; an override reason is required to proceed', { appropriateness });
  const recentStudy = await recentStudyCheck(services, input.patientId, first.modality, first.bodyPart);
  const protocollingRequired = procedures.some((p) => p.modality === 'CT' || p.modality === 'MR') || (appropriateness.band === 'usually_not_appropriate' && ionising);
  const seq = await nextSequence(services, `order:${input.practiceId}`);
  const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
  const orderNo = `ORD-${yy}-${String(seq).padStart(6, '0')}`;
  const id = newId('ord');
  const status = input.status ?? 'ordered';
  const validUntil = new Date(Date.now() + 90 * 86400_000).toISOString();
  await services.db.insert(schema.orders).values({
    id, practiceId: input.practiceId, orderNo, siteId: input.siteId ?? null, patientId: input.patientId, referrerId: input.referrerId ?? null, referralId: input.referralId ?? null,
    channel: input.channel ?? 'portal', procedures, priority, icd10: input.icd10 ?? [], clinicalInfo: input.clinicalInfo ?? null, justification, justificationNote: input.justificationNote ?? null,
    appropriateness, recentStudy, protocollingRequired, status, funderType: input.funderType ?? (patient.schemeId ? 'scheme' : 'cash'), createdBy: input.createdBy, validUntil,
  });
  const payload = {
    orderId: id, patientId: input.patientId, practiceId: input.practiceId, siteId: input.siteId ?? undefined, referrerId: input.referrerId ?? null,
    procedures: procedures.map((p) => ({ code: p.code, description: p.description, modality: p.modality, bodyPart: p.bodyPart, laterality: p.laterality, contrast: p.contrast })),
    priority, icd10: input.icd10 ?? [],
  };
  if (c) await emit(c, 'order.created.v1', payload, { aggregateType: 'order', aggregateId: id, practiceId: input.practiceId });
  else await emitDirect(services, 'order.created.v1', payload, { aggregateType: 'order', aggregateId: id, practiceId: input.practiceId });
  const [row] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  return row!;
}

export async function listReferrers(services: Services, practiceId: string | null): Promise<ReferrerLike[]> {
  return services.db.select({ id: schema.referrers.id, name: schema.referrers.name, hpcsaNo: schema.referrers.hpcsaNo, bhfPracticeNo: schema.referrers.bhfPracticeNo, status: schema.referrers.status }).from(schema.referrers).where(practiceId ? or(eq(schema.referrers.practiceId, practiceId), sql`${schema.referrers.practiceId} is null`) : undefined);
}

/** Match a patient from parsed cues within a practice: ID number > mobile > surname + first name. */
export async function matchPatient(services: Services, practiceId: string, cues: { idNumber?: string; mobile?: string; name?: string }): Promise<{ patientId: string; confidence: number; candidates: number } | null> {
  const active = and(eq(schema.patients.practiceId, practiceId), eq(schema.patients.status, 'active'));
  if (cues.idNumber) {
    const rows = await services.db.select({ id: schema.patients.id }).from(schema.patients).where(and(active, eq(schema.patients.idNumber, cues.idNumber))).limit(2);
    if (rows.length === 1) return { patientId: rows[0]!.id, confidence: 0.99, candidates: 1 };
  }
  if (cues.mobile) {
    const digits = cues.mobile.replace(/\D/g, '').replace(/^27/, '0');
    const rows = await services.db.select({ id: schema.patients.id, mobile: schema.patients.mobile }).from(schema.patients).where(active);
    const hits = rows.filter((r) => r.mobile && r.mobile.replace(/\D/g, '') === digits);
    if (hits.length === 1) return { patientId: hits[0]!.id, confidence: 0.95, candidates: 1 };
    if (hits.length > 1) return { patientId: hits[0]!.id, confidence: 0.5, candidates: hits.length };
  }
  if (cues.name) {
    const parts = cues.name.trim().split(/\s+/);
    const last = parts[parts.length - 1]!;
    const first = parts.length > 1 ? parts[0]! : undefined;
    const rows = await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName }).from(schema.patients).where(and(active, like(schema.patients.lastName, last))).limit(10);
    const narrowed = first ? rows.filter((r) => r.firstName.toLowerCase() === first.toLowerCase()) : rows;
    if (narrowed.length === 1) return { patientId: narrowed[0]!.id, confidence: first ? 0.85 : 0.6, candidates: 1 };
    if (narrowed.length > 1) return { patientId: narrowed[0]!.id, confidence: 0.4, candidates: narrowed.length };
  }
  return null;
}

/** Parse with the optional LLM enrichment step recorded on the task. Deterministic rules always run. */
export async function parseWithProvenance(services: Services, practiceId: string | null, text: string, step?: <T>(tool: string, args: unknown, fn: () => Promise<T>, note?: string) => Promise<T>): Promise<ParsedReferral> {
  const catalogue = await loadCatalogue(services);
  const referrers = await listReferrers(services, practiceId);
  const run = step ?? (async <T>(_t: string, _a: unknown, fn: () => Promise<T>) => fn());
  const parsed = await run('document.extract', { chars: text.length }, async () => parseReferralText(text, catalogue, referrers), 'rules-based extraction');
  if (services.llm.available && parsed.missing.length) {
    const deidentified = text.replace(/\b\d{13}\b/g, '[ID]').replace(/(?:\+27|0)\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '[MOBILE]');
    try {
      const out = await run('llm.extract', { deidentified: true }, () => services.llm.complete({ system: 'Extract imaging referral fields as JSON: {modality, bodyPart, laterality, contrast, urgency, referrerName, clinicalInfo, icd10:[]}. Never diagnose.', user: deidentified, json: true, maxTokens: 400 }), 'llm enrichment of missing fields');
      const j = JSON.parse(out) as Record<string, unknown>;
      for (const k of ['modality', 'bodyPart', 'laterality', 'contrast', 'urgency', 'referrerName', 'clinicalInfo'] as const) {
        if (!parsed.fields[k] && j[k] !== undefined && j[k] !== null) { parsed.fields[k] = { value: j[k], confidence: 0.6, source: 'llm' }; (parsed as unknown as Record<string, unknown>)[k] = j[k]; }
      }
    } catch {
      /* llm optional: deterministic result stands */
    }
  }
  return parsed;
}

/* ---------------- Referral Hand ---------------- */
export const referralHand = defineHand({
  id: 'referral', name: 'Referral Hand', module: 'M04', level: 'A3',
  mandate: 'Convert any inbound artefact into a structured, validated Order; match patient and referrer; map to the catalogue; suggest ICD-10; evaluate guidance and recent studies; ask for missing items; route exceptions to BKG.',
  defaultLeash: { maxClarificationsPerReferral: 3, minPatientMatchConfidence: 0.8, maxReferralsPerHour: 500, autoConvertMinConfidence: 0.75 },
  approvalPersona: 'BKG', approvalPolicy: 'BKG reviews needs_info referrals, unknown referrers and low-confidence matches; the Hand never marks a referrer verified.',
  tools: { 'document.extract': 'R0', 'llm.extract': 'R0', 'patient.search': 'R0', 'referrer.search': 'R0', 'catalogue.map': 'R0', 'icd10.suggest': 'R0', 'guideline.evaluate': 'R0', 'study.search_recent': 'R0', 'order.create': 'R1', 'referral.update': 'R1', 'message.send': 'R2', 'task.create': 'R1' },
});

export interface ReferralHandInput extends Record<string, unknown> { referralId: string; autoConvert?: boolean }
export interface ReferralHandOutput extends Record<string, unknown> { status: string; confidence: number; missing: string[]; orderId?: string; patientId?: string; referrerId?: string; provenance: { modelId: string; modelVersion: string; confidence: number; outputClass: 3 } }

export function registerReferralHand() {
  registerHand<ReferralHandInput, ReferralHandOutput>(referralHand, async (input, ctx) => {
    const services = ctx.services;
    const [ref] = await services.db.select().from(schema.referrals).where(eq(schema.referrals.id, input.referralId)).limit(1);
    if (!ref) throw new Error('Referral not found');
    const text = [ref.rawText, ref.photoText].filter(Boolean).join('\n');
    const parsed = await parseWithProvenance(services, ref.practiceId, text, ctx.step.bind(ctx));
    let patientId = ref.patientId;
    let patientConfidence = patientId ? 1 : 0;
    if (!patientId) {
      const m = await ctx.step('patient.search', { idNumber: parsed.patientIdNumber ? '[ID]' : undefined, mobile: parsed.patientMobile ? '[MOBILE]' : undefined, name: parsed.patientName }, () => matchPatient(services, ref.practiceId, { idNumber: parsed.patientIdNumber, mobile: parsed.patientMobile ?? ref.sourceContact ?? undefined, name: parsed.patientName }));
      if (m) { patientId = m.patientId; patientConfidence = m.confidence; }
    }
    const referrerId = ref.referrerId ?? parsed.referrerId ?? null;
    const missing = [...parsed.missing];
    if (!patientId) missing.push('patient');
    else if (patientConfidence < Number(ctx.leash['minPatientMatchConfidence'] ?? 0.8)) missing.push('patient_confirmation');
    if (!referrerId) missing.push('referrer');
    const complete = missing.filter((m) => m !== 'clinical').length === 0;
    const status = complete ? 'matched' : 'needs_info';
    await ctx.step('referral.update', { status, missing }, () => services.db.update(schema.referrals).set({ parsed, confidence: Math.round(parsed.confidence * 100), patientId: patientId ?? null, referrerId, status, needsInfo: missing, updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, ref.id)));
    let orderId: string | undefined;
    if (complete && (input.autoConvert ?? true) && parsed.confidence >= Number(ctx.leash['autoConvertMinConfidence'] ?? 0.75) && parsed.procedureCode && patientId) {
      const proc = (await loadCatalogue(services)).find((p) => p.code === parsed.procedureCode)!;
      await ctx.step('guideline.evaluate', { procedure: proc.code }, async () => evaluateAppropriateness(proc, parsed.clinicalInfo));
      await ctx.step('study.search_recent', { modality: proc.modality, bodyPart: proc.bodyPart }, () => recentStudyCheck(services, patientId!, proc.modality, proc.bodyPart));
      try {
        const order = await ctx.step('order.create', { procedure: proc.code, priority: parsed.urgency }, () =>
          createOrder(services, { practiceId: ref.practiceId, patientId: patientId!, referrerId, referralId: ref.id, channel: ref.channel, procedures: [{ code: proc.code, laterality: parsed.laterality, contrast: parsed.contrast }], priority: parsed.urgency, icd10: parsed.icd10, clinicalInfo: parsed.clinicalInfo ?? null, createdBy: 'hand:referral' }));
        orderId = order.id;
        await services.db.update(schema.referrals).set({ status: 'converted', orderId, updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, ref.id));
      } catch (e) {
        ctx.log(`order.create refused: ${(e as Error).message}; left for BKG review`);
        await services.db.update(schema.referrals).set({ status: 'needs_info', needsInfo: [...missing, 'guidance_override'], updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, ref.id));
        return { status: 'needs_info', confidence: parsed.confidence, missing: [...missing, 'guidance_override'], patientId: patientId ?? undefined, referrerId: referrerId ?? undefined, provenance: { ...REFERRAL_MODEL, confidence: parsed.confidence, outputClass: 3 } };
      }
    } else if (!complete && ref.sourceContact && ref.channel === 'whatsapp') {
      const sent = (ref.needsInfo ?? []).includes('clarification_sent') ? 1 : 0;
      ctx.leashCheck([{ rule: 'maxClarificationsPerReferral', actual: sent + 1 }]);
      const ask = missing.includes('patient') ? 'Please reply with your ID number so we can find your file.' : missing.includes('referrer') ? 'Which doctor referred you? Reply with the name or practice number on the form.' : 'Please send a clearer photo of the referral, or type the words on it.';
      await ctx.step('message.send', { to: '[MOBILE]', template: 'referral.clarify' }, () => sendWhatsApp(services, { practiceId: ref.practiceId, to: ref.sourceContact!, text: ask, by: 'hand:referral', patientId }));
    }
    return { status: orderId ? 'converted' : status, confidence: parsed.confidence, missing, orderId, patientId: patientId ?? undefined, referrerId: referrerId ?? undefined, provenance: { ...REFERRAL_MODEL, confidence: parsed.confidence, outputClass: 3 } };
  });
}

export async function runReferralHand(services: Services, referralId: string, practiceId: string, opts: { autoConvert?: boolean; trigger?: string } = {}) {
  return runHand<ReferralHandInput>(services, 'referral', { referralId, autoConvert: opts.autoConvert ?? true }, { practiceId, trigger: opts.trigger ?? 'referral.received', title: `Parse referral ${referralId.slice(-6)}`, aggregateType: 'referral', aggregateId: referralId });
}

/** Create a referral row and run the Hand synchronously so callers get the structured result. */
export async function intakeReferral(services: Services, input: { practiceId: string; channel: string; text?: string | null; photoText?: string | null; sourceName?: string | null; sourceContact?: string | null; patientId?: string | null; referrerId?: string | null; autoConvert?: boolean }) {
  const id = newId('rfl');
  const content = `${input.text ?? ''}\n${input.photoText ?? ''}`;
  const hash = await (async () => { const { sha256Hex } = await import('@bonakala/domain'); return sha256Hex(content); })();
  await services.db.insert(schema.referrals).values({ id, practiceId: input.practiceId, channel: input.channel, rawText: input.text ?? null, photoText: input.photoText ?? null, artefactHash: hash, sourceName: input.sourceName ?? null, sourceContact: input.sourceContact ?? null, patientId: input.patientId ?? null, referrerId: input.referrerId ?? null, status: 'received', receivedAt: new Date().toISOString(), parsed: null });
  const task = await runReferralHand(services, id, input.practiceId, { autoConvert: input.autoConvert });
  await services.db.update(schema.referrals).set({ taskId: task.id }).where(eq(schema.referrals.id, id));
  const [referral] = await services.db.select().from(schema.referrals).where(eq(schema.referrals.id, id)).limit(1);
  return { referral: referral!, task };
}

export async function orderWithContext(services: Services, orderId: string) {
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return null;
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, o.patientId)).limit(1);
  const referrer = o.referrerId ? (await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, o.referrerId)).limit(1))[0] : null;
  const appointment = o.appointmentId ? (await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, o.appointmentId)).limit(1))[0] : null;
  const [funding] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.orderId, o.id)).orderBy(desc(schema.fundingCases.createdAt)).limit(1);
  return { order: o, patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, dateOfBirth: patient.dateOfBirth, sex: patient.sex, schemeName: patient.schemeName, schemeOption: patient.schemeOption, language: patient.language, mobile: patient.mobile } : null, referrer: referrer ? { id: referrer.id, name: referrer.name, practiceName: referrer.practiceName, hpcsaVerifiedAt: referrer.hpcsaVerifiedAt } : null, appointment: appointment ?? null, funding: funding ?? null };
}

export type { ProcedureDef };
