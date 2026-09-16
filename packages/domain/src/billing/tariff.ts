/**
 * Tariff engine (docs/processes/09 §5–6). Pure: procedure codes + modifiers + quantity → priced lines
 * (excl / VAT / incl) using an effective-dated fee schedule (funder rate table, cash rate, uplift %).
 * Every code and price here is illustrative DEMO reference data (docs/00 §5.6).
 */
import { VAT_RATE } from '../shared/money.js';

export type FunderType = 'scheme' | 'cash' | 'raf' | 'coida' | 'corporate';
export type TariffKind = 'procedure' | 'modifier' | 'nappi' | 'admin';
export type Component = 'global' | 'professional' | 'technical';

export interface TariffCode {
  code: string;
  kind: TariffKind;
  description: string;
  patientDescription: string;
  modality?: string; // DX | CT | MR | US | MG | DXA
  bodyRegion?: string;
  contrast?: boolean;
  component: Component;
  vatTreatment: 'standard' | 'zero' | 'exempt';
  /** Modifiers: percentage effect on the lines they apply to (e.g. 25 = +25 %) or a fixed excl amount. */
  modifierPct?: number;
  modifierFixedCents?: number;
  demo: true;
}

/** Illustrative DEMO tariff master. Codes resemble SA radiology tariff families but are not real. */
export const TARIFF_CODES: TariffCode[] = [
  { code: '30110', kind: 'procedure', description: 'Chest, two views', patientDescription: 'Chest X-ray (two pictures)', modality: 'DX', bodyRegion: 'chest', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '30120', kind: 'procedure', description: 'Wrist, two views', patientDescription: 'Wrist X-ray', modality: 'DX', bodyRegion: 'wrist', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '30130', kind: 'procedure', description: 'Cervical spine, three views', patientDescription: 'Neck X-ray', modality: 'DX', bodyRegion: 'cspine', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '30140', kind: 'procedure', description: 'Lumbar spine, two views', patientDescription: 'Lower back X-ray', modality: 'DX', bodyRegion: 'lspine', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '30150', kind: 'procedure', description: 'Knee, two views', patientDescription: 'Knee X-ray', modality: 'DX', bodyRegion: 'knee', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '30160', kind: 'procedure', description: 'Abdomen, single view', patientDescription: 'Abdomen X-ray', modality: 'DX', bodyRegion: 'abdomen', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34100', kind: 'procedure', description: 'CT brain without contrast', patientDescription: 'CT scan of the head (no dye)', modality: 'CT', bodyRegion: 'brain', contrast: false, component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34101', kind: 'procedure', description: 'CT brain with contrast', patientDescription: 'CT scan of the head (with dye)', modality: 'CT', bodyRegion: 'brain', contrast: true, component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34200', kind: 'procedure', description: 'CT cervical spine', patientDescription: 'CT scan of the neck', modality: 'CT', bodyRegion: 'cspine', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34300', kind: 'procedure', description: 'CT chest with contrast', patientDescription: 'CT scan of the chest (with dye)', modality: 'CT', bodyRegion: 'chest', contrast: true, component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34320', kind: 'procedure', description: 'CT abdomen with contrast', patientDescription: 'CT scan of the abdomen (with dye)', modality: 'CT', bodyRegion: 'abdomen', contrast: true, component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34322', kind: 'procedure', description: 'CT abdomen, delayed phase', patientDescription: 'Extra CT pictures of the abdomen taken later', modality: 'CT', bodyRegion: 'abdomen', contrast: true, component: 'global', vatTreatment: 'standard', demo: true },
  { code: '34400', kind: 'procedure', description: 'CT lumbar spine', patientDescription: 'CT scan of the lower back', modality: 'CT', bodyRegion: 'lspine', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '35100', kind: 'procedure', description: 'MRI brain', patientDescription: 'MRI scan of the head', modality: 'MR', bodyRegion: 'brain', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '35110', kind: 'procedure', description: 'MRI lumbar spine', patientDescription: 'MRI scan of the lower back', modality: 'MR', bodyRegion: 'lspine', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '35120', kind: 'procedure', description: 'MRI knee', patientDescription: 'MRI scan of the knee', modality: 'MR', bodyRegion: 'knee', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '33020', kind: 'procedure', description: 'Ultrasound abdomen', patientDescription: 'Ultrasound of the abdomen', modality: 'US', bodyRegion: 'abdomen', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '33030', kind: 'procedure', description: 'Ultrasound pelvis', patientDescription: 'Ultrasound of the pelvis', modality: 'US', bodyRegion: 'pelvis', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '33040', kind: 'procedure', description: 'Ultrasound obstetric', patientDescription: 'Pregnancy ultrasound', modality: 'US', bodyRegion: 'obstetric', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '39120', kind: 'procedure', description: 'Mammography bilateral screening', patientDescription: 'Screening mammogram (both breasts)', modality: 'MG', bodyRegion: 'breast', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '39200', kind: 'procedure', description: 'DXA bone density', patientDescription: 'Bone density scan', modality: 'DXA', bodyRegion: 'spine_hip', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '0012', kind: 'modifier', description: 'Contrast administration', patientDescription: 'Giving the contrast dye', component: 'global', vatTreatment: 'standard', modifierFixedCents: 48000, demo: true },
  { code: '0018', kind: 'modifier', description: 'After-hours', patientDescription: 'After-hours service', component: 'global', vatTreatment: 'standard', modifierPct: 25, demo: true },
  { code: '0020', kind: 'modifier', description: 'Bilateral', patientDescription: 'Both sides', component: 'global', vatTreatment: 'standard', modifierPct: 50, demo: true },
  { code: '700123', kind: 'nappi', description: 'Iodinated contrast 100 ml (NAPPI demo)', patientDescription: 'Contrast dye, 100 ml', component: 'global', vatTreatment: 'standard', demo: true },
  { code: '700124', kind: 'nappi', description: 'Gadolinium contrast 15 ml (NAPPI demo)', patientDescription: 'MRI contrast dye, 15 ml', component: 'global', vatTreatment: 'standard', demo: true },
];

export const TARIFF_BY_CODE: Record<string, TariffCode> = Object.fromEntries(TARIFF_CODES.map((t) => [t.code, t]));
export const PROCEDURE_CODES = TARIFF_CODES.filter((t) => t.kind === 'procedure').map((t) => t.code);

/** Base (100 %) rate per code in cents excl. VAT — the illustrative "funder published rate". */
export const BASE_RATE_CENTS: Record<string, number> = {
  '30110': 52000, '30120': 41000, '30130': 56000, '30140': 61000, '30150': 45000, '30160': 47000,
  '34100': 298000, '34101': 342000, '34200': 318000, '34300': 356000, '34320': 342000, '34322': 61000, '34400': 331000,
  '35100': 452000, '35110': 390000, '35120': 410000,
  '33020': 118000, '33030': 112000, '33040': 124000,
  '39120': 168000, '39200': 96000,
  '0012': 48000, '700123': 61500, '700124': 88000,
};

export interface FeeScheduleLine {
  code: string;
  priceExclCents: number;
  unit: 'per_study' | 'per_unit';
  effectiveFrom?: string;
  effectiveTo?: string | null;
}
export interface FeeSchedule {
  id: string;
  practiceId: string;
  funderId: string; // scheme-a | scheme-b | scheme-c | cash | raf | coida | corporate
  funderType: FunderType;
  name: string;
  kind: 'scheme_rate' | 'negotiated' | 'cash' | 'raf' | 'coida' | 'corporate';
  version: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  /** Percentage uplift on the base rate when a line is absent (0 = 100 % of base, 50 = 150 %). */
  upliftPct: number;
  lines: FeeScheduleLine[];
  status?: 'draft' | 'active' | 'superseded';
}

/** Build a schedule from the base table with an uplift and optional per-code overrides. */
export function buildSchedule(input: Omit<FeeSchedule, 'lines'> & { overrides?: Record<string, number>; codes?: string[] }): FeeSchedule {
  const codes = input.codes ?? Object.keys(BASE_RATE_CENTS);
  const lines: FeeScheduleLine[] = codes.map((code) => ({
    code,
    priceExclCents: input.overrides?.[code] ?? Math.round((BASE_RATE_CENTS[code] ?? 0) * (1 + input.upliftPct / 100)),
    unit: 'per_unit',
  }));
  const { overrides: _o, codes: _c, ...rest } = input;
  return { ...rest, lines };
}

/** Pick the schedule in force on the service date (latest version wins on ties). */
export function scheduleInForce(schedules: FeeSchedule[], funderId: string, serviceDate: string): FeeSchedule | undefined {
  const day = serviceDate.slice(0, 10);
  return schedules
    .filter((s) => s.funderId === funderId && (s.status ?? 'active') === 'active' && s.effectiveFrom <= day && (!s.effectiveTo || s.effectiveTo >= day))
    .sort((a, b) => b.version - a.version)[0];
}

export interface ProcedureInput {
  code: string;
  quantity?: number;
  modifiers?: string[];
  laterality?: 'left' | 'right' | 'bilateral';
  contrast?: boolean;
}
export interface ConsumableInput {
  nappi: string;
  quantity: number;
}
export interface PricingRules {
  /** Reduction on second and subsequent procedures in the session (percentage, e.g. 50). */
  multipleProcedureReductionPct: number;
  /** Whether procedures on different modalities reduce each other. */
  reduceAcrossModalities: boolean;
  /** How contrast consumables are billed. */
  contrastRule: 'full_vial' | 'administered' | 'not_billed';
  /** Network co-payment carried by the patient (percentage of the claim total). */
  networkCoPayPct: number;
  /** Zero patient portion for PMB-flagged claims at a DSP. */
  pmbZeroCoPay?: boolean;
}
export const DEFAULT_PRICING_RULES: PricingRules = { multipleProcedureReductionPct: 50, reduceAcrossModalities: false, contrastRule: 'full_vial', networkCoPayPct: 0 };

export interface PricedLine {
  code: string;
  kind: TariffKind;
  description: string;
  patientDescription: string;
  quantity: number;
  unitExclCents: number;
  /** Multiple-procedure or modifier adjustments already applied (negative reduces). */
  adjustmentCents: number;
  adjustmentReason?: string;
  exclCents: number;
  vatCents: number;
  inclCents: number;
  priceSource: 'schedule_line' | 'base_uplift' | 'modifier_rule' | 'override';
  modifiers: string[];
  /** Whether this line is a consumable auto-added by the contrast rule. */
  auto?: boolean;
}
export interface PricedCharge {
  lines: PricedLine[];
  subtotalExclCents: number;
  vatCents: number;
  totalCents: number;
  expectedFunderCents: number;
  expectedPatientCents: number;
  patientPortionReason: 'cash' | 'network_co_pay' | 'none' | 'pmb_zero';
  scheduleId: string;
  scheduleVersion: number;
  vatRate: number;
}

function vatFor(excl: number, treatment: TariffCode['vatTreatment'], rate: number) {
  return treatment === 'standard' ? Math.round(excl * rate) : 0;
}

function linePrice(schedule: FeeSchedule, code: string): { cents: number; source: PricedLine['priceSource'] } {
  const line = schedule.lines.find((l) => l.code === code);
  if (line) return { cents: line.priceExclCents, source: 'schedule_line' };
  const base = BASE_RATE_CENTS[code];
  if (base === undefined) throw new Error(`No price for tariff code ${code}`);
  return { cents: Math.round(base * (1 + schedule.upliftPct / 100)), source: 'base_uplift' };
}

/**
 * Price a charge. Multiple-procedure rule: the highest-value procedure is primary at 100 %; subsequent
 * procedures (same modality unless reduceAcrossModalities) are reduced. Contrast procedures add the
 * contrast-administration modifier and a NAPPI consumable line per the contrast rule. Bilateral adds the
 * bilateral modifier. VAT per line at 15 % (standard-rated medical services, docs/24).
 */
export function priceCharge(input: { procedures: ProcedureInput[]; consumables?: ConsumableInput[]; funderType: FunderType; pmb?: boolean }, schedule: FeeSchedule, rules: PricingRules = DEFAULT_PRICING_RULES, vatRate = VAT_RATE): PricedCharge {
  if (!input.procedures.length) throw new Error('A charge needs at least one procedure');
  const lines: PricedLine[] = [];
  // 1. procedures at full price
  const procs = input.procedures.map((p) => {
    const t = TARIFF_BY_CODE[p.code];
    if (!t || t.kind !== 'procedure') throw new Error(`Unknown procedure code ${p.code}`);
    const { cents, source } = linePrice(schedule, p.code);
    const qty = p.quantity ?? 1;
    return { p, t, unit: cents, source, qty, full: cents * qty };
  });
  // 2. multiple-procedure reduction: sort by value desc; primary untouched
  const sorted = [...procs].sort((a, b) => b.full - a.full);
  const primary = sorted[0]!;
  for (const pr of procs) {
    let adjustment = 0;
    let reason: string | undefined;
    if (pr !== primary && (rules.reduceAcrossModalities || pr.t.modality === primary.t.modality)) {
      adjustment = -Math.round((pr.full * rules.multipleProcedureReductionPct) / 100);
      reason = `multiple procedure −${rules.multipleProcedureReductionPct} %`;
    }
    const mods = [...(pr.p.modifiers ?? [])];
    const contrast = pr.p.contrast ?? pr.t.contrast ?? false;
    if (contrast && !mods.includes('0012')) mods.push('0012');
    if (pr.p.laterality === 'bilateral' && !mods.includes('0020')) mods.push('0020');
    let excl = pr.full + adjustment;
    // percentage modifiers apply to the procedure line
    for (const m of mods) {
      const mt = TARIFF_BY_CODE[m];
      if (mt?.modifierPct) {
        const eff = Math.round((excl * mt.modifierPct) / 100);
        adjustment += eff;
        excl += eff;
        reason = reason ? `${reason}; ${mt.description} +${mt.modifierPct} %` : `${mt.description} +${mt.modifierPct} %`;
      }
    }
    lines.push({
      code: pr.p.code, kind: 'procedure', description: pr.t.description, patientDescription: pr.t.patientDescription, quantity: pr.qty,
      unitExclCents: pr.unit, adjustmentCents: adjustment, adjustmentReason: reason, exclCents: excl, vatCents: vatFor(excl, pr.t.vatTreatment, vatRate), inclCents: 0,
      priceSource: pr.source, modifiers: mods,
    });
    // fixed-amount modifiers become their own line (e.g. contrast administration)
    for (const m of mods) {
      const mt = TARIFF_BY_CODE[m];
      if (mt?.modifierFixedCents) {
        const { cents, source } = (() => { try { return linePrice(schedule, m); } catch { return { cents: mt.modifierFixedCents!, source: 'modifier_rule' as const }; } })();
        lines.push({ code: m, kind: 'modifier', description: mt.description, patientDescription: mt.patientDescription, quantity: 1, unitExclCents: cents, adjustmentCents: 0, exclCents: cents, vatCents: vatFor(cents, mt.vatTreatment, vatRate), inclCents: 0, priceSource: source, modifiers: [] });
      }
    }
    // contrast consumable
    if (contrast && rules.contrastRule !== 'not_billed' && !(input.consumables ?? []).length) {
      const nappi = pr.t.modality === 'MR' ? '700124' : '700123';
      const nt = TARIFF_BY_CODE[nappi]!;
      const { cents, source } = linePrice(schedule, nappi);
      const qty = rules.contrastRule === 'full_vial' ? 1 : 1;
      lines.push({ code: nappi, kind: 'nappi', description: nt.description, patientDescription: nt.patientDescription, quantity: qty, unitExclCents: cents, adjustmentCents: 0, exclCents: cents * qty, vatCents: vatFor(cents * qty, nt.vatTreatment, vatRate), inclCents: 0, priceSource: source, modifiers: [], auto: true });
    }
  }
  for (const cns of input.consumables ?? []) {
    const nt = TARIFF_BY_CODE[cns.nappi];
    if (!nt) throw new Error(`Unknown NAPPI ${cns.nappi}`);
    const { cents, source } = linePrice(schedule, cns.nappi);
    const excl = cents * cns.quantity;
    lines.push({ code: cns.nappi, kind: 'nappi', description: nt.description, patientDescription: nt.patientDescription, quantity: cns.quantity, unitExclCents: cents, adjustmentCents: 0, exclCents: excl, vatCents: vatFor(excl, nt.vatTreatment, vatRate), inclCents: 0, priceSource: source, modifiers: [] });
  }
  for (const l of lines) l.inclCents = l.exclCents + l.vatCents;
  const subtotalExclCents = lines.reduce((a, l) => a + l.exclCents, 0);
  const vatCents = lines.reduce((a, l) => a + l.vatCents, 0);
  const totalCents = subtotalExclCents + vatCents;
  const split = splitLiability(totalCents, input.funderType, rules, input.pmb);
  return { lines, subtotalExclCents, vatCents, totalCents, ...split, scheduleId: schedule.id, scheduleVersion: schedule.version, vatRate };
}

export function splitLiability(totalCents: number, funderType: FunderType, rules: PricingRules, pmb = false): Pick<PricedCharge, 'expectedFunderCents' | 'expectedPatientCents' | 'patientPortionReason'> {
  if (funderType === 'cash') return { expectedFunderCents: 0, expectedPatientCents: totalCents, patientPortionReason: 'cash' };
  if (funderType !== 'scheme') return { expectedFunderCents: totalCents, expectedPatientCents: 0, patientPortionReason: 'none' };
  if (pmb && rules.pmbZeroCoPay) return { expectedFunderCents: totalCents, expectedPatientCents: 0, patientPortionReason: 'pmb_zero' };
  const patient = Math.round((totalCents * rules.networkCoPayPct) / 100);
  return { expectedFunderCents: totalCents - patient, expectedPatientCents: patient, patientPortionReason: patient > 0 ? 'network_co_pay' : 'none' };
}

/** Map a procedure description/modality/body part (from an order or report) to the best tariff code. */
export function mapProcedureToTariff(p: { code?: string; description?: string; modality?: string; bodyPart?: string; contrast?: boolean }): { code: string; confidence: number; basis: string } | null {
  if (p.code && TARIFF_BY_CODE[p.code]?.kind === 'procedure') return { code: p.code, confidence: 0.99, basis: 'exact tariff code' };
  const text = `${p.description ?? ''} ${p.bodyPart ?? ''}`.toLowerCase();
  const modality = (p.modality ?? '').toUpperCase().replace('CR', 'DX').replace('XR', 'DX');
  const region = /brain|head|skull/.test(text) ? 'brain' : /cervical|c-spine|neck/.test(text) ? 'cspine' : /lumbar|l-spine|lower back/.test(text) ? 'lspine' : /chest|thorax|lung/.test(text) ? 'chest' : /abdomen|abdo|liver|kidney/.test(text) ? 'abdomen' : /pelvis/.test(text) ? 'pelvis' : /wrist|hand/.test(text) ? 'wrist' : /knee/.test(text) ? 'knee' : /breast|mammo/.test(text) ? 'breast' : /obstet|pregnan|fetal/.test(text) ? 'obstetric' : /bone density|dxa/.test(text) ? 'spine_hip' : null;
  const contrast = p.contrast ?? /contrast|c\+|with dye/.test(text);
  const candidates = TARIFF_CODES.filter((t) => t.kind === 'procedure' && (!modality || t.modality === modality) && (!region || t.bodyRegion === region));
  if (!candidates.length) return null;
  const withContrast = candidates.find((t) => (t.contrast ?? false) === contrast) ?? candidates[0]!;
  const confidence = region && modality ? 0.9 : region || modality ? 0.72 : 0.5;
  return { code: withContrast.code, confidence, basis: region && modality ? `modality ${modality} + region ${region}` : 'partial match' };
}
