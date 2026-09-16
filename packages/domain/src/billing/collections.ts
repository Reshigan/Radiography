/**
 * Debtors and collections (docs/processes/09 §10–11): ageing buckets, IFRS 9-style expected-credit-loss
 * provision matrix, propensity-to-pay score (Class 4: routes cadence and channel, never care), the
 * Collections Hand's dunning policy (contact windows, sequence, exclusions), payment plans (incidental
 * credit, no interest) and write-off / handover checks. Pure functions.
 */
import { addDays, daysBetween } from './rules.js';

export type DebtorClass = 'scheme' | 'patient' | 'raf' | 'coida' | 'corporate';
export type AgeingBucket = 'current' | '30' | '60' | '90' | '120+';
export const AGEING_BUCKETS: AgeingBucket[] = ['current', '30', '60', '90', '120+'];

export function ageingBucket(daysOutstanding: number): AgeingBucket {
  if (daysOutstanding < 30) return 'current';
  if (daysOutstanding < 60) return '30';
  if (daysOutstanding < 90) return '60';
  if (daysOutstanding < 120) return '90';
  return '120+';
}

export interface AgeableBalance {
  debtorClass: DebtorClass;
  balanceCents: number;
  /** Ageing start per class: scheme = submission, patient = notification, corporate = invoice, RAF = lodgement. */
  ageingStartAt: string;
  /** A plan on schedule is reported as current (docs/journeys/deb Scene 3). */
  planOnSchedule?: boolean;
}
export type AgeingMatrix = Record<DebtorClass, Record<AgeingBucket, number> & { total: number }>;

export function emptyMatrix(): AgeingMatrix {
  const row = () => ({ current: 0, '30': 0, '60': 0, '90': 0, '120+': 0, total: 0 });
  return { scheme: row(), patient: row(), raf: row(), coida: row(), corporate: row() };
}
export function ageBalances(balances: AgeableBalance[], asOf: string): AgeingMatrix {
  const m = emptyMatrix();
  for (const b of balances) {
    if (b.balanceCents <= 0) continue;
    const bucket = b.planOnSchedule ? 'current' : ageingBucket(Math.max(0, daysBetween(b.ageingStartAt, asOf)));
    m[b.debtorClass][bucket] += b.balanceCents;
    m[b.debtorClass].total += b.balanceCents;
  }
  return m;
}
export function ageingTotals(m: AgeingMatrix): Record<AgeingBucket, number> & { total: number } {
  const out = { current: 0, '30': 0, '60': 0, '90': 0, '120+': 0, total: 0 };
  for (const cls of Object.keys(m) as DebtorClass[]) for (const k of [...AGEING_BUCKETS, 'total'] as const) out[k] += m[cls][k];
  return out;
}

/** ECL loss rates (illustrative, calibrated from recoveries per Practice) by class and bucket. */
export type EclMatrix = Record<DebtorClass, Record<AgeingBucket, number>>;
export const DEFAULT_ECL_RATES: EclMatrix = {
  scheme: { current: 0.005, '30': 0.01, '60': 0.03, '90': 0.1, '120+': 0.35 },
  patient: { current: 0.03, '30': 0.08, '60': 0.18, '90': 0.35, '120+': 0.65 },
  raf: { current: 0.05, '30': 0.05, '60': 0.08, '90': 0.12, '120+': 0.38 },
  coida: { current: 0.03, '30': 0.04, '60': 0.06, '90': 0.1, '120+': 0.3 },
  corporate: { current: 0.005, '30': 0.01, '60': 0.05, '90': 0.15, '120+': 0.5 },
};
export interface EclProvision {
  lines: Array<{ debtorClass: DebtorClass; bucket: AgeingBucket; exposureCents: number; rate: number; provisionCents: number }>;
  totalExposureCents: number;
  totalProvisionCents: number;
}
export function eclProvision(m: AgeingMatrix, rates: EclMatrix = DEFAULT_ECL_RATES): EclProvision {
  const lines: EclProvision['lines'] = [];
  for (const cls of Object.keys(m) as DebtorClass[]) {
    for (const b of AGEING_BUCKETS) {
      const exposure = m[cls][b];
      if (!exposure) continue;
      lines.push({ debtorClass: cls, bucket: b, exposureCents: exposure, rate: rates[cls][b], provisionCents: Math.round(exposure * rates[cls][b]) });
    }
  }
  return { lines, totalExposureCents: lines.reduce((a, l) => a + l.exposureCents, 0), totalProvisionCents: lines.reduce((a, l) => a + l.provisionCents, 0) };
}

/* ---------- Propensity to pay (Class 4). Published feature list; never race, language or location. ---------- */
export interface PropensityInput {
  amountCents: number;
  daysOutstanding: number;
  priorPaymentsOnTime: number;
  priorDefaults: number;
  channelReachable: boolean; // WhatsApp/SMS/email consent and a working number
  openDispute: boolean;
  planStatus?: 'none' | 'active' | 'arrears' | 'completed';
  liabilityReason?: 'co_payment' | 'benefit_exhausted' | 'not_covered' | 'paid_to_member' | 'cash' | 'rate_difference' | 'practice_error' | 'other';
}
export interface PropensityScore {
  score: number; // 0..1 probability of payment within 60 days
  band: 'high' | 'medium' | 'low';
  p30: number;
  p60: number;
  p90: number;
  nextBestAction: 'paylink_first' | 'statement_then_plan' | 'callback_offer' | 'deb_review';
  features: Record<string, number | boolean | string>;
  modelId: 'ptp-score';
  modelVersion: '4.2';
}
export function propensityToPay(i: PropensityInput): PropensityScore {
  let logit = 1.1;
  logit -= Math.min(2.2, i.amountCents / 400000); // larger balances pay more slowly
  logit -= Math.min(1.5, i.daysOutstanding / 60);
  logit += Math.min(1.2, i.priorPaymentsOnTime * 0.4);
  logit -= Math.min(2, i.priorDefaults * 0.9);
  logit += i.channelReachable ? 0.5 : -0.9;
  if (i.openDispute) logit -= 0.8;
  if (i.planStatus === 'active') logit += 0.9;
  if (i.planStatus === 'arrears') logit -= 0.7;
  if (i.liabilityReason === 'paid_to_member') logit += 0.3;
  if (i.liabilityReason === 'practice_error') logit -= 3; // should never be dunned
  const p60 = 1 / (1 + Math.exp(-logit));
  const p30 = Math.max(0, p60 - 0.14);
  const p90 = Math.min(1, p60 + 0.08);
  const band = p60 >= 0.65 ? 'high' : p60 >= 0.4 ? 'medium' : 'low';
  const nextBestAction = i.openDispute ? 'deb_review' : band === 'high' ? 'paylink_first' : band === 'medium' ? 'statement_then_plan' : 'callback_offer';
  return {
    score: round3(p60), band, p30: round3(p30), p60: round3(p60), p90: round3(p90), nextBestAction,
    features: { amountCents: i.amountCents, daysOutstanding: i.daysOutstanding, priorPaymentsOnTime: i.priorPaymentsOnTime, priorDefaults: i.priorDefaults, channelReachable: i.channelReachable, openDispute: i.openDispute, planStatus: i.planStatus ?? 'none', liabilityReason: i.liabilityReason ?? 'other' },
    modelId: 'ptp-score', modelVersion: '4.2',
  };
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ---------- Dunning policy, contact windows, sequence, exclusions ---------- */
export type Channel = 'whatsapp' | 'sms' | 'email' | 'voice' | 'post';
export interface DunningPolicy {
  id: string;
  version: string;
  graceDays: number; // after statement before the sequence starts
  maxContactsPerWeek: number;
  windows: { weekdayStart: number; weekdayEnd: number; saturdayStart: number; saturdayEnd: number; sunday: false };
  channelOrder: Channel[];
  /** The Hand may create plans up to this amount; above it DEB approves. */
  maxPlanCents: number;
  maxPlanInstalments: number;
  minInstalmentCents: number;
  minHandoverCents: number;
  handoverAfterDays: number;
  prescriptionYears: number; // Prescription Act: 3 years for ordinary debts (docs/24)
  steps: DunningStep[];
}
export interface DunningStep {
  id: string;
  day: number; // days since notification (ageing start)
  action: 'statement' | 'reminder' | 'reminder_paylink' | 'callback_offer' | 'final_notice' | 'deb_review' | 'handover_proposal';
  channels: Channel[]; // in preference order
  offersPlan?: boolean;
}
export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  id: 'dunning-v7', version: '7', graceDays: 7, maxContactsPerWeek: 2,
  windows: { weekdayStart: 8, weekdayEnd: 20, saturdayStart: 8, saturdayEnd: 20, sunday: false },
  channelOrder: ['whatsapp', 'sms', 'email', 'voice', 'post'],
  maxPlanCents: 500000, maxPlanInstalments: 6, minInstalmentCents: 25000, minHandoverCents: 150000, handoverAfterDays: 90, prescriptionYears: 3,
  steps: [
    { id: 'statement', day: 0, action: 'statement', channels: ['whatsapp', 'sms', 'email'] },
    { id: 'day7', day: 7, action: 'reminder', channels: ['whatsapp', 'sms'], offersPlan: true },
    { id: 'day21', day: 21, action: 'reminder_paylink', channels: ['whatsapp', 'sms', 'voice'] },
    { id: 'day45', day: 45, action: 'final_notice', channels: ['email', 'post', 'whatsapp'] },
    { id: 'day60', day: 60, action: 'deb_review', channels: [] },
    { id: 'day90', day: 90, action: 'handover_proposal', channels: [] },
  ],
};

/** SAST wall-clock parts (Africa/Johannesburg has no DST: UTC+2). */
export function sastParts(iso: string | Date): { hour: number; minute: number; weekday: number; date: string } {
  const t = new Date(typeof iso === 'string' ? iso : iso.toISOString()).getTime() + 2 * 3600_000;
  const d = new Date(t);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(), date: d.toISOString().slice(0, 10) };
}
export function isWithinContactWindow(iso: string | Date, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): boolean {
  const { hour, weekday } = sastParts(iso);
  if (weekday === 0) return false;
  if (weekday === 6) return hour >= policy.windows.saturdayStart && hour < policy.windows.saturdayEnd;
  return hour >= policy.windows.weekdayStart && hour < policy.windows.weekdayEnd;
}
/** The instant itself if inside the window, else the next window opening (SAST). */
export function nextContactSlot(iso: string | Date, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): string {
  let t = new Date(typeof iso === 'string' ? iso : iso.toISOString()).getTime();
  for (let i = 0; i < 24 * 8; i++) {
    if (isWithinContactWindow(new Date(t), policy)) return new Date(t).toISOString();
    // jump to the next whole hour
    t = Math.floor(t / 3600_000) * 3600_000 + 3600_000;
  }
  return new Date(t).toISOString();
}

export function dunningStepFor(daysSinceNotification: number, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): DunningStep | null {
  let step: DunningStep | null = null;
  for (const s of policy.steps) if (daysSinceNotification >= s.day) step = s;
  return step;
}

export interface AccountForDunning {
  balanceCents: number;
  ageingStartAt: string;
  flags: string[]; // disputed | deceased | urgent_care | vulnerable | consent_withdrawn | practice_error | wrong_number | minor_no_guardian
  debtorClass: DebtorClass;
  lastContactAt?: string | null;
  contactsLast7d?: number;
  planStatus?: 'none' | 'active' | 'arrears' | 'completed';
  dueDate?: string; // when the debt became due (for prescription)
  consentChannels?: Channel[];
}
export type ExclusionReason = 'urgent_care' | 'disputed' | 'prescription_risk' | 'deceased' | 'vulnerable' | 'consent_withdrawn' | 'practice_error' | 'wrong_number' | 'minor_no_guardian' | 'long_cycle_receivable' | 'plan_active' | 'in_grace' | 'zero_balance' | 'frequency_cap' | 'prescribed';

/** Exclusions are enforced by the runtime, not the prompt (M14-R-161). */
export function collectionsExclusions(a: AccountForDunning, asOf: string, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): ExclusionReason[] {
  const out: ExclusionReason[] = [];
  if (a.balanceCents <= 0) out.push('zero_balance');
  if (a.debtorClass === 'raf' || a.debtorClass === 'coida') out.push('long_cycle_receivable');
  for (const f of ['urgent_care', 'disputed', 'deceased', 'vulnerable', 'consent_withdrawn', 'practice_error', 'wrong_number', 'minor_no_guardian'] as const) if (a.flags.includes(f)) out.push(f);
  const due = a.dueDate ?? a.ageingStartAt;
  const prescribes = addDays(due, policy.prescriptionYears * 365);
  const daysToPrescription = daysBetween(asOf, prescribes);
  if (daysToPrescription < 0) out.push('prescribed');
  else if (daysToPrescription < 90) out.push('prescription_risk');
  if (a.planStatus === 'active') out.push('plan_active');
  if (daysBetween(a.ageingStartAt, asOf) < policy.graceDays) out.push('in_grace');
  if ((a.contactsLast7d ?? 0) >= policy.maxContactsPerWeek) out.push('frequency_cap');
  return out;
}

export function chooseChannel(consent: Channel[] | undefined, step: DunningStep, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): Channel {
  const allowed = consent && consent.length ? consent : ['post' as Channel];
  for (const c of policy.channelOrder) if (step.channels.includes(c) && allowed.includes(c)) return c;
  return step.channels.find((c) => allowed.includes(c)) ?? 'post';
}

/* ---------- Payment plans: incidental credit, no interest ---------- */
export interface PlanInstalment { n: number; dueDate: string; amountCents: number; status: 'due' | 'paid' | 'missed'; paidAt?: string | null }
export function buildPlan(totalCents: number, instalments: number, firstDue: string, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): { instalments: PlanInstalment[]; instalmentCents: number; interestPct: 0; withinPolicy: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (instalments < 1) throw new Error('At least one instalment');
  if (instalments > policy.maxPlanInstalments) reasons.push(`more than ${policy.maxPlanInstalments} instalments`);
  const base = Math.floor(totalCents / instalments);
  if (base < policy.minInstalmentCents && instalments > 1) reasons.push(`instalment below minimum`);
  if (totalCents > policy.maxPlanCents) reasons.push('above the Hand plan leash');
  const out: PlanInstalment[] = [];
  let remaining = totalCents;
  for (let n = 1; n <= instalments; n++) {
    const amount = n === instalments ? remaining : base;
    remaining -= amount;
    out.push({ n, dueDate: addMonths(firstDue, n - 1), amountCents: amount, status: 'due' });
  }
  return { instalments: out, instalmentCents: base, interestPct: 0, withinPolicy: reasons.length === 0, reasons };
}
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/* ---------- Write-offs and handover ---------- */
export type WriteOffReason = 'uncollectable' | 'deceased_no_estate' | 'prescribed' | 'late_submission_loss' | 'goodwill' | 'small_balance' | 'funder_contractual' | 'quote_honoured_practice_error' | 'funder_rule_change_practice_absorbs' | 'raf_tariff_shortfall';
/** Approval limits by role (illustrative). */
export const WRITE_OFF_LIMITS: Record<string, number> = { DEB: 50000, PRM: 500000, EXE: Number.MAX_SAFE_INTEGER };
export function writeOffApprover(amountCents: number): 'DEB' | 'PRM' | 'EXE' {
  if (amountCents <= WRITE_OFF_LIMITS.DEB!) return 'DEB';
  if (amountCents <= WRITE_OFF_LIMITS.PRM!) return 'PRM';
  return 'EXE';
}

export interface HandoverChecklist {
  statementDelivered: boolean;
  finalNoticeDelivered: boolean;
  noOpenDispute: boolean;
  notVulnerable: boolean;
  notPracticeError: boolean;
  notLongCycle: boolean;
  aboveMinimum: boolean;
  notPrescribed: boolean;
  sequenceComplete: boolean;
}
export function handoverChecklist(a: AccountForDunning & { delivered: string[]; daysSinceNotification: number }, asOf: string, policy: DunningPolicy = DEFAULT_DUNNING_POLICY): { checklist: HandoverChecklist; clean: boolean; failing: string[] } {
  const ex = collectionsExclusions(a, asOf, policy);
  const checklist: HandoverChecklist = {
    statementDelivered: a.delivered.includes('statement'),
    finalNoticeDelivered: a.delivered.includes('final_notice'),
    noOpenDispute: !ex.includes('disputed'),
    notVulnerable: !ex.includes('vulnerable') && !ex.includes('deceased') && !ex.includes('minor_no_guardian'),
    notPracticeError: !ex.includes('practice_error'),
    notLongCycle: !ex.includes('long_cycle_receivable'),
    aboveMinimum: a.balanceCents >= policy.minHandoverCents,
    notPrescribed: !ex.includes('prescribed'),
    sequenceComplete: a.daysSinceNotification >= policy.handoverAfterDays,
  };
  const failing = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
  return { checklist, clean: failing.length === 0, failing };
}
