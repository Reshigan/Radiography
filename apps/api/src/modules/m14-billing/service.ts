/**
 * M14 Revenue Cycle: shared service functions (charge capture, pricing, scrubbing, claim assembly,
 * responses, remittance matching, patient liability, payments, accounts, month-end). Used by routes,
 * Hands, simulators and tests. Every write that changes money emits a domain event.
 */
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, sha256Hex } from '@bonakala/domain';
import {
  addDays, ageBalances, buildSchedule, classifyFunderCode, daysBetween, eclProvision, funderTypeOf, mapProcedureToTariff, priceCharge, propensityToPay, rulePackInForce, routeShortPayment, scheduleInForce, scrubClaim, TARIFF_BY_CODE,
  type AgeableBalance, type ClaimForScrub, type FeeSchedule, type FunderType, type PricedCharge, type ReasonCode, type RulePack, type ScrubResult, type ShortPaymentClass,
} from '@bonakala/domain/billing';
import type { Services } from '../../kernel/ports.js';
import { emitDirect, nextSequence } from '../../kernel/events.js';

type Db = Services['db'];
export type ChargeRow = typeof schema.charges.$inferSelect;
export type ClaimRow = typeof schema.claims.$inferSelect;
export type AccountRow = typeof schema.patientAccounts.$inferSelect;

export const CODING_MODEL = { modelId: 'coding-hand', modelVersion: '2026.09.2' } as const;
export const PRACTICE_LETTER: Record<string, string> = { prac_a: 'A', prac_b: 'B' };
export const FUNDER_NAMES: Record<string, string> = { 'scheme-a': 'Scheme A (demo)', 'scheme-b': 'Scheme B (demo)', 'scheme-c': 'Scheme C (demo)', cash: 'Cash', raf: 'RAF', coida: 'COIDA', corporate: 'Corporate' };
export const REALTIME_FUNDERS = new Set(['scheme-a', 'scheme-b']);

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

/* ---------- Fee schedules ---------- */
export async function loadSchedules(db: Db, practiceId: string): Promise<FeeSchedule[]> {
  const heads = await db.select().from(schema.feeSchedules).where(eq(schema.feeSchedules.practiceId, practiceId));
  if (!heads.length) return [];
  const lines = await db.select().from(schema.feeScheduleLines).where(inArray(schema.feeScheduleLines.scheduleId, heads.map((h) => h.id)));
  return heads.map((h) => ({
    id: h.id, practiceId: h.practiceId, funderId: h.funderId, funderType: h.funderType as FunderType, name: h.name, kind: h.kind as FeeSchedule['kind'], version: h.version,
    effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo, upliftPct: h.upliftPct, status: h.status as FeeSchedule['status'],
    lines: lines.filter((l) => l.scheduleId === h.id).map((l) => ({ code: l.code, priceExclCents: l.priceExclCents, unit: l.unit as 'per_unit' | 'per_study' })),
  }));
}
export async function scheduleFor(db: Db, practiceId: string, funderId: string, serviceDate: string): Promise<FeeSchedule> {
  const all = await loadSchedules(db, practiceId);
  const found = scheduleInForce(all, funderId, serviceDate) ?? scheduleInForce(all, 'cash', serviceDate);
  if (found) return found;
  // Fallback for practices without configured schedules: base rates (recorded as base_uplift source).
  return buildSchedule({ id: `fs-default-${funderId}`, practiceId, funderId, funderType: funderTypeOf(funderId), name: 'Default (base rate)', kind: 'scheme_rate', version: 0, effectiveFrom: '2000-01-01', upliftPct: 0, codes: [] });
}

/* ---------- Charge capture and coding ---------- */
export interface ReportSignedPayload {
  reportId: string; studyId: string; accession?: string; patientId: string; practiceId: string; siteId?: string; referrerId?: string; radiologistUserId?: string;
  procedureCodes: string[]; icd10: string[]; critical?: boolean; signedAt?: string; procedures?: Array<{ code?: string; description?: string; modality?: string; bodyPart?: string; contrast?: boolean }>; modality?: string; orderId?: string; serviceDate?: string;
}

export interface CodingProposal {
  procedureCodes: string[];
  icd10: string[];
  confidence: number;
  evidence: string[];
  mappings: Array<{ input: string; code: string; confidence: number; basis: string }>;
}

/** Deterministic coding proposal from the event's procedure codes and ICD-10 (Class 2 candidate, never auto-published). */
export function proposeCoding(input: { procedureCodes: string[]; icd10: string[]; procedures?: ReportSignedPayload['procedures']; modality?: string }): CodingProposal {
  const evidence: string[] = [];
  const mappings: CodingProposal['mappings'] = [];
  const codes: string[] = [];
  type Src = { code?: string; description?: string; modality?: string; bodyPart?: string; contrast?: boolean };
  const sources: Src[] = input.procedures?.length ? input.procedures : input.procedureCodes.map((c) => ({ code: c, modality: input.modality }));
  for (const p of sources) {
    const m = mapProcedureToTariff({ code: p.code, description: p.description, modality: p.modality ?? input.modality, bodyPart: p.bodyPart, contrast: p.contrast });
    if (m) {
      codes.push(m.code);
      mappings.push({ input: p.code ?? p.description ?? '?', code: m.code, confidence: m.confidence, basis: m.basis });
      evidence.push(`${p.code ?? p.description}: ${m.basis} → ${m.code} ${TARIFF_BY_CODE[m.code]?.description}`);
    } else {
      mappings.push({ input: p.code ?? p.description ?? '?', code: '', confidence: 0, basis: 'no mapping' });
      evidence.push(`${p.code ?? p.description}: no tariff mapping`);
    }
  }
  let confidence = mappings.length ? Math.min(...mappings.map((m) => m.confidence)) : 0;
  let icd10 = [...input.icd10];
  if (!icd10.length) {
    icd10 = ['Z01.6'];
    confidence = Math.min(confidence, 0.55);
    evidence.push('No ICD-10 on order or report; proposed Z01.6 (radiological examination) as a suggested code, A1');
  } else evidence.push(`ICD-10 from signed report: ${icd10.join(', ')}`);
  if (!codes.length) confidence = 0;
  return { procedureCodes: [...new Set(codes)], icd10, confidence: Math.round(confidence * 100) / 100, evidence, mappings };
}

export interface ChargeContext {
  patient: typeof schema.patients.$inferSelect;
  practice: typeof schema.legalEntities.$inferSelect | undefined;
  site: typeof schema.sites.$inferSelect | undefined;
  referrer: typeof schema.referrers.$inferSelect | undefined;
  radiologist: typeof schema.users.$inferSelect | undefined;
}
export async function chargeContext(db: Db, c: { patientId: string; practiceId: string; siteId?: string | null; referrerId?: string | null; radiologistUserId?: string | null }): Promise<ChargeContext | null> {
  const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, c.patientId)).limit(1);
  if (!patient) return null;
  const [practice] = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.id, c.practiceId)).limit(1);
  const [site] = c.siteId ? await db.select().from(schema.sites).where(eq(schema.sites.id, c.siteId)).limit(1) : [];
  const [referrer] = c.referrerId ? await db.select().from(schema.referrers).where(eq(schema.referrers.id, c.referrerId)).limit(1) : [];
  const [radiologist] = c.radiologistUserId ? await db.select().from(schema.users).where(eq(schema.users.id, c.radiologistUserId)).limit(1) : [];
  return { patient, practice, site, referrer, radiologist };
}

export function funderIdForPatient(p: { schemeId?: string | null }): string {
  return p.schemeId && ['scheme-a', 'scheme-b', 'scheme-c'].includes(p.schemeId) ? p.schemeId : 'cash';
}

export function claimFieldsFor(ctx: ChargeContext, charge: { serviceDate: string; authRef?: string | null; memberNo?: string | null; dependantCode?: string | null; funderId: string }, extra: Record<string, string | null | undefined> = {}): Record<string, string | null | undefined> {
  return {
    practiceNo: ctx.practice?.bhfPracticeNo ?? null,
    treatingProviderNo: ctx.radiologist?.hpcsaNo ?? 'MP 0456789',
    referrerNo: ctx.referrer?.bhfPracticeNo ?? null,
    memberNo: charge.memberNo ?? ctx.patient.memberNo ?? null,
    dependantCode: charge.dependantCode ?? ctx.patient.dependantCode ?? null,
    serviceDate: charge.serviceDate,
    siteCode: ctx.site?.code ?? null,
    patientDob: ctx.patient.dateOfBirth ?? null,
    authRef: charge.authRef ?? null,
    ...extra,
  };
}

export async function priceForCharge(db: Db, practiceId: string, funderId: string, serviceDate: string, procedureCodes: string[], pmb = false): Promise<{ priced: PricedCharge; pack: RulePack; schedule: FeeSchedule }> {
  const schedule = await scheduleFor(db, practiceId, funderId, serviceDate);
  const pack = rulePackInForce(funderId, serviceDate);
  const priced = priceCharge({ procedures: procedureCodes.map((code) => ({ code })), funderType: funderTypeOf(funderId), pmb }, schedule, pack.pricing);
  return { priced, pack, schedule };
}

export async function priorClaimsFor(db: Db, patientId: string, excludeChargeId?: string) {
  const rows = await db.select().from(schema.claims).where(eq(schema.claims.patientId, patientId));
  return rows.filter((r) => r.chargeId !== excludeChargeId).map((r) => ({ serviceDate: r.serviceDate, codes: (r.lines as Array<{ code: string }>).map((l) => l.code), status: r.status }));
}

export async function scrubCharge(db: Db, charge: ChargeRow, ctx: ChargeContext, extraFields: Record<string, string | null | undefined> = {}): Promise<{ scrub: ScrubResult; pack: RulePack; fields: Record<string, string | null | undefined> }> {
  const pack = rulePackInForce(charge.funderId, charge.serviceDate);
  const fields = claimFieldsFor(ctx, charge, extraFields);
  const claim: ClaimForScrub = {
    funderId: charge.funderId, serviceDate: charge.serviceDate, fields, lines: (charge.lines as Array<{ code: string; quantity: number }>).map((l) => ({ code: l.code, quantity: l.quantity })),
    icd10: charge.icd10, patient: { sex: ctx.patient.sex, dateOfBirth: ctx.patient.dateOfBirth }, priorClaims: await priorClaimsFor(db, charge.patientId, charge.id), today: today(),
  };
  return { scrub: scrubClaim(claim, pack), pack, fields };
}

/** Create (idempotently, by reportId) the charge for a signed report. Returns the charge row and whether it was new. */
export async function captureCharge(services: Services, evt: ReportSignedPayload): Promise<{ charge: ChargeRow; created: boolean; proposal: CodingProposal } | null> {
  const db = services.db;
  if (evt.reportId) {
    const [existing] = await db.select().from(schema.charges).where(eq(schema.charges.reportId, evt.reportId)).limit(1);
    if (existing) return { charge: existing, created: false, proposal: proposeCoding({ procedureCodes: existing.procedureCodes, icd10: existing.icd10 }) };
  }
  const ctx = await chargeContext(db, evt);
  if (!ctx) return null;
  const funderId = funderIdForPatient(ctx.patient);
  const serviceDate = (evt.serviceDate ?? evt.signedAt ?? nowIso()).slice(0, 10);
  const proposal = proposeCoding({ procedureCodes: evt.procedureCodes, icd10: evt.icd10, procedures: evt.procedures, modality: evt.modality });
  const codes = proposal.procedureCodes.length ? proposal.procedureCodes : ['30110'];
  const { priced, schedule } = await priceForCharge(db, evt.practiceId, funderId, serviceDate, codes);
  const id = newId('chg');
  const modality = evt.modality ?? TARIFF_BY_CODE[codes[0]!]?.modality ?? null;
  await db.insert(schema.charges).values({
    id, practiceId: evt.practiceId, siteId: evt.siteId ?? null, patientId: evt.patientId, studyId: evt.studyId ?? null, reportId: evt.reportId ?? null, orderId: evt.orderId ?? null, accession: evt.accession ?? null,
    serviceDate, modality, procedureCodes: codes, icd10: proposal.icd10, funderId, funderType: funderTypeOf(funderId), memberNo: ctx.patient.memberNo, dependantCode: ctx.patient.dependantCode,
    referrerId: evt.referrerId ?? null, radiologistUserId: evt.radiologistUserId ?? null, lines: priced.lines as unknown as Array<Record<string, unknown>>,
    subtotalExclCents: priced.subtotalExclCents, vatCents: priced.vatCents, totalCents: priced.totalCents, expectedFunderCents: priced.expectedFunderCents, expectedPatientCents: priced.expectedPatientCents,
    patientPortionReason: priced.patientPortionReason, scheduleId: schedule.id, status: 'unbilled', blockingReason: 'awaiting_coding', owner: 'coding-hand',
  });
  const [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, id)).limit(1);
  await emitDirect(services, 'charge.captured.v1', { chargeId: id, practiceId: evt.practiceId, siteId: evt.siteId ?? null, patientId: evt.patientId, modality, funderId, funderType: funderTypeOf(funderId), subtotalExclCents: priced.subtotalExclCents, vatCents: priced.vatCents, totalCents: priced.totalCents, serviceDate }, { aggregateType: 'charge', aggregateId: id, practiceId: evt.practiceId });
  return { charge: charge!, created: true, proposal };
}

/** Re-price and re-scrub a charge after codes, ICD-10 or claim fields change (human edit or auto-fix). */
export async function repriceCharge(db: Db, charge: ChargeRow, patch: { procedureCodes?: string[]; icd10?: string[]; authRef?: string | null; memberNo?: string | null; referrerId?: string | null }): Promise<ChargeRow> {
  const codes = patch.procedureCodes ?? charge.procedureCodes;
  const { priced, schedule } = await priceForCharge(db, charge.practiceId, charge.funderId, charge.serviceDate, codes);
  await db.update(schema.charges).set({
    procedureCodes: codes, icd10: patch.icd10 ?? charge.icd10, authRef: patch.authRef === undefined ? charge.authRef : patch.authRef, memberNo: patch.memberNo === undefined ? charge.memberNo : patch.memberNo,
    referrerId: patch.referrerId === undefined ? charge.referrerId : patch.referrerId, lines: priced.lines as unknown as Array<Record<string, unknown>>, subtotalExclCents: priced.subtotalExclCents, vatCents: priced.vatCents, totalCents: priced.totalCents,
    expectedFunderCents: priced.expectedFunderCents, expectedPatientCents: priced.expectedPatientCents, patientPortionReason: priced.patientPortionReason, scheduleId: schedule.id, version: charge.version + 1, updatedAt: nowIso(),
  }).where(eq(schema.charges.id, charge.id));
  const [row] = await db.select().from(schema.charges).where(eq(schema.charges.id, charge.id)).limit(1);
  return row!;
}

/* ---------- Claim assembly ---------- */
export async function nextClaimRef(services: Services, practiceId: string): Promise<string> {
  const seq = await nextSequence(services, `claim:${practiceId}`);
  return `${PRACTICE_LETTER[practiceId] ?? 'X'}-${String(18000 + seq).padStart(6, '0')}`;
}

/** Build a claim (status scrubbed) from a ready charge. Idempotent per charge unless a resubmission is requested. */
export async function assembleClaim(services: Services, charge: ChargeRow, ctx: ChargeContext, scrub: ScrubResult, fields: Record<string, string | null | undefined>, submittedBy: string): Promise<ClaimRow> {
  const db = services.db;
  if (charge.claimId) {
    const [existing] = await db.select().from(schema.claims).where(eq(schema.claims.id, charge.claimId)).limit(1);
    if (existing && !['reversed', 'written_off'].includes(existing.status)) return existing;
  }
  const id = newId('clm');
  const claimRef = await nextClaimRef(services, charge.practiceId);
  const pack = rulePackInForce(charge.funderId, charge.serviceDate);
  const pmb = charge.icd10.some((c) => pack.pmbCodes.some((p) => c.toUpperCase().startsWith(p)));
  await db.insert(schema.claims).values({
    id, practiceId: charge.practiceId, claimRef, chargeId: charge.id, patientId: charge.patientId, siteId: charge.siteId, funderId: charge.funderId, funderType: charge.funderType, memberNo: fields.memberNo ?? charge.memberNo,
    dependantCode: fields.dependantCode ?? charge.dependantCode, icd10: charge.icd10, lines: charge.lines, fields, totalCents: charge.totalCents, expectedFunderCents: charge.expectedFunderCents, expectedPatientCents: charge.expectedPatientCents,
    status: 'scrubbed', channel: REALTIME_FUNDERS.has(charge.funderId) && pack.realtime ? 'realtime' : charge.funderType === 'scheme' ? 'batch' : charge.funderType === 'cash' ? 'batch' : 'portal', serviceDate: charge.serviceDate, staleDate: scrub.staleDate,
    scrub: scrub as unknown as Record<string, unknown>, rulePackVersion: scrub.rulePackVersion, pmb, submittedBy,
  });
  await db.update(schema.charges).set({ claimId: id, status: 'ready', blockingReason: null, owner: null, updatedAt: nowIso() }).where(eq(schema.charges.id, charge.id));
  const [row] = await db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  await emitDirect(services, 'claim.assembled.v1', { claimId: id, claimRef, practiceId: charge.practiceId, chargeId: charge.id, funderId: charge.funderId, totalCents: charge.totalCents }, { aggregateType: 'claim', aggregateId: id, practiceId: charge.practiceId });
  return row!;
}

/* ---------- Submission and responses ---------- */
export interface SwitchResponse {
  outcome: 'acknowledged' | 'accepted' | 'rejected' | 'pended';
  code?: string; // funder response code, e.g. 4231
  message?: string;
  rule?: string;
  switchRef: string;
  adjudicatedFunderCents?: number;
  patientLiabilityCents?: number;
  channel: 'realtime' | 'batch';
}

export async function markSubmitted(services: Services, claim: ClaimRow, res: SwitchResponse, submittedBy: string, batchId?: string) {
  const db = services.db;
  const at = nowIso();
  await db.update(schema.claims).set({ status: 'submitted', submittedAt: claim.submittedAt ?? at, switchRef: res.switchRef, batchId: batchId ?? claim.batchId, submittedBy, channel: res.channel, exception: null, updatedAt: at }).where(eq(schema.claims.id, claim.id));
  await db.update(schema.charges).set({ status: 'claimed', updatedAt: at }).where(eq(schema.charges.id, claim.chargeId));
  await db.insert(schema.claimResponses).values({ id: newId('rsp'), practiceId: claim.practiceId, claimId: claim.id, channel: res.channel, receivedAt: at, outcome: 'acknowledged', switchRef: res.switchRef, message: 'Technical acknowledgement', payload: { batchId } });
  await emitDirect(services, 'claim.submitted.v1', { claimId: claim.id, claimRef: claim.claimRef, practiceId: claim.practiceId, patientId: claim.patientId, funderId: claim.funderId, totalCents: claim.totalCents, channel: res.channel }, { aggregateType: 'claim', aggregateId: claim.id, practiceId: claim.practiceId });
}

/** Apply an adjudication response (real-time or batch). Maps reason codes to the taxonomy and opens exceptions. */
export async function applyClaimResponse(services: Services, claimId: string, res: SwitchResponse): Promise<ClaimRow> {
  const db = services.db;
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
  if (!claim) throw new Error('claim not found');
  const at = nowIso();
  await db.insert(schema.claimResponses).values({ id: newId('rsp'), practiceId: claim.practiceId, claimId, channel: res.channel, receivedAt: at, outcome: res.outcome, code: res.code ?? null, message: res.message ?? null, rule: res.rule ?? null, switchRef: res.switchRef, paidCents: res.adjudicatedFunderCents ?? null, payload: res as unknown as Record<string, unknown> });
  const patch: Partial<typeof schema.claims.$inferInsert> = { respondedAt: at, updatedAt: at, responseCodes: [...(claim.responseCodes ?? []), res.code ?? res.outcome] };
  if (res.outcome === 'accepted') {
    patch.status = 'accepted';
    patch.exception = null;
    if (res.adjudicatedFunderCents !== undefined) patch.expectedFunderCents = res.adjudicatedFunderCents;
    if (res.patientLiabilityCents !== undefined) patch.expectedPatientCents = res.patientLiabilityCents;
  } else if (res.outcome === 'pended') {
    patch.status = 'pended';
    patch.exception = { family: 'Funder rule', reason: res.message ?? 'Pended by funder', code: res.code ?? 'PENDED', suggestion: 'Claims Hand issues a status enquiry after the expected adjudication time', path: 'manual', level: 'A3', openedAt: at };
  } else if (res.outcome === 'rejected') {
    const { reason, mapping } = classifyFunderCode(res.code ?? 'TECHNICAL');
    patch.status = 'rejected';
    patch.rejectionCode = reason;
    patch.rejectionClass = mapping.class;
    patch.rejectionReason = res.message ?? mapping.label;
    patch.exception = { family: mapping.exceptionFamily, reason: res.message ?? mapping.label, code: reason, suggestion: suggestionFor(reason, claim), path: mapping.path, level: mapping.level, openedAt: at, provenance: { ...CODING_MODEL, confidence: reason === 'AUTH_REQ' ? 0.93 : reason === 'ICD_INVALID' ? 0.88 : 0.8, outputClass: 2, demo: true } };
    await db.update(schema.charges).set({ status: 'rejected', updatedAt: at }).where(eq(schema.charges.id, claim.chargeId));
  }
  await db.update(schema.claims).set(patch).where(eq(schema.claims.id, claimId));
  await emitDirect(services, 'claim.responded.v1', { claimId, claimRef: claim.claimRef, practiceId: claim.practiceId, funderId: claim.funderId, status: patch.status ?? claim.status, paidCents: res.adjudicatedFunderCents ?? 0, reasonCode: patch.rejectionCode ?? undefined, code: res.code, totalCents: claim.totalCents, codes: (claim.lines as Array<{ code: string }>).map((l) => l.code) }, { aggregateType: 'claim', aggregateId: claimId, practiceId: claim.practiceId });
  if (res.outcome === 'rejected') await detectRejectionWave(services, claim.practiceId, claim.funderId, patch.rejectionCode as string, claim);
  const [row] = await db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
  return row!;
}

function suggestionFor(reason: ReasonCode, claim: ClaimRow): string {
  const codes = (claim.lines as Array<{ code: string }>).map((l) => l.code).filter((c) => TARIFF_BY_CODE[c]?.kind === 'procedure');
  switch (reason) {
    case 'AUTH_REQ': return `Attach a retrospective authorisation for ${codes.join(', ')} (Authorisation Hand, M06) and resubmit in the next batch. ICD-10 ${claim.icd10[0] ?? ''} remains valid as primary.`;
    case 'ICD_INVALID': return `Primary ICD-10 ${claim.icd10[0] ?? ''} is a symptom code; replace with the diagnosis the signed report supports, then resubmit.`;
    case 'MEMBER_NOT_FOUND': return 'Re-verify membership; confirm the member number with the patient by WhatsApp before resubmitting.';
    case 'BENEFIT_EXHAUSTED': return `Benefit check at booking said available; convert R ${(claim.expectedFunderCents / 100).toFixed(2)} to patient liability needs your decision.`;
    default: return classifyFunderCode(reason).mapping.suggestion;
  }
}

/** Cluster rejections: same funder + reason within 14 days, ≥ 3 claims → open a wave and pause the Claims Hand rule for that family. */
export async function detectRejectionWave(services: Services, practiceId: string, funderId: string, reasonCode: string, claim: ClaimRow) {
  const db = services.db;
  const since = addDays(today(), -14);
  const rejected = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), eq(schema.claims.funderId, funderId), eq(schema.claims.rejectionCode, reasonCode), eq(schema.claims.status, 'rejected'), gte(schema.claims.respondedAt, since)));
  if (rejected.length < 3) return null;
  const codes = [...new Set(rejected.flatMap((r) => (r.lines as Array<{ code: string }>).map((l) => l.code)).filter((c) => TARIFF_BY_CODE[c]?.kind === 'procedure'))];
  const atRisk = rejected.reduce((a, r) => a + r.totalCents, 0);
  const [open] = await db.select().from(schema.rejectionWaves).where(and(eq(schema.rejectionWaves.practiceId, practiceId), eq(schema.rejectionWaves.funderId, funderId), eq(schema.rejectionWaves.reasonCode, reasonCode), eq(schema.rejectionWaves.status, 'open'))).limit(1);
  if (open) {
    await db.update(schema.rejectionWaves).set({ claimCount: rejected.length, atRiskCents: atRisk, codes }).where(eq(schema.rejectionWaves.id, open.id));
    return open;
  }
  const id = newId('wave');
  const pack = rulePackInForce(funderId, claim.serviceDate);
  await db.insert(schema.rejectionWaves).values({
    id, practiceId, funderId, reasonCode, codes, startedAt: rejected.map((r) => r.respondedAt!).sort()[0] ?? nowIso(), claimCount: rejected.length, atRiskCents: atRisk, status: 'open', pausedRule: `R21:${funderId}:${reasonCode}`,
    probableCause: `${FUNDER_NAMES[funderId] ?? funderId} rule change: ${rejected.length} claims rejected with ${reasonCode} since ${since}. Rule pack ${pack.version} in force; ${reasonCode === 'AUTH_REQ' ? 'circular requires an authorisation number on these tariffs' : 'funder edit not in the rule pack'}.`,
    rulePackVersion: pack.version,
  });
  await emitDirect(services, 'claims.rejection_spike.v1', { waveId: id, practiceId, funderId, reasonCode, claimCount: rejected.length, atRiskCents: atRisk, codes }, { aggregateType: 'rejection_wave', aggregateId: id, practiceId });
  return (await db.select().from(schema.rejectionWaves).where(eq(schema.rejectionWaves.id, id)))[0] ?? null;
}

export async function openWaves(db: Db, practiceId: string) {
  return db.select().from(schema.rejectionWaves).where(and(eq(schema.rejectionWaves.practiceId, practiceId), eq(schema.rejectionWaves.status, 'open')));
}
export function claimHitsWave(claim: { funderId: string; lines: unknown; fields: Record<string, string | null | undefined> }, waves: Array<{ funderId: string; codes: string[]; reasonCode: string }>): { funderId: string; codes: string[]; reasonCode: string } | null {
  const codes = (claim.lines as Array<{ code: string }>).map((l) => l.code);
  for (const w of waves) {
    if (w.funderId !== claim.funderId) continue;
    if (!w.codes.some((c) => codes.includes(c))) continue;
    if (w.reasonCode === 'AUTH_REQ' && claim.fields.authRef) continue; // fixed claims may go
    return w;
  }
  return null;
}

/* ---------- Remittance matching and patient liability ---------- */
export function shortPaymentClassFor(code: string | null | undefined): ShortPaymentClass {
  switch (code) {
    case '4303': case 'RATE_DIFFERENCE': return 'rate_difference';
    case '4301': case 'BENEFIT_EXHAUSTED': return 'benefit_exhausted';
    case '4302': case 'NOT_COVERED': return 'not_covered';
    case '4310': case 'PMB_DISPUTE': return 'pmb_dispute';
    case 'CO_PAYMENT': case 'co_payment': return 'co_payment';
    case 'TARIFF_ADJUSTMENT': return 'tariff_adjustment';
    case 'AUTH_PENALTY': return 'auth_penalty';
    case 'LEVY': return 'levy';
    case '4401': return 'duplicate';
    default: return 'unknown';
  }
}

export interface MatchOutcome { matched: number; short: number; unmatched: number; overPaid: number; liabilities: number }

/** Match ERA lines to claims, post allocations, route short-payments. Called by the Remittance Hand. */
export async function matchRemittance(services: Services, remittanceId: string, opts: { toleranceCents: number; post: (claimId: string, patch: Record<string, unknown>) => Promise<void>; transfer: (claim: ClaimRow, cents: number, reason: string, cls: ShortPaymentClass) => Promise<void> }): Promise<MatchOutcome> {
  const db = services.db;
  const [rem] = await db.select().from(schema.remittances).where(eq(schema.remittances.id, remittanceId)).limit(1);
  if (!rem) throw new Error('remittance not found');
  const outcome: MatchOutcome = { matched: 0, short: 0, unmatched: 0, overPaid: 0, liabilities: 0 };
  const lines = [...rem.lines];
  let matchedCents = 0, unmatchedCents = 0, shortCents = 0;
  for (const line of lines) {
    let [claim] = line.claimId ? await db.select().from(schema.claims).where(eq(schema.claims.id, line.claimId)).limit(1) : await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, rem.practiceId), eq(schema.claims.claimRef, line.claimRef))).limit(1);
    let confidence = claim ? 1 : 0;
    if (!claim) {
      // fallback: funder + amount within tolerance among submitted/accepted claims
      const cands = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, rem.practiceId), eq(schema.claims.funderId, rem.funderId), inArray(schema.claims.status, ['submitted', 'accepted', 'pended'])));
      const best = cands.find((c) => Math.abs(c.expectedFunderCents - line.expectedCents) <= opts.toleranceCents);
      if (best) { claim = best; confidence = 0.9; }
    }
    if (!claim || ['paid', 'reversed'].includes(claim.status)) {
      line.status = 'unmatched';
      line.matchConfidence = 0;
      unmatchedCents += line.paidCents;
      outcome.unmatched++;
      continue;
    }
    line.claimId = claim.id;
    line.matchConfidence = confidence;
    const expected = claim.expectedFunderCents;
    const diff = expected - line.paidCents;
    if (line.status === 'paid_to_member') {
      line.shortPaymentClass = 'not_covered';
      line.route = 'patient_liability';
      await opts.post(claim.id, { status: 'short_paid', paidCents: 0 });
      await opts.transfer(claim, expected, 'Scheme paid the member directly; balance is owed by the patient', 'not_covered');
      outcome.liabilities++;
      outcome.short++;
      shortCents += expected;
      continue;
    }
    if (Math.abs(diff) <= opts.toleranceCents) {
      line.status = 'matched';
      matchedCents += line.paidCents;
      outcome.matched++;
      await opts.post(claim.id, { status: 'paid', paidCents: line.paidCents });
      if (claim.expectedPatientCents > 0 && !(await hasLiability(db, claim.id))) {
        await opts.transfer(claim, claim.expectedPatientCents, 'Network co-payment per the scheme option', 'co_payment');
        outcome.liabilities++;
      }
    } else if (diff > 0) {
      line.status = 'short_paid';
      const cls = shortPaymentClassFor(line.reasonCode);
      line.shortPaymentClass = cls;
      const route = routeShortPayment(cls, true);
      line.route = route;
      matchedCents += line.paidCents;
      shortCents += diff;
      outcome.short++;
      await opts.post(claim.id, { status: 'short_paid', paidCents: line.paidCents });
      await emitDirect(services, 'claim.short_paid.v1', { claimId: claim.id, practiceId: claim.practiceId, funderId: claim.funderId, shortCents: diff, shortPaymentClass: cls, route }, { aggregateType: 'claim', aggregateId: claim.id, practiceId: claim.practiceId });
      if (route === 'patient_liability') {
        await opts.transfer(claim, diff + claim.expectedPatientCents, shortPaymentReasonText(cls), cls);
        outcome.liabilities++;
      }
    } else {
      line.status = 'over_paid';
      matchedCents += expected;
      unmatchedCents += -diff;
      outcome.overPaid++;
      await opts.post(claim.id, { status: 'paid', paidCents: line.paidCents });
    }
  }
  const status = outcome.unmatched === 0 && outcome.overPaid === 0 ? 'matched' : 'partially_matched';
  await db.update(schema.remittances).set({ lines, matchedCents, unmatchedCents, shortCents, status }).where(eq(schema.remittances.id, remittanceId));
  await emitDirect(services, 'remittance.matched.v1', { remittanceId, practiceId: rem.practiceId, funderId: rem.funderId, matchedCents, unmatchedCents, shortCents }, { aggregateType: 'remittance', aggregateId: remittanceId, practiceId: rem.practiceId });
  await emitDirect(services, 'payment.received.v1', { remittanceId, practiceId: rem.practiceId, funderId: rem.funderId, funderType: 'scheme', amountCents: matchedCents, method: 'remittance' }, { aggregateType: 'remittance', aggregateId: remittanceId, practiceId: rem.practiceId });
  return outcome;
}
async function hasLiability(db: Db, claimId: string) {
  const rows = await db.select({ id: schema.accountTransactions.id }).from(schema.accountTransactions).where(and(eq(schema.accountTransactions.refType, 'claim'), eq(schema.accountTransactions.refId, claimId), eq(schema.accountTransactions.type, 'transfer'))).limit(1);
  return rows.length > 0;
}
export function shortPaymentReasonText(cls: ShortPaymentClass): string {
  return ({ co_payment: 'Network co-payment per the scheme option', benefit_exhausted: 'Scheme benefit for the year is exhausted', not_covered: 'Scheme does not cover this service', rate_difference: 'Scheme paid at scheme rate; provider rate is above scheme rate', pmb_dispute: 'Scheme disputes the PMB status', tariff_adjustment: 'Tariff adjustment', duplicate: 'Scheme sees a duplicate', auth_penalty: 'Authorisation penalty', levy: 'Scheme levy', unknown: 'Short-payment reason not mapped' } as Record<ShortPaymentClass, string>)[cls];
}

/* ---------- Patient accounts and ledger ---------- */
export async function ensureAccount(services: Services, practiceId: string, patientId: string, debtorClass = 'patient'): Promise<AccountRow> {
  const db = services.db;
  const [existing] = await db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, practiceId), eq(schema.patientAccounts.patientId, patientId), eq(schema.patientAccounts.debtorClass, debtorClass))).limit(1);
  if (existing) return existing;
  const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, patientId)).limit(1);
  const seq = await nextSequence(services, `account:${practiceId}`);
  const id = newId('acc');
  const consent = p?.consents ?? {};
  const channels = ['whatsapp', 'sms', 'email'].filter((ch) => (consent as Record<string, { granted: boolean }>)[ch === 'whatsapp' ? 'popia' : 'reminders']?.granted !== false);
  await db.insert(schema.patientAccounts).values({
    id, practiceId, patientId, accountNo: `ACC-${PRACTICE_LETTER[practiceId] ?? 'X'}-${String(204000 + seq)}`, debtorClass, debtorName: p ? `${p.lastName}, ${p.firstName}` : patientId, balanceCents: 0, flags: p?.status === 'deceased' ? ['deceased'] : [],
    consentChannels: channels, language: p?.language ?? 'en', delivered: [], status: 'open',
  });
  const [row] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, id)).limit(1);
  return row!;
}

export async function postTransaction(services: Services, account: AccountRow, tx: { type: string; amountCents: number; description: string; reason?: string | null; refType?: string | null; refId?: string | null; arithmetic?: Record<string, unknown>; at?: string; startAgeing?: boolean }): Promise<AccountRow> {
  const db = services.db;
  const at = tx.at ?? nowIso();
  await db.insert(schema.accountTransactions).values({ id: newId('txn'), practiceId: account.practiceId, accountId: account.id, patientId: account.patientId, type: tx.type, amountCents: tx.amountCents, refType: tx.refType ?? null, refId: tx.refId ?? null, description: tx.description, reason: tx.reason ?? null, arithmetic: tx.arithmetic ?? null, at });
  const balance = account.balanceCents + tx.amountCents;
  const patch: Partial<typeof schema.patientAccounts.$inferInsert> = { balanceCents: balance, updatedAt: at };
  if (tx.startAgeing || (!account.ageingStartAt && tx.amountCents > 0)) { patch.ageingStartAt = at; patch.dueDate = at.slice(0, 10); }
  if (balance <= 0 && account.status === 'open') patch.status = 'settled';
  if (balance > 0 && account.status === 'settled') { patch.status = 'open'; patch.ageingStartAt = at; }
  await db.update(schema.patientAccounts).set(patch).where(eq(schema.patientAccounts.id, account.id));
  const [row] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, account.id)).limit(1);
  return row!;
}

/** Transfer liability to the patient with the arithmetic explained; ageing starts at notification (now). */
export async function transferPatientLiability(services: Services, claim: ClaimRow, amountCents: number, reason: string, cls: ShortPaymentClass | 'cash' | 'co_payment'): Promise<AccountRow> {
  const account = await ensureAccount(services, claim.practiceId, claim.patientId);
  const lines = claim.lines as Array<{ code: string; description: string; quantity: number; inclCents: number }>;
  const arithmetic = { lines: lines.map((l) => ({ code: l.code, description: l.description, quantity: l.quantity, inclCents: l.inclCents })), totalCents: claim.totalCents, schemePaidCents: claim.paidCents, adjustmentsCents: claim.totalCents - claim.paidCents - amountCents, patientOwesCents: amountCents, reason };
  const updated = await postTransaction(services, account, { type: 'transfer', amountCents, description: `Patient liability: ${reason}`, reason: cls, refType: 'claim', refId: claim.id, arithmetic, startAgeing: true });
  await services.db.update(schema.patientAccounts).set({ liabilityReason: cls === 'cash' ? 'cash' : cls === 'co_payment' ? 'co_payment' : cls === 'rate_difference' ? 'rate_difference' : cls === 'benefit_exhausted' ? 'benefit_exhausted' : cls === 'not_covered' ? 'not_covered' : 'other' }).where(eq(schema.patientAccounts.id, account.id));
  await emitDirect(services, 'patient.liability.v1', { patientId: claim.patientId, practiceId: claim.practiceId, accountId: account.id, amountCents, reason, claimId: claim.id }, { aggregateType: 'account', aggregateId: account.id, practiceId: claim.practiceId });
  return updated;
}

/** Record a payment (desk or link) and allocate it to the account. */
export async function recordPayment(services: Services, input: { practiceId: string; accountId?: string | null; patientId?: string | null; siteId?: string | null; method: string; amountCents: number; reference?: string | null; takenBy?: string | null; linkToken?: string | null; pspRef?: string | null; settle?: boolean }): Promise<{ payment: typeof schema.payments.$inferSelect; account: AccountRow | null }> {
  const db = services.db;
  let account: AccountRow | null = null;
  if (input.accountId) [account = null] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, input.accountId)).limit(1);
  else if (input.patientId) account = await ensureAccount(services, input.practiceId, input.patientId);
  const seq = await nextSequence(services, `receipt:${input.practiceId}`);
  const id = newId('pay');
  const at = nowIso();
  const settle = input.settle ?? input.method !== 'eft';
  await db.insert(schema.payments).values({
    id, practiceId: input.practiceId, accountId: account?.id ?? null, patientId: account?.patientId ?? input.patientId ?? null, siteId: input.siteId ?? null, method: input.method, amountCents: input.amountCents,
    status: settle ? 'settled' : 'pending', reference: input.reference ?? `PAY-${PRACTICE_LETTER[input.practiceId] ?? 'X'}-${String(seq).padStart(6, '0')}`, receiptNo: `RCT-${PRACTICE_LETTER[input.practiceId] ?? 'X'}-${String(seq).padStart(6, '0')}`,
    linkToken: input.linkToken ?? null, takenBy: input.takenBy ?? null, pspRef: input.pspRef ?? null, settledAt: settle ? at : null, at,
  });
  if (account && settle) {
    account = await postTransaction(services, account, { type: 'payment', amountCents: -input.amountCents, description: `Payment received (${input.method})`, refType: 'payment', refId: id, at });
    await emitDirect(services, 'payment.received.v1', { paymentId: id, practiceId: input.practiceId, patientId: account.patientId, accountId: account.id, amountCents: input.amountCents, method: input.method, funderType: 'cash' }, { aggregateType: 'payment', aggregateId: id, practiceId: input.practiceId });
  }
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, id)).limit(1);
  return { payment: payment!, account };
}

export async function settlePendingPayment(services: Services, paymentId: string, pspRef: string) {
  const db = services.db;
  const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
  if (!p || p.status !== 'pending') return p ?? null;
  const at = nowIso();
  await db.update(schema.payments).set({ status: 'settled', settledAt: at, pspRef }).where(eq(schema.payments.id, paymentId));
  if (p.accountId) {
    const [acc] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, p.accountId)).limit(1);
    if (acc) await postTransaction(services, acc, { type: 'payment', amountCents: -p.amountCents, description: `Payment received (${p.method})`, refType: 'payment', refId: p.id, at });
    await emitDirect(services, 'payment.received.v1', { paymentId: p.id, practiceId: p.practiceId, patientId: p.patientId, accountId: p.accountId, amountCents: p.amountCents, method: p.method, funderType: 'cash' }, { aggregateType: 'payment', aggregateId: p.id, practiceId: p.practiceId });
  }
  const [row] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
  return row ?? null;
}

/** Single-use, expiring payment link (a real PSP hosted page, once one is connected — see kernel/ports.ts). */
export async function createPaymentLink(services: Services, input: { practiceId: string; accountId?: string | null; patientId?: string | null; amountCents: number; channel?: string; createdBy?: string | null }) {
  const account = input.accountId ? (await services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, input.accountId)).limit(1))[0] ?? null : input.patientId ? await ensureAccount(services, input.practiceId, input.patientId) : null;
  const token = (await sha256Hex(newId('lnk') + Math.random())).slice(0, 24);
  const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
  const id = newId('pay');
  const seq = await nextSequence(services, `receipt:${input.practiceId}`);
  await services.db.insert(schema.payments).values({ id, practiceId: input.practiceId, accountId: account?.id ?? null, patientId: account?.patientId ?? input.patientId ?? null, method: 'link', amountCents: input.amountCents, status: 'pending', reference: `LNK-${PRACTICE_LETTER[input.practiceId] ?? 'X'}-${String(seq).padStart(6, '0')}`, receiptNo: `RCT-${PRACTICE_LETTER[input.practiceId] ?? 'X'}-${String(seq).padStart(6, '0')}`, linkToken: token, linkExpiresAt: expiresAt, takenBy: input.createdBy ?? null, at: nowIso() });
  const { url } = await services.paymentGateway.createLink({ paymentId: id, token, amountCents: input.amountCents, expiresAt });
  await emitDirect(services, 'payment.link.created.v1', { paymentId: id, practiceId: input.practiceId, accountId: account?.id ?? null, amountCents: input.amountCents, channel: input.channel ?? 'whatsapp', expiresAt }, { aggregateType: 'payment', aggregateId: id, practiceId: input.practiceId });
  return { id, token, url, expiresAt, amountCents: input.amountCents, accountId: account?.id ?? null };
}

/* ---------- Ageing, propensity, register ---------- */
export async function ageingForPractice(db: Db, practiceId: string, asOf = today()) {
  const accounts = await db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, practiceId), eq(schema.patientAccounts.status, 'open')));
  const plans = await db.select().from(schema.paymentPlans).where(and(eq(schema.paymentPlans.practiceId, practiceId), eq(schema.paymentPlans.status, 'active')));
  const inFlight = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), inArray(schema.claims.status, ['submitted', 'accepted', 'pended'])));
  const balances: AgeableBalance[] = [
    ...accounts.filter((a) => a.balanceCents > 0).map((a) => ({ debtorClass: a.debtorClass as AgeableBalance['debtorClass'], balanceCents: a.balanceCents, ageingStartAt: a.ageingStartAt ?? a.createdAt, planOnSchedule: plans.some((p) => p.accountId === a.id) })),
    ...inFlight.map((c) => ({ debtorClass: 'scheme' as const, balanceCents: c.expectedFunderCents - c.paidCents, ageingStartAt: c.submittedAt ?? c.createdAt })),
  ];
  const matrix = ageBalances(balances, asOf);
  const provision = eclProvision(matrix);
  return { matrix, provision, accounts: accounts.length, claimsInFlight: inFlight.length, funders: new Set(inFlight.map((c) => c.funderId)).size };
}

export async function scoreAccount(db: Db, a: AccountRow, asOf = today()) {
  const txns = await db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, a.id));
  const payments = txns.filter((t) => t.type === 'payment').length;
  const [plan] = a.planId ? await db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.id, a.planId)).limit(1) : [];
  const planStatus = plan ? (plan.status === 'active' ? (plan.schedule.some((s) => s.status === 'missed') ? 'arrears' : 'active') : plan.status === 'completed' ? 'completed' : 'none') : 'none';
  return propensityToPay({
    amountCents: a.balanceCents, daysOutstanding: a.ageingStartAt ? Math.max(0, daysBetween(a.ageingStartAt, asOf)) : 0, priorPaymentsOnTime: payments, priorDefaults: a.flags.includes('prior_default') ? 1 : 0,
    channelReachable: (a.consentChannels ?? []).length > 0 && !a.flags.includes('wrong_number'), openDispute: a.flags.includes('disputed'), planStatus: planStatus as 'none' | 'active' | 'arrears' | 'completed',
    liabilityReason: (a.liabilityReason ?? 'other') as 'other',
  });
}

export async function unbilledRegister(db: Db, practiceId: string, period?: string) {
  const rows = await db.select().from(schema.charges).where(and(eq(schema.charges.practiceId, practiceId), inArray(schema.charges.status, ['unbilled', 'coded', 'ready', 'rejected'])));
  const filtered = period ? rows.filter((r) => r.serviceDate.startsWith(period)) : rows;
  const t = today();
  const items = filtered.map((c) => ({
    chargeId: c.id, patientId: c.patientId, serviceDate: c.serviceDate, ageDays: daysBetween(c.serviceDate, t), modality: c.modality, procedureCodes: c.procedureCodes, funderId: c.funderId, funderType: c.funderType, totalCents: c.totalCents, status: c.status,
    blockingReason: c.blockingReason ?? (c.status === 'rejected' ? 'rejected_by_funder' : c.status === 'coded' ? 'awaiting_coding_decision' : c.status === 'ready' ? 'awaiting_submission' : 'awaiting_coding'),
    owner: c.owner ?? (c.status === 'rejected' ? 'BIL' : c.status === 'coded' ? 'BIL' : c.funderType === 'raf' ? 'DEB' : 'claims-hand'),
  }));
  const byReason: Record<string, { count: number; cents: number }> = {};
  for (const i of items) { const r = (byReason[i.blockingReason] ??= { count: 0, cents: 0 }); r.count++; r.cents += i.totalCents; }
  return { items: items.sort((a, b) => b.ageDays - a.ageDays), count: items.length, valueCents: items.reduce((a, i) => a + i.totalCents, 0), oldestDays: items.reduce((m, i) => Math.max(m, i.ageDays), 0), olderThan7: items.filter((i) => i.ageDays > 7).length, olderThan30: items.filter((i) => i.ageDays > 30).length, byReason };
}

export async function claimsInFlight(db: Db, practiceId: string) {
  const rows = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), inArray(schema.claims.status, ['submitted', 'accepted', 'pended'])));
  const byFunder: Record<string, { count: number; cents: number; oldestDays: number }> = {};
  const t = today();
  for (const r of rows) {
    const f = (byFunder[r.funderId] ??= { count: 0, cents: 0, oldestDays: 0 });
    f.count++; f.cents += r.expectedFunderCents - r.paidCents; f.oldestDays = Math.max(f.oldestDays, daysBetween(r.submittedAt ?? r.createdAt, t));
  }
  return { count: rows.length, valueCents: rows.reduce((a, r) => a + r.expectedFunderCents - r.paidCents, 0), byFunder, realtimeFunders: [...new Set(rows.filter((r) => r.channel === 'realtime').map((r) => r.funderId))].length };
}

/** Audit + response + event timeline for a claim or charge. */
export async function timelineFor(db: Db, ids: string[]) {
  if (!ids.length) return [];
  const audits = await db.select().from(schema.auditLog).where(inArray(schema.auditLog.objectId, ids));
  const events = await db.select().from(schema.events).where(inArray(schema.events.aggregateId, ids));
  const responses = await db.select().from(schema.claimResponses).where(inArray(schema.claimResponses.claimId, ids));
  const items = [
    ...audits.map((a) => ({ at: a.createdAt, kind: 'audit' as const, text: `${a.action.replace(/[._]/g, ' ')}${a.persona ? ` · ${a.persona}` : ''}`, tone: /reject|escalat/.test(a.action) ? 'crit' : 'ok' })),
    ...events.map((e) => ({ at: e.createdAt, kind: 'event' as const, text: e.name, tone: /reject|spike/.test(e.name) ? 'crit' : /hand|coded|assembled|submitted|matched/.test(e.name) ? 'ai' : 'neutral' })),
    ...responses.map((r) => ({ at: r.receivedAt, kind: 'response' as const, text: `${r.outcome}${r.code ? ` · RSP ${r.code}` : ''}${r.message ? ` · ${r.message}` : ''}`, tone: r.outcome === 'rejected' ? 'crit' : r.outcome === 'accepted' || r.outcome === 'paid' ? 'ok' : 'neutral' })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export const _internal = { and, desc, eq, gte, isNull, lt, or, sql, inArray };
