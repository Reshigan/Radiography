/**
 * Scheme rule packs (declarative data, versioned and effective-dated), the claim scrubber and the
 * rejection-reason taxonomy with auto-fix paths (docs/processes/09 §7–8). Pure functions.
 */
import type { FunderType, PricingRules } from './tariff.js';
import { DEFAULT_PRICING_RULES, TARIFF_BY_CODE } from './tariff.js';

export type ReasonCode =
  | 'MISSING_FIELD' | 'AUTH_REQ' | 'ICD_MISSING' | 'ICD_INVALID' | 'MEMBER_NOT_FOUND' | 'DEPENDANT_MISMATCH' | 'REFERRER_MISSING'
  | 'DUPLICATE' | 'NEAR_DUPLICATE' | 'STALE' | 'CONTRAST_NO_NAPPI' | 'AGE_SEX_EDIT' | 'BENEFIT_EXHAUSTED' | 'NOT_COVERED'
  | 'RATE_DIFFERENCE' | 'PMB_DISPUTE' | 'TECHNICAL' | 'LATE_SUBMISSION' | 'CLAIM_NUMBER_MISSING' | 'ATTORNEY_MISSING' | 'ABOVE_LEASH';

export type Severity = 'error' | 'warn' | 'fix';

export interface RulePack {
  id: string;
  funderId: string;
  funderName: string;
  funderType: FunderType;
  version: string; // e.g. 2026.09.2
  effectiveFrom: string;
  effectiveTo?: string | null;
  /** Claim fields that must be present. */
  requiredFields: string[];
  /** Tariff codes that need an authorisation number on the claim. */
  authRequiredCodes: string[];
  /** ICD-10 constraints per tariff code family: allowed primary prefixes or disallowed primaries. */
  icd10Constraints: Array<{ codes: string[]; allowedPrefixes?: string[]; disallowedPrimary?: string[]; message: string }>;
  /** ICD-10 codes (prefixes) recognised as PMB conditions for this funder (illustrative). */
  pmbCodes: string[];
  /** Stale-claim window in days from date of service (illustrative 4 months = 120 days). */
  staleClaimDays: number;
  /** Real-time adjudication supported by this funder's switch. */
  realtime: boolean;
  pricing: PricingRules;
  /** Age/sex edits: code → constraint. */
  ageSexEdits: Array<{ codes: string[]; sex?: 'F' | 'M'; minAge?: number; maxAge?: number; message: string }>;
  /** Frequency limits: code → one per N days. */
  frequencyLimits: Array<{ codes: string[]; days: number; message: string }>;
  notes?: string;
}

const COMMON_REQUIRED = ['practiceNo', 'treatingProviderNo', 'referrerNo', 'memberNo', 'dependantCode', 'serviceDate', 'siteCode', 'patientDob'];
const CT_CODES = ['34100', '34101', '34200', '34300', '34320', '34322', '34400'];
const MR_CODES = ['35100', '35110', '35120'];

/** Illustrative DEMO rule packs. Scheme B 2026.08 lacked the CT authorisation rule that circular 14/2026 introduced. */
export const RULE_PACKS: RulePack[] = [
  {
    id: 'rp-scheme-a-2026.06', funderId: 'scheme-a', funderName: 'Scheme A (demo)', funderType: 'scheme', version: '2026.06.1', effectiveFrom: '2026-06-01',
    requiredFields: COMMON_REQUIRED, authRequiredCodes: MR_CODES, icd10Constraints: [{ codes: ['39120'], allowedPrefixes: ['Z12', 'N63', 'N64', 'C50'], message: 'Screening mammography needs a screening or breast diagnosis' }],
    pmbCodes: ['C', 'I21', 'I63', 'S06', 'S12', 'S32', 'K80'], staleClaimDays: 120, realtime: true,
    pricing: { ...DEFAULT_PRICING_RULES, networkCoPayPct: 0, pmbZeroCoPay: true },
    ageSexEdits: [{ codes: ['33040'], sex: 'F', message: 'Obstetric ultrasound is female only' }, { codes: ['39120'], minAge: 35, message: 'Screening mammography from age 35' }],
    frequencyLimits: [{ codes: ['39120'], days: 365, message: 'One screening mammogram per year' }],
  },
  {
    id: 'rp-scheme-b-2026.08', funderId: 'scheme-b', funderName: 'Scheme B (demo)', funderType: 'scheme', version: '2026.08.1', effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31',
    requiredFields: COMMON_REQUIRED, authRequiredCodes: MR_CODES, icd10Constraints: [],
    pmbCodes: ['C', 'I21', 'I63', 'S06'], staleClaimDays: 120, realtime: true,
    pricing: { ...DEFAULT_PRICING_RULES, networkCoPayPct: 7 },
    ageSexEdits: [{ codes: ['33040'], sex: 'F', message: 'Obstetric ultrasound is female only' }], frequencyLimits: [],
    notes: 'Superseded: did not include circular 14/2026 (CT out-of-hospital authorisation).',
  },
  {
    id: 'rp-scheme-b-2026.09', funderId: 'scheme-b', funderName: 'Scheme B (demo)', funderType: 'scheme', version: '2026.09.2', effectiveFrom: '2026-09-01',
    requiredFields: COMMON_REQUIRED, authRequiredCodes: [...MR_CODES, ...CT_CODES],
    icd10Constraints: [{ codes: CT_CODES, disallowedPrimary: ['R51', 'R10.4', 'R52'], message: 'Symptom codes are not accepted as primary for CT since circular 14/2026' }],
    pmbCodes: ['C', 'I21', 'I63', 'S06'], staleClaimDays: 120, realtime: true,
    pricing: { ...DEFAULT_PRICING_RULES, networkCoPayPct: 7 },
    ageSexEdits: [{ codes: ['33040'], sex: 'F', message: 'Obstetric ultrasound is female only' }], frequencyLimits: [],
    notes: 'Circular 14/2026: pre-authorisation number required on out-of-hospital CT tariffs; symptom codes not accepted as primary.',
  },
  {
    id: 'rp-scheme-c-2026.03', funderId: 'scheme-c', funderName: 'Scheme C (demo)', funderType: 'scheme', version: '2026.03.1', effectiveFrom: '2026-03-01',
    requiredFields: COMMON_REQUIRED, authRequiredCodes: [...MR_CODES, '34300', '34320'], icd10Constraints: [],
    pmbCodes: ['C', 'I21', 'I63', 'S06', 'S72'], staleClaimDays: 120, realtime: false,
    pricing: { ...DEFAULT_PRICING_RULES, multipleProcedureReductionPct: 40, networkCoPayPct: 10 },
    ageSexEdits: [], frequencyLimits: [{ codes: ['39200'], days: 730, message: 'One bone density scan per two years' }],
  },
  {
    id: 'rp-cash', funderId: 'cash', funderName: 'Cash', funderType: 'cash', version: '1', effectiveFrom: '2026-01-01',
    requiredFields: ['serviceDate', 'siteCode'], authRequiredCodes: [], icd10Constraints: [], pmbCodes: [], staleClaimDays: 0, realtime: false,
    pricing: { ...DEFAULT_PRICING_RULES, networkCoPayPct: 100 }, ageSexEdits: [], frequencyLimits: [],
  },
  {
    id: 'rp-raf', funderId: 'raf', funderName: 'Road Accident Fund', funderType: 'raf', version: '1', effectiveFrom: '2026-01-01',
    requiredFields: ['serviceDate', 'siteCode', 'rafClaimNo', 'attorneyRef'], authRequiredCodes: [], icd10Constraints: [], pmbCodes: [], staleClaimDays: 1095, realtime: false,
    pricing: { ...DEFAULT_PRICING_RULES }, ageSexEdits: [], frequencyLimits: [],
  },
  {
    id: 'rp-coida', funderId: 'coida', funderName: 'Compensation Fund (COIDA)', funderType: 'coida', version: '1', effectiveFrom: '2026-01-01',
    requiredFields: ['serviceDate', 'siteCode', 'coidaClaimNo', 'employerRef'], authRequiredCodes: [], icd10Constraints: [], pmbCodes: [], staleClaimDays: 365, realtime: false,
    pricing: { ...DEFAULT_PRICING_RULES }, ageSexEdits: [], frequencyLimits: [],
  },
  {
    id: 'rp-corporate', funderId: 'corporate', funderName: 'Corporate contract', funderType: 'corporate', version: '1', effectiveFrom: '2026-01-01',
    requiredFields: ['serviceDate', 'siteCode', 'poRef'], authRequiredCodes: [], icd10Constraints: [], pmbCodes: [], staleClaimDays: 90, realtime: false,
    pricing: { ...DEFAULT_PRICING_RULES }, ageSexEdits: [], frequencyLimits: [],
  },
];

export function rulePackInForce(funderId: string, serviceDate: string, packs: RulePack[] = RULE_PACKS): RulePack {
  const day = serviceDate.slice(0, 10);
  const found = packs
    .filter((p) => p.funderId === funderId && p.effectiveFrom <= day && (!p.effectiveTo || p.effectiveTo >= day))
    .sort((a, b) => (a.version < b.version ? 1 : -1))[0];
  if (found) return found;
  const latest = packs.filter((p) => p.funderId === funderId).sort((a, b) => (a.version < b.version ? 1 : -1))[0];
  if (latest) return latest;
  return packs.find((p) => p.funderId === 'cash')!;
}

export function funderTypeOf(funderId: string | null | undefined): FunderType {
  if (!funderId || funderId === 'cash') return 'cash';
  if (funderId === 'raf') return 'raf';
  if (funderId === 'coida') return 'coida';
  if (funderId === 'corporate') return 'corporate';
  return 'scheme';
}

/** What the scrubber sees. Field names mirror the required-field vocabulary. */
export interface ClaimForScrub {
  funderId: string;
  serviceDate: string; // YYYY-MM-DD
  fields: Record<string, string | null | undefined>; // practiceNo, treatingProviderNo, referrerNo, memberNo, dependantCode, siteCode, patientDob, authRef, rafClaimNo, ...
  lines: Array<{ code: string; quantity: number }>;
  icd10: string[]; // primary first
  patient?: { sex?: string | null; dateOfBirth?: string | null };
  /** Prior claims for the same patient used for duplicate and frequency checks. */
  priorClaims?: Array<{ serviceDate: string; codes: string[]; status: string; modality?: string }>;
  today?: string; // YYYY-MM-DD
}

export interface ScrubFinding {
  ruleId: string;
  severity: Severity;
  code: ReasonCode;
  message: string;
  field?: string;
  fixed?: boolean;
  fixValue?: string;
}
export interface ScrubResult {
  pass: boolean;
  findings: ScrubFinding[];
  errors: number;
  warnings: number;
  fixes: number;
  rulePackId: string;
  rulePackVersion: string;
  /** Claim fields after deterministic fixes. */
  fields: Record<string, string | null | undefined>;
  staleDate: string | null;
}

function ageAt(dob: string | null | undefined, on: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const o = new Date(on);
  let age = o.getUTCFullYear() - d.getUTCFullYear();
  if (o.getUTCMonth() < d.getUTCMonth() || (o.getUTCMonth() === d.getUTCMonth() && o.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b.slice(0, 10)).getTime() - new Date(a.slice(0, 10)).getTime()) / 86400000);
}

/** Run the funder's rule pack. Errors block; warnings flag; fixes correct deterministically with audit. */
export function scrubClaim(claim: ClaimForScrub, pack: RulePack): ScrubResult {
  const findings: ScrubFinding[] = [];
  const fields: Record<string, string | null | undefined> = { serviceDate: claim.serviceDate, ...claim.fields };
  const today = claim.today ?? new Date().toISOString().slice(0, 10);
  const codes = claim.lines.map((l) => l.code);
  const procedureCodes = codes.filter((c) => TARIFF_BY_CODE[c]?.kind === 'procedure');

  // Required fields (with deterministic fixes for dependant code padding)
  for (const f of pack.requiredFields) {
    const v = fields[f];
    if (f === 'dependantCode' && v !== undefined && v !== null && v !== '' && /^\d$/.test(String(v))) {
      fields[f] = String(v).padStart(2, '0');
      findings.push({ ruleId: `${pack.id}:fix-dependant`, severity: 'fix', code: 'MISSING_FIELD', field: f, message: 'Dependant code padded to two digits', fixed: true, fixValue: fields[f] ?? undefined });
      continue;
    }
    if (v === undefined || v === null || String(v).trim() === '') {
      const code: ReasonCode = f === 'referrerNo' ? 'REFERRER_MISSING' : f === 'memberNo' ? 'MEMBER_NOT_FOUND' : f === 'rafClaimNo' || f === 'coidaClaimNo' ? 'CLAIM_NUMBER_MISSING' : f === 'attorneyRef' ? 'ATTORNEY_MISSING' : 'MISSING_FIELD';
      findings.push({ ruleId: `${pack.id}:required:${f}`, severity: 'error', code, field: f, message: `${labelFor(f)} is required by ${pack.funderName}` });
    }
  }
  // Member number sanity (demo: ends in 99 = not found)
  if (fields.memberNo && /99$/.test(String(fields.memberNo))) findings.push({ ruleId: `${pack.id}:member-valid`, severity: 'warn', code: 'MEMBER_NOT_FOUND', field: 'memberNo', message: 'Member not found at last benefit check; re-verify before submission' });

  // Code validity
  for (const c of codes) if (!TARIFF_BY_CODE[c]) findings.push({ ruleId: `${pack.id}:code-valid`, severity: 'error', code: 'TECHNICAL', message: `Tariff code ${c} is not valid on the service date` });

  // ICD-10
  if (pack.funderType === 'scheme' && claim.icd10.length === 0) findings.push({ ruleId: `${pack.id}:icd-required`, severity: 'error', code: 'ICD_MISSING', field: 'icd10', message: 'A primary ICD-10 code is required' });
  const primary = claim.icd10[0];
  for (const c of pack.icd10Constraints) {
    if (!c.codes.some((x) => procedureCodes.includes(x))) continue;
    if (primary && c.disallowedPrimary?.some((d) => primary.toUpperCase().startsWith(d))) findings.push({ ruleId: `${pack.id}:icd-primary`, severity: 'error', code: 'ICD_INVALID', field: 'icd10', message: `${c.message} (primary ${primary})` });
    if (primary && c.allowedPrefixes && !c.allowedPrefixes.some((d) => primary.toUpperCase().startsWith(d))) findings.push({ ruleId: `${pack.id}:icd-allowed`, severity: 'error', code: 'ICD_INVALID', field: 'icd10', message: `${c.message} (primary ${primary})` });
  }

  // Authorisation
  const needsAuth = procedureCodes.filter((c) => pack.authRequiredCodes.includes(c));
  if (needsAuth.length && !fields.authRef) findings.push({ ruleId: `${pack.id}:auth-required`, severity: 'error', code: 'AUTH_REQ', field: 'authRef', message: `${pack.funderName} requires an authorisation number for ${needsAuth.join(', ')}` });

  // Contrast plausibility
  const hasContrastProc = procedureCodes.some((c) => TARIFF_BY_CODE[c]?.contrast);
  if (hasContrastProc && !codes.some((c) => TARIFF_BY_CODE[c]?.kind === 'nappi')) findings.push({ ruleId: `${pack.id}:contrast-nappi`, severity: 'warn', code: 'CONTRAST_NO_NAPPI', message: 'Contrast procedure without a NAPPI consumable line' });

  // Age / sex edits
  for (const e of pack.ageSexEdits) {
    if (!e.codes.some((x) => procedureCodes.includes(x))) continue;
    const age = ageAt(claim.patient?.dateOfBirth ?? fields.patientDob, claim.serviceDate);
    if (e.sex && claim.patient?.sex && claim.patient.sex !== e.sex) findings.push({ ruleId: `${pack.id}:sex-edit`, severity: 'error', code: 'AGE_SEX_EDIT', message: e.message });
    if (e.minAge !== undefined && age !== null && age < e.minAge) findings.push({ ruleId: `${pack.id}:age-edit`, severity: 'warn', code: 'AGE_SEX_EDIT', message: e.message });
    if (e.maxAge !== undefined && age !== null && age > e.maxAge) findings.push({ ruleId: `${pack.id}:age-edit`, severity: 'warn', code: 'AGE_SEX_EDIT', message: e.message });
  }

  // Duplicates and frequency
  for (const prior of claim.priorClaims ?? []) {
    if (prior.status === 'reversed') continue;
    const same = prior.serviceDate.slice(0, 10) === claim.serviceDate.slice(0, 10);
    if (same && prior.codes.some((c) => procedureCodes.includes(c))) findings.push({ ruleId: `${pack.id}:duplicate`, severity: 'error', code: 'DUPLICATE', message: 'Same patient, tariff code and service date already claimed' });
    else if (same) findings.push({ ruleId: `${pack.id}:near-duplicate`, severity: 'warn', code: 'NEAR_DUPLICATE', message: 'Another claim for this patient on the same day' });
    for (const fl of pack.frequencyLimits) {
      const hit = fl.codes.filter((c) => procedureCodes.includes(c) && prior.codes.includes(c));
      if (hit.length && Math.abs(daysBetween(prior.serviceDate, claim.serviceDate)) < fl.days) findings.push({ ruleId: `${pack.id}:frequency`, severity: 'error', code: 'NOT_COVERED', message: fl.message });
    }
  }

  // Stale-claim window
  const staleDate = pack.staleClaimDays ? addDays(claim.serviceDate, pack.staleClaimDays) : null;
  if (staleDate && today > staleDate) findings.push({ ruleId: `${pack.id}:stale`, severity: 'error', code: 'STALE', message: `Claim is beyond the ${pack.staleClaimDays}-day submission window (stale ${staleDate})` });

  const errors = findings.filter((f) => f.severity === 'error').length;
  return {
    pass: errors === 0, findings, errors, warnings: findings.filter((f) => f.severity === 'warn').length, fixes: findings.filter((f) => f.severity === 'fix').length,
    rulePackId: pack.id, rulePackVersion: pack.version, fields, staleDate,
  };
}

function labelFor(f: string) {
  return ({ practiceNo: 'Billing practice number', treatingProviderNo: 'Treating provider number', referrerNo: 'Referring practitioner practice number', memberNo: 'Member number', dependantCode: 'Dependant code', serviceDate: 'Service date', siteCode: 'Place of service', patientDob: 'Patient date of birth', authRef: 'Authorisation number', rafClaimNo: 'RAF claim number', attorneyRef: 'Attorney of record', coidaClaimNo: 'Compensation Fund claim number', employerRef: 'Employer accident report reference', poRef: 'Purchase order reference' } as Record<string, string>)[f] ?? f;
}

/* ---------- Rejection taxonomy and auto-fix paths (docs/09 §8.5) ---------- */
export type RejectionClass = 'member' | 'authorisation' | 'coding' | 'benefit' | 'duplicate' | 'referrer' | 'technical' | 'late' | 'funder_class';
export type AutoFixPath = 'verify_member' | 'retro_auth' | 'recode' | 'patient_liability' | 'verify_duplicate' | 'correct_referrer' | 'technical_retry' | 'writeoff_proposal' | 'manual';

export interface RejectionMapping {
  class: RejectionClass;
  label: string;
  path: AutoFixPath;
  /** Automation level of the fix path (A3 = Claims Hand may fix and resubmit within leash). */
  level: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  suggestion: string;
  exceptionFamily: 'Identity' | 'Coding confidence' | 'Funder rule' | 'Referrer' | 'Funder class' | 'Data quality' | 'Technical' | 'Deadline';
}

export const REJECTION_TAXONOMY: Record<ReasonCode, RejectionMapping> = {
  MEMBER_NOT_FOUND: { class: 'member', label: 'Member not found', path: 'verify_member', level: 'A1', suggestion: 'Re-verify membership with the scheme; confirm member number with the patient by WhatsApp', exceptionFamily: 'Identity' },
  DEPENDANT_MISMATCH: { class: 'member', label: 'Dependant mismatch', path: 'verify_member', level: 'A3', suggestion: 'Correct the dependant code from the last benefit check and resubmit', exceptionFamily: 'Identity' },
  AUTH_REQ: { class: 'authorisation', label: 'Authorisation required', path: 'retro_auth', level: 'A3', suggestion: 'Request a retrospective authorisation and resubmit with the number', exceptionFamily: 'Funder rule' },
  ICD_MISSING: { class: 'coding', label: 'ICD-10 missing', path: 'recode', level: 'A1', suggestion: 'Coding Hand proposes a primary ICD-10 from the signed report; BIL confirms', exceptionFamily: 'Coding confidence' },
  ICD_INVALID: { class: 'coding', label: 'Invalid diagnosis for procedure', path: 'recode', level: 'A1', suggestion: 'Replace the symptom code with the diagnosis the report supports; BIL confirms', exceptionFamily: 'Funder rule' },
  AGE_SEX_EDIT: { class: 'coding', label: 'Age or sex edit', path: 'recode', level: 'A1', suggestion: 'Check patient demographics and the procedure; correct and resubmit', exceptionFamily: 'Data quality' },
  CONTRAST_NO_NAPPI: { class: 'coding', label: 'Contrast without consumable', path: 'recode', level: 'A1', suggestion: 'Add the NAPPI line from the nursing record', exceptionFamily: 'Coding confidence' },
  BENEFIT_EXHAUSTED: { class: 'benefit', label: 'Benefit exhausted', path: 'patient_liability', level: 'A3', suggestion: 'PMB check; if not PMB, transfer to patient liability with the scheme reason', exceptionFamily: 'Funder rule' },
  NOT_COVERED: { class: 'benefit', label: 'Not covered', path: 'patient_liability', level: 'A3', suggestion: 'Transfer to patient liability with an explanation, or appeal if PMB', exceptionFamily: 'Funder rule' },
  RATE_DIFFERENCE: { class: 'benefit', label: 'Paid at scheme rate', path: 'patient_liability', level: 'A3', suggestion: 'Balance to patient where balance billing is permitted', exceptionFamily: 'Funder rule' },
  PMB_DISPUTE: { class: 'benefit', label: 'PMB dispute', path: 'manual', level: 'A2', suggestion: 'Automatic PMB appeal with evidence pack; sample reviewed by BIL', exceptionFamily: 'Funder rule' },
  DUPLICATE: { class: 'duplicate', label: 'Duplicate claim', path: 'verify_duplicate', level: 'A1', suggestion: 'Verify; reverse if genuine, else resubmit with annotation', exceptionFamily: 'Data quality' },
  NEAR_DUPLICATE: { class: 'duplicate', label: 'Possible duplicate', path: 'verify_duplicate', level: 'A1', suggestion: 'Confirm the second study is distinct and submit', exceptionFamily: 'Data quality' },
  REFERRER_MISSING: { class: 'referrer', label: 'Referrer practice number missing', path: 'correct_referrer', level: 'A1', suggestion: 'Look up the referrer in the directory and back-fill the practice number', exceptionFamily: 'Referrer' },
  MISSING_FIELD: { class: 'technical', label: 'Required field missing', path: 'technical_retry', level: 'A3', suggestion: 'Complete the field from Platform data and resubmit', exceptionFamily: 'Technical' },
  TECHNICAL: { class: 'technical', label: 'Format or switch error', path: 'technical_retry', level: 'A4', suggestion: 'Claims Hand fixes the format and resubmits', exceptionFamily: 'Technical' },
  STALE: { class: 'late', label: 'Beyond submission window', path: 'writeoff_proposal', level: 'A0', suggestion: 'Appeal where the funder allows; else write-off proposal with root cause late_submission', exceptionFamily: 'Deadline' },
  LATE_SUBMISSION: { class: 'late', label: 'Late submission', path: 'writeoff_proposal', level: 'A0', suggestion: 'Write-off proposal with root cause; process failure, not a debtor failure', exceptionFamily: 'Deadline' },
  CLAIM_NUMBER_MISSING: { class: 'funder_class', label: 'Fund claim number missing', path: 'manual', level: 'A1', suggestion: 'Collections Hand requests the claim number from the employer', exceptionFamily: 'Funder class' },
  ATTORNEY_MISSING: { class: 'funder_class', label: 'Attorney details awaited', path: 'manual', level: 'A1', suggestion: 'Human-led per the RAF playbook', exceptionFamily: 'Funder class' },
  ABOVE_LEASH: { class: 'technical', label: 'Above auto-submission leash', path: 'manual', level: 'A1', suggestion: 'Human confirmation regardless of confidence', exceptionFamily: 'Funder rule' },
};

/** Funder response codes (as a switch returns them) mapped into the taxonomy. Unknown codes map to technical. */
export const FUNDER_RESPONSE_CODES: Record<string, ReasonCode> = {
  '4231': 'AUTH_REQ', '4232': 'ICD_INVALID', '4101': 'MEMBER_NOT_FOUND', '4102': 'DEPENDANT_MISMATCH', '4301': 'BENEFIT_EXHAUSTED', '4302': 'NOT_COVERED',
  '4303': 'RATE_DIFFERENCE', '4310': 'PMB_DISPUTE', '4401': 'DUPLICATE', '4501': 'REFERRER_MISSING', '4601': 'STALE', '4900': 'TECHNICAL', '4233': 'ICD_MISSING',
};
export function classifyFunderCode(code: string): { reason: ReasonCode; mapping: RejectionMapping } {
  const reason = FUNDER_RESPONSE_CODES[code] ?? (code as ReasonCode in REJECTION_TAXONOMY ? (code as ReasonCode) : 'TECHNICAL');
  return { reason, mapping: REJECTION_TAXONOMY[reason] };
}

/** Short-payment taxonomy (docs/09 §9.1) and routing policy. */
export type ShortPaymentClass = 'co_payment' | 'benefit_exhausted' | 'not_covered' | 'rate_difference' | 'pmb_dispute' | 'tariff_adjustment' | 'duplicate' | 'auth_penalty' | 'levy' | 'unknown';
export type ShortPaymentRoute = 'patient_liability' | 'appeal' | 'contractual_adjustment' | 'deb_review';
export const SHORT_PAYMENT_ROUTING: Record<ShortPaymentClass, ShortPaymentRoute> = {
  co_payment: 'patient_liability', benefit_exhausted: 'patient_liability', not_covered: 'patient_liability', rate_difference: 'patient_liability',
  pmb_dispute: 'appeal', auth_penalty: 'appeal', tariff_adjustment: 'contractual_adjustment', levy: 'contractual_adjustment', duplicate: 'deb_review', unknown: 'deb_review',
};
export function routeShortPayment(cls: ShortPaymentClass, balanceBillingAllowed = true): ShortPaymentRoute {
  const r = SHORT_PAYMENT_ROUTING[cls];
  if (r === 'patient_liability' && !balanceBillingAllowed) return 'contractual_adjustment';
  return r;
}
