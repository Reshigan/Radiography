import { and, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import { findProcedure, hashString, seededRng, IONISING_MODALITIES } from '@bonakala/domain/bci';
import type { Services } from '../../kernel/ports.js';
import { emitDirect } from '../../kernel/events.js';
import { ageYears } from '../m09-imaging/service.js';

export const REPEAT_REASONS = ['positioning', 'exposure', 'motion', 'artefact', 'anatomy_cutoff', 'equipment', 'patient_movement', 'wrong_protocol', 'other'] as const;

export interface ProtocolSuggestion {
  protocolId: string | null;
  code: string | null;
  name: string;
  reasons: string[];
  confidence: number;
  requiresRgt: boolean;
  standingRule: string | null;
  contrast: { suggested: boolean; blocked: boolean; reason: string } | null;
  drl: { quantity: string; value: number } | null;
  expectedSeries: string[];
  parameters: Record<string, string | number>;
}

/**
 * Protocol Hand core (deterministic, A2): procedure → protocol from the library with paediatric and
 * contrast rules. CT, MR and diagnostic mammography protocols require RGT acceptance (A1) unless a
 * radiologist-approved standing rule applies.
 */
export async function suggestProtocol(services: Services, item: typeof schema.worklistItems.$inferSelect, patient: { dateOfBirth: string | null; flags: string[] | null; sex: string | null } | null): Promise<ProtocolSuggestion> {
  const db = services.db;
  const proc = findProcedure(item.procedureCode);
  const age = ageYears(patient?.dateOfBirth, item.scheduledAt);
  const band = age < 16 ? 'paediatric' : 'adult';
  const rows = await db.select().from(schema.protocols).where(and(eq(schema.protocols.status, 'active'), eq(schema.protocols.modalityType, item.modalityType), or(isNull(schema.protocols.practiceId), eq(schema.protocols.practiceId, item.practiceId))));
  const reasons: string[] = [];
  const byProc = rows.filter((p) => p.procedureCodes.includes(item.procedureCode));
  const byPart = rows.filter((p) => p.bodyPart === (item.bodyPart ?? proc?.bodyPart));
  let pool = byProc.length ? byProc : byPart;
  reasons.push(byProc.length ? `procedure ${item.procedureCode} maps to ${byProc.length} library entr${byProc.length === 1 ? 'y' : 'ies'}` : `no direct mapping; matched by body part ${item.bodyPart ?? proc?.bodyPart}`);
  const paed = pool.filter((p) => p.ageBand === 'paediatric');
  if (band === 'paediatric' && paed.length) { pool = paed; reasons.push(`age ${age}: paediatric variant selected`); }
  else { pool = pool.filter((p) => p.ageBand === 'adult'); if (band === 'paediatric') reasons.push(`age ${age}: no paediatric variant in library, adult protocol flagged for RGT`); }
  const wantsContrast = item.contrast || !!proc?.contrast;
  const egfr = item.safetyGate?.egfr ?? null;
  const reactionFlag = (patient?.flags ?? []).includes('contrast_reaction');
  let contrast: ProtocolSuggestion['contrast'] = null;
  if (wantsContrast) {
    const candidate = pool.find((p) => p.contrast) ?? pool[0];
    const egfrMin = candidate?.contrastRule?.egfrMin ?? 30;
    if (reactionFlag) contrast = { suggested: false, blocked: true, reason: 'documented previous contrast reaction on the patient record' };
    else if (egfr !== null && egfr < egfrMin) contrast = { suggested: false, blocked: true, reason: `eGFR ${egfr} below the practice gate (${egfrMin})` };
    else contrast = { suggested: true, blocked: false, reason: egfr === null ? 'no eGFR on file; nurse to confirm before injection' : `eGFR ${egfr} above the gate (${egfrMin})` };
    if (contrast.blocked) { pool = pool.filter((p) => !p.contrast).length ? pool.filter((p) => !p.contrast) : pool; reasons.push('contrast blocked: non-contrast protocol proposed; RGT to decide'); }
    else pool = pool.filter((p) => p.contrast).length ? pool.filter((p) => p.contrast) : pool;
  } else pool = pool.filter((p) => !p.contrast).length ? pool.filter((p) => !p.contrast) : pool;
  const practiceFirst = pool.find((p) => p.practiceId === item.practiceId) ?? pool[0];
  if (!practiceFirst) return { protocolId: null, code: null, name: 'No library protocol', reasons: [...reasons, 'library has no entry; request RGT protocol'], confidence: 0.2, requiresRgt: true, standingRule: null, contrast, drl: null, expectedSeries: [], parameters: {} };
  const requiresRgt = practiceFirst.requiresRgt && !practiceFirst.standingRule || (band === 'paediatric' && practiceFirst.ageBand !== 'paediatric') || !!contrast?.blocked;
  if (practiceFirst.standingRule) reasons.push(`standing rule ${practiceFirst.standingRule} applied (RGT-approved)`);
  if (item.safetyGate?.pregnancy && item.safetyGate.pregnancy !== 'no' && IONISING_MODALITIES.has(item.modalityType)) reasons.push(`pregnancy declared "${item.safetyGate.pregnancy}": pregnancy protocol, RGT justification required`);
  const confidence = byProc.length ? (contrast?.blocked ? 0.72 : 0.97) : 0.81;
  return {
    protocolId: practiceFirst.id, code: practiceFirst.code, name: practiceFirst.name, reasons, confidence, requiresRgt, standingRule: practiceFirst.standingRule, contrast,
    drl: practiceFirst.drlQuantity && practiceFirst.drlValue ? { quantity: practiceFirst.drlQuantity, value: practiceFirst.drlValue / 1000 } : null,
    expectedSeries: practiceFirst.expectedSeries, parameters: practiceFirst.parameters,
  };
}

/** Contrast calculator: weight-based volume within the protocol ceiling; eGFR gate from the protocol rule. */
export function contrastCalc(rule: { agent: string; concentration: string; mlPerKg: number; maxMl: number; rateMlS: number; egfrMin: number } | null, weightKg: number, egfr: number | null, flags: string[] = []) {
  const r = rule ?? { agent: 'Iohexol (demo)', concentration: '350 mgI/mL', mlPerKg: 1.5, maxMl: 150, rateMlS: 3, egfrMin: 30 };
  const raw = Math.round(weightKg * r.mlPerKg);
  const volumeMl = Math.min(raw, r.maxMl);
  const blocked = flags.includes('contrast_reaction') ? 'documented previous reaction' : egfr !== null && egfr < r.egfrMin ? `eGFR ${egfr} below gate ${r.egfrMin}` : null;
  return { agent: r.agent, concentration: r.concentration, formula: `${weightKg} kg × ${r.mlPerKg} mL/kg = ${raw} mL${raw > r.maxMl ? ` (capped at ${r.maxMl} mL)` : ''}`, volumeMl, rateMlS: r.rateMlS, egfrMin: r.egfrMin, egfr, blocked, warnings: egfr === null ? ['no eGFR on file; confirm before injection'] : [] };
}

/** Synthetic dose quantities for a completed study (deterministic per accession). */
export function syntheticDose(accession: string, procedureCode: string, opts: { repeats?: number; sizeClass?: string } = {}) {
  const proc = findProcedure(procedureCode);
  if (!proc?.doseQuantity || !proc.doseTypical) return null;
  const rng = seededRng(hashString(`dose|${accession}`));
  // log-normal-ish spread around the typical value; ~12% of studies land above the DRL
  const spread = Math.exp((rng() - 0.45) * 0.55);
  let value = proc.doseTypical * spread * (opts.sizeClass === 'large' ? 1.35 : opts.sizeClass === 'paediatric' ? 0.45 : 1);
  value *= 1 + (opts.repeats ?? 0) * 0.5;
  const ctdi = proc.doseQuantity === 'DLP' ? value / (proc.bodyPart === 'head' ? 15 : 28) : null;
  const effective = proc.doseQuantity === 'DLP' ? value * (proc.bodyPart === 'head' ? 0.0021 : proc.bodyPart === 'chest' ? 0.014 : 0.015) : proc.doseQuantity === 'DAP' ? value * 0.2 : proc.doseQuantity === 'AGD' ? value * 0.12 : 0;
  return { quantity: proc.doseQuantity, value: Math.round(value * 1000) / 1000, ctdiVol: ctdi ? Math.round(ctdi * 10) / 10 : null, effectiveMsv: Math.round(effective * 1000) / 1000, drl: proc.drl ?? null };
}

/**
 * MPPS N-SET (Completed): completeness against the protocol, study → complete, worklist → completed,
 * dose record payload and study.completed.v1 (drives archive routing, BCI inference, reading worklist and charge capture).
 */
export async function completeAcquisition(services: Services, opts: { studyId: string; worklistItemId?: string | null; technologistUserId?: string | null; note?: string | null; actor?: string | null; at?: string; overrideIncomplete?: string | null }) {
  const db = services.db;
  const at = opts.at ?? services.clock.now().toISOString();
  const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, opts.studyId)).limit(1);
  if (!study) throw new Error('Study not found');
  const item = opts.worklistItemId ? (await db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, opts.worklistItemId)).limit(1))[0] : study.worklistItemId ? (await db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, study.worklistItemId)).limit(1))[0] : undefined;
  // Completeness check (M08-R-106)
  let missing: string[] = [];
  if (item?.protocolId) {
    const [proto] = await db.select().from(schema.protocols).where(eq(schema.protocols.id, item.protocolId)).limit(1);
    if (proto) {
      const have = (await db.select({ description: schema.series.description, rejected: schema.series.rejected }).from(schema.series).where(eq(schema.series.studyId, study.id))).filter((s) => !s.rejected).map((s) => s.description.toLowerCase());
      missing = proto.expectedSeries.filter((e) => !have.some((h) => h.includes(e.toLowerCase().split(' ')[0]!)));
    }
  }
  if (missing.length && !opts.overrideIncomplete) return { ok: false as const, missing };
  const repeats = (await db.select({ id: schema.repeatRejects.id }).from(schema.repeatRejects).where(eq(schema.repeatRejects.studyId, study.id))).length;
  const [pat] = await db.select({ dateOfBirth: schema.patients.dateOfBirth }).from(schema.patients).where(eq(schema.patients.id, study.patientId)).limit(1);
  const sizeClass = ageYears(pat?.dateOfBirth, at) < 16 ? 'paediatric' : hashString(study.accession) % 7 === 0 ? 'large' : 'standard';
  const dose = syntheticDose(study.accession, study.procedureCode, { repeats, sizeClass });
  await db.update(schema.studies).set({ status: 'complete', completedAt: at, updatedAt: at, technologistNote: opts.note ?? study.technologistNote, technologistUserId: opts.technologistUserId ?? study.technologistUserId }).where(eq(schema.studies.id, study.id));
  if (item) await db.update(schema.worklistItems).set({ status: 'completed', completedAt: at, updatedAt: at, studyId: study.id, accession: study.accession, technologistUserId: opts.technologistUserId ?? item.technologistUserId, technologistNote: opts.note ?? item.technologistNote }).where(eq(schema.worklistItems.id, item.id));
  await emitDirect(services, 'study.completed.v1', {
    studyId: study.id, accession: study.accession, patientId: study.patientId, practiceId: study.practiceId, siteId: study.siteId, roomId: study.roomId, modality: study.modality, procedureCode: study.procedureCode, bodyPart: study.bodyPart, orderId: study.orderId, appointmentId: study.appointmentId, priority: study.priority,
    worklistItemId: item?.id ?? null, protocolId: item?.protocolId ?? null, technologistUserId: opts.technologistUserId ?? null, completedAt: at, missingSeriesOverride: opts.overrideIncomplete ?? null,
    doseRecord: dose ? { ...dose, sizeClass, repeats, pregnancyDeclared: item?.safetyGate?.pregnancy ?? null } : null,
  }, { aggregateType: 'study', aggregateId: study.id, practiceId: study.practiceId });
  return { ok: true as const, missing: [], dose, at };
}

export async function recordRepeat(services: Services, input: { practiceId: string; siteId: string; roomId: string; modalityType: string; worklistItemId?: string | null; studyId?: string | null; seriesId?: string | null; kind: 'repeat' | 'reject'; reasonCode: string; reasonText?: string | null; technologistUserId?: string | null; qcSuggested?: boolean; at?: string }) {
  const id = newId('rr');
  const at = input.at ?? services.clock.now().toISOString();
  await services.db.insert(schema.repeatRejects).values({ id, practiceId: input.practiceId, siteId: input.siteId, roomId: input.roomId, modalityType: input.modalityType, worklistItemId: input.worklistItemId ?? null, studyId: input.studyId ?? null, seriesId: input.seriesId ?? null, kind: input.kind, reasonCode: input.reasonCode, reasonText: input.reasonText ?? null, technologistUserId: input.technologistUserId ?? null, qcSuggested: input.qcSuggested ?? false, createdAt: at });
  if (input.seriesId) await services.db.update(schema.series).set({ rejected: true }).where(eq(schema.series.id, input.seriesId));
  if (input.seriesId) await services.db.update(schema.instances).set({ rejected: true }).where(eq(schema.instances.seriesId, input.seriesId));
  await emitDirect(services, 'repeat.recorded.v1', { repeatId: id, practiceId: input.practiceId, siteId: input.siteId, roomId: input.roomId, studyId: input.studyId ?? null, reasonCode: input.reasonCode, kind: input.kind }, { aggregateType: 'repeat_reject', aggregateId: id, practiceId: input.practiceId });
  return id;
}
