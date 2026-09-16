/** Cluster C seeder: M14 Revenue Cycle and M15 Finance. Idempotent; synthetic SA demo data. */
import { eq } from 'drizzle-orm';
import { newId } from '@bonakala/domain';
import {
  ageBalances, buildPlan, buildSchedule, computePnl, distributionWaterfall, eclProvision, intercompanyAmount, periodBounds, previousPeriods, priceCharge, propensityToPay, rulePackInForce, solvencyLiquidityTest,
  BASE_RATE_CENTS, DEFAULT_DUNNING_POLICY, TARIFF_BY_CODE, type AgeableBalance, type DebtorClass, type FeeSchedule, type FunderType,
} from '@bonakala/domain/billing';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import { rng, pick } from './data.js';

const FUNDERS: Array<{ id: string; type: FunderType; weight: number }> = [
  { id: 'scheme-a', type: 'scheme', weight: 32 }, { id: 'scheme-b', type: 'scheme', weight: 26 }, { id: 'scheme-c', type: 'scheme', weight: 16 },
  { id: 'cash', type: 'cash', weight: 14 }, { id: 'raf', type: 'raf', weight: 5 }, { id: 'coida', type: 'coida', weight: 4 }, { id: 'corporate', type: 'corporate', weight: 3 },
];
const CT_CODES = ['34100', '34101', '34200', '34300', '34320', '34400'];
const PROC_MIX: Array<{ code: string; weight: number }> = [
  { code: '30110', weight: 18 }, { code: '30120', weight: 7 }, { code: '30130', weight: 5 }, { code: '30140', weight: 7 }, { code: '30150', weight: 6 }, { code: '30160', weight: 4 },
  { code: '34100', weight: 8 }, { code: '34101', weight: 4 }, { code: '34200', weight: 4 }, { code: '34300', weight: 4 }, { code: '34320', weight: 6 }, { code: '34400', weight: 4 },
  { code: '35100', weight: 4 }, { code: '35110', weight: 5 }, { code: '35120', weight: 3 },
  { code: '33020', weight: 6 }, { code: '33030', weight: 3 }, { code: '33040', weight: 3 }, { code: '39120', weight: 5 }, { code: '39200', weight: 2 },
];
const ICD_BY_REGION: Record<string, string[]> = {
  chest: ['J18.9', 'J44.1', 'R07.4'], brain: ['G43.9', 'I63.9', 'S06.0'], cspine: ['M50.1', 'S12.9'], lspine: ['M51.1', 'M54.5'], knee: ['M23.2', 'S83.5'],
  wrist: ['S62.1', 'M25.53'], abdomen: ['K80.2', 'K35.8', 'R10.4'], pelvis: ['N83.2', 'N80.0'], obstetric: ['Z36.8', 'O26.8'], breast: ['Z12.3', 'N63'], spine_hip: ['M81.0'],
};
const SYMPTOM_PRIMARY = ['R51', 'R10.4', 'R52'];

function weighted<T extends { weight: number }>(r: () => number, arr: T[]): T {
  const total = arr.reduce((a, x) => a + x.weight, 0);
  let n = r() * total;
  for (const x of arr) { n -= x.weight; if (n <= 0) return x; }
  return arr[arr.length - 1]!;
}
const dayIso = (base: Date, offsetDays: number) => new Date(base.getTime() - offsetDays * 86400_000).toISOString();
const dayOnly = (iso: string) => iso.slice(0, 10);
const periodOf = (iso: string) => iso.slice(0, 7);

export async function seedClusterC(db: Db, ctx: SeedContext): Promise<Record<string, number> | void> {
  const existing = await db.select({ id: s.charges.id }).from(s.charges).limit(1);
  if (existing.length) {
    const claims = await db.select({ id: s.claims.id, claimRef: s.claims.claimRef, practiceId: s.claims.practiceId, status: s.claims.status }).from(s.claims);
    ctx.extra.claims = claims;
    return;
  }
  const r = rng(314);
  const now = new Date(ctx.now);
  const summary: Record<string, number> = {};

  /* ---------------- Fee schedules ---------------- */
  const schedules: FeeSchedule[] = [];
  const scheduleDefs: Array<{ funderId: string; type: FunderType; name: string; kind: FeeSchedule['kind']; uplift: number; from: string; version: number; to?: string }> = [
    { funderId: 'scheme-a', type: 'scheme', name: 'Scheme A rate 2026', kind: 'scheme_rate', uplift: 0, from: '2026-01-01', version: 2 },
    { funderId: 'scheme-a', type: 'scheme', name: 'Scheme A rate 2025', kind: 'scheme_rate', uplift: -6, from: '2025-01-01', to: '2025-12-31', version: 1 },
    { funderId: 'scheme-b', type: 'scheme', name: 'Scheme B negotiated (DSP)', kind: 'negotiated', uplift: -8, from: '2026-02-01', version: 1 },
    { funderId: 'scheme-c', type: 'scheme', name: 'Scheme C rate 150 %', kind: 'scheme_rate', uplift: 50, from: '2026-01-01', version: 1 },
    { funderId: 'cash', type: 'cash', name: 'Cash price list 2026', kind: 'cash', uplift: 20, from: '2026-01-01', version: 1 },
    { funderId: 'raf', type: 'raf', name: 'RAF tariff 2026', kind: 'raf', uplift: -15, from: '2026-01-01', version: 1 },
    { funderId: 'coida', type: 'coida', name: 'COIDA tariff 2026', kind: 'coida', uplift: -10, from: '2026-01-01', version: 1 },
    { funderId: 'corporate', type: 'corporate', name: 'Occupational health contract', kind: 'corporate', uplift: -20, from: '2026-01-01', version: 1 },
  ];
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    for (const d of scheduleDefs) {
      const id = `fs_${practiceId}_${d.funderId}_v${d.version}`;
      await db.insert(s.feeSchedules).values({
        id, practiceId, funderId: d.funderId, funderType: d.type, name: d.name, kind: d.kind, version: d.version, effectiveFrom: d.from, effectiveTo: d.to ?? null,
        upliftPct: d.uplift, status: d.to ? 'superseded' : 'active', approvedBy: ctx.users.PRM ?? null, approvedAt: ctx.now, notes: 'Illustrative DEMO reference data',
      });
      const built = buildSchedule({ id, practiceId, funderId: d.funderId, funderType: d.type, name: d.name, kind: d.kind, version: d.version, effectiveFrom: d.from, effectiveTo: d.to ?? null, upliftPct: d.uplift });
      for (const l of built.lines) {
        await db.insert(s.feeScheduleLines).values({ id: newId('fsl'), practiceId, scheduleId: id, code: l.code, description: TARIFF_BY_CODE[l.code]?.description ?? null, priceExclCents: l.priceExclCents, unit: 'per_unit' });
      }
      if (!d.to) schedules.push({ ...built, status: 'active' });
    }
  }
  summary.feeSchedules = scheduleDefs.length * 2;
  summary.feeScheduleLines = Object.keys(BASE_RATE_CENTS).length * scheduleDefs.length * 2;

  const scheduleFor = (practiceId: string, funderId: string) => schedules.find((x) => x.practiceId === practiceId && x.funderId === funderId)!;

  /* ---------------- Patients with funder context ---------------- */
  const patients = await db.select().from(s.patients);
  const patientsBy: Record<string, typeof patients> = { [ctx.practiceA]: [], [ctx.practiceB]: [] };
  for (const p of patients) (patientsBy[p.practiceId] ??= []).push(p);

  const reports = (ctx.extra.reports as Array<{ reportId: string; studyId: string; accession?: string; patientId: string; practiceId: string; siteId?: string; referrerId?: string; radiologistUserId?: string; procedureCodes?: string[]; icd10?: string[]; signedAt?: string }> | undefined) ?? [];
  const orders = (ctx.extra.orders as Array<{ orderId: string; patientId: string; practiceId: string; siteId?: string; referrerId?: string; procedures?: Array<{ code?: string }> }> | undefined) ?? [];

  /* ---------------- Charges and claims over 60 days ---------------- */
  interface Plan { practiceId: string; siteId: string; patientId: string; funderId: string; funderType: FunderType; codes: string[]; icd10: string[]; serviceDate: string; status: string; reportId: string | null; studyId: string | null; orderId: string | null; accession: string | null; referrerId: string; radiologistUserId: string }
  const plans: Plan[] = [];
  const sitesByPractice: Record<string, string[]> = { [ctx.practiceA]: [ctx.sites.SAN, ctx.sites.RBG], [ctx.practiceB]: [ctx.sites.UMH, ctx.sites.BAL] };
  const TOTAL = 320;
  for (let i = 0; i < TOTAL; i++) {
    const practiceId = i % 5 < 2 ? ctx.practiceA : ctx.practiceB;
    const pats = patientsBy[practiceId]!;
    const patient = pats[Math.floor(r() * pats.length)]!;
    const offset = Math.floor(r() * 60);
    const serviceDate = dayOnly(dayIso(now, offset));
    const funder = weighted(r, FUNDERS);
    // Honour the patient's own scheme where the funder is a scheme
    const funderId = funder.type === 'scheme' ? (patient.schemeId && ['scheme-a', 'scheme-b', 'scheme-c'].includes(patient.schemeId) ? patient.schemeId : funder.id) : funder.id;
    const funderType: FunderType = funderId.startsWith('scheme') ? 'scheme' : (funderId as FunderType);
    const codes = [weighted(r, PROC_MIX).code];
    if (r() < 0.16) { const second = weighted(r, PROC_MIX).code; if (second !== codes[0]) codes.push(second); }
    const region = TARIFF_BY_CODE[codes[0]!]?.bodyRegion ?? 'chest';
    const icd = ICD_BY_REGION[region] ?? ['Z01.6'];
    const report = reports[i];
    plans.push({
      practiceId, siteId: pick(r, sitesByPractice[practiceId]!), patientId: report?.patientId && report.practiceId === practiceId ? report.patientId : patient.id, funderId, funderType,
      codes: report?.procedureCodes?.filter((cd) => TARIFF_BY_CODE[cd]?.kind === 'procedure').length ? report.procedureCodes.filter((cd) => TARIFF_BY_CODE[cd]?.kind === 'procedure') : codes,
      icd10: report?.icd10?.length ? report.icd10 : [pick(r, icd)], serviceDate, status: 'pending',
      reportId: report?.reportId ?? null, studyId: report?.studyId ?? null, orderId: orders[i]?.orderId ?? null, accession: report?.accession ?? null,
      referrerId: pick(r, ctx.referrers), radiologistUserId: practiceId === ctx.practiceA ? (ctx.users.RGT2 ?? ctx.users.RGT!) : ctx.users.RGT!,
    });
  }
  if (!plans.length) return;

  // Rejection wave cohort: Scheme B CT claims in the last 14 days rejected for AUTH_REQ.
  const waveWindowStart = dayOnly(dayIso(now, 14));
  const waveCandidates = plans.filter((p) => p.funderId === 'scheme-b' && p.serviceDate >= waveWindowStart && p.codes.some((cd) => CT_CODES.includes(cd)));
  const recentWave = plans.filter((p) => p.funderId === 'scheme-b' && p.serviceDate >= waveWindowStart);
  // Force enough Scheme B CT claims in the recent window
  for (let i = 0; i < recentWave.length && waveCandidates.length < 12; i++) {
    const p = recentWave[i]!;
    if (!p.codes.some((cd) => CT_CODES.includes(cd))) { p.codes = [pick(r, CT_CODES)]; p.icd10 = [pick(r, ICD_BY_REGION[TARIFF_BY_CODE[p.codes[0]!]?.bodyRegion ?? 'brain'] ?? ['G43.9'])]; waveCandidates.push(p); }
  }
  const waveSet = new Set(waveCandidates.slice(0, 12));

  const patientById = new Map(patients.map((p) => [p.id, p]));
  const entities = await db.select().from(s.legalEntities);
  const sites = await db.select().from(s.sites);
  const referrers = await db.select().from(s.referrers);
  const users = await db.select().from(s.users);

  let claimSeq = 0;
  let accountSeq = 0;
  let receiptSeq = 0;
  const accountsByPatient = new Map<string, { id: string; practiceId: string; patientId: string; balanceCents: number; debtorClass: DebtorClass; ageingStartAt: string; flags: string[]; liabilityReason: string | null }>();
  const claimRows: Array<{ id: string; claimRef: string; practiceId: string; status: string; funderId: string }> = [];
  const journalValues: Array<typeof s.journals.$inferInsert> = [];
  const txnValues: Array<typeof s.accountTransactions.$inferInsert> = [];
  let chargeCount = 0, claimCount = 0;

  async function accountFor(practiceId: string, patientId: string, debtorClass: DebtorClass, at: string) {
    const key = `${practiceId}:${patientId}:${debtorClass}`;
    if (accountsByPatient.has(key)) return accountsByPatient.get(key)!;
    const p = patientById.get(patientId);
    const id = newId('acc');
    accountSeq++;
    const consents = (p?.consents ?? {}) as Record<string, { granted: boolean }>;
    const channels: string[] = [];
    if (consents.popia?.granted !== false) channels.push('whatsapp');
    channels.push('sms');
    if (p?.email) channels.push('email');
    const row = { id, practiceId, patientId, balanceCents: 0, debtorClass, ageingStartAt: at, flags: [] as string[], liabilityReason: null as string | null };
    await db.insert(s.patientAccounts).values({
      id, practiceId, patientId, accountNo: `ACC-${practiceId === ctx.practiceA ? 'A' : 'B'}-${204000 + accountSeq}`, debtorClass, debtorName: p ? `${p.lastName}, ${p.firstName}` : patientId,
      balanceCents: 0, ageingStartAt: at, dueDate: dayOnly(at), flags: [], consentChannels: channels, language: p?.language ?? 'en', delivered: [], status: 'open',
    });
    accountsByPatient.set(key, row);
    return row;
  }
  async function postTxn(acc: { id: string; practiceId: string; patientId: string; balanceCents: number }, type: string, amountCents: number, description: string, at: string, opts: { reason?: string; refType?: string; refId?: string; arithmetic?: Record<string, unknown> } = {}) {
    txnValues.push({ id: newId('txn'), practiceId: acc.practiceId, accountId: acc.id, patientId: acc.patientId, type, amountCents, refType: opts.refType ?? null, refId: opts.refId ?? null, description, reason: opts.reason ?? null, arithmetic: opts.arithmetic ?? null, at, createdAt: at });
    acc.balanceCents += amountCents;
  }

  for (const p of plans) {
    const schedule = scheduleFor(p.practiceId, p.funderId);
    const pack = rulePackInForce(p.funderId, p.serviceDate);
    const patient = patientById.get(p.patientId);
    const pmb = p.icd10.some((cd) => pack.pmbCodes.some((x) => cd.toUpperCase().startsWith(x)));
    const priced = priceCharge({ procedures: p.codes.map((code) => ({ code })), funderType: p.funderType, pmb }, schedule, pack.pricing);
    const ageDays = Math.round((now.getTime() - new Date(p.serviceDate).getTime()) / 86400_000);
    const inWave = waveSet.has(p);
    const chargeId = newId('chg');
    const signedAt = dayIso(now, ageDays - 0.2);

    // Lifecycle: older charges are further along.
    let chargeStatus = 'claimed';
    let claimStatus: string | null = 'submitted';
    let codingStatus: 'auto_accepted' | 'proposed' = 'auto_accepted';
    let confidence = 0.95 + r() * 0.045;
    let exception: Record<string, unknown> | null = null;
    let blockingReason: string | null = null;
    let owner: string | null = null;
    const roll = r();

    if (['raf', 'coida', 'corporate'].includes(p.funderType)) {
      // Long-cycle / human-led classes
      if (roll < 0.45) { chargeStatus = 'coded'; claimStatus = null; codingStatus = 'proposed'; confidence = 0.62 + r() * 0.2; blockingReason = `${p.funderType}_a1_by_policy`; owner = 'BIL';
        exception = { family: 'Funder class', reason: p.funderType === 'raf' ? 'Attorney details awaited' : p.funderType === 'coida' ? 'Employer incident details and Fund claim number missing' : 'Purchase order reference missing', code: 'CLAIM_NUMBER_MISSING', suggestion: p.funderType === 'raf' ? 'Human-led per the RAF playbook' : 'Collections Hand requests the details from the employer', openedAt: signedAt };
      } else claimStatus = 'submitted';
    } else if (ageDays <= 1 && roll < 0.55) {
      chargeStatus = 'unbilled'; claimStatus = null; blockingReason = 'awaiting_coding'; owner = 'coding-hand';
    } else if (roll < 0.09) {
      // coding exception
      chargeStatus = 'coded'; claimStatus = null; codingStatus = 'proposed'; confidence = 0.58 + r() * 0.3; blockingReason = 'coding_confidence'; owner = 'BIL';
      const contrastExtra = p.codes.some((cd) => TARIFF_BY_CODE[cd]?.contrast);
      exception = contrastExtra
        ? { family: 'Coding confidence', reason: 'Report describes an extra contrast phase not on the order', code: 'CONFIDENCE', suggestion: 'Add the delayed-phase line 34322 × 1 if the report supports it', openedAt: signedAt }
        : { family: r() < 0.5 ? 'Referrer' : 'Identity', reason: r() < 0.5 ? 'Referring practitioner practice number missing' : 'Member number on file does not match the scheme response', code: r() < 0.5 ? 'REFERRER_MISSING' : 'MEMBER_NOT_FOUND', suggestion: 'Look up the referrer in the directory, or confirm the member number with the patient', openedAt: signedAt };
    } else if (roll < 0.14) {
      chargeStatus = 'ready'; claimStatus = 'scrubbed';
    }

    await db.insert(s.charges).values({
      id: chargeId, practiceId: p.practiceId, siteId: p.siteId, patientId: p.patientId, studyId: p.studyId, reportId: p.reportId, orderId: p.orderId, accession: p.accession,
      serviceDate: p.serviceDate, modality: TARIFF_BY_CODE[p.codes[0]!]?.modality ?? null, procedureCodes: p.codes, icd10: p.icd10, funderId: p.funderId, funderType: p.funderType,
      memberNo: patient?.memberNo ?? null, dependantCode: patient?.dependantCode ?? '00', referrerId: p.referrerId, radiologistUserId: p.radiologistUserId,
      lines: priced.lines as unknown as Array<Record<string, unknown>>, subtotalExclCents: priced.subtotalExclCents, vatCents: priced.vatCents, totalCents: priced.totalCents,
      expectedFunderCents: priced.expectedFunderCents, expectedPatientCents: priced.expectedPatientCents, patientPortionReason: priced.patientPortionReason, scheduleId: schedule.id,
      status: chargeStatus, blockingReason, owner, exception: exception as never,
      coding: {
        modelId: 'coding-hand', modelVersion: '2026.09.2', confidence: Math.round(confidence * 100) / 100, outputClass: 2, rulePackVersion: pack.version,
        evidence: [`Procedure codes from the signed report: ${p.codes.join(', ')}`, `ICD-10 from the signed report: ${p.icd10.join(', ')}`], proposedCodes: p.codes, proposedIcd10: p.icd10,
        status: codingStatus, acceptedBy: codingStatus === 'auto_accepted' ? 'coding-hand' : null, acceptedAt: codingStatus === 'auto_accepted' ? signedAt : null, demo: true, llmUsed: false,
        gate: { confidenceOk: confidence >= 0.95, scrubOk: !exception, exclusion: blockingReason?.includes('a1_by_policy') ? blockingReason : null },
      },
      createdAt: signedAt, updatedAt: signedAt,
    });
    chargeCount++;

    journalValues.push({ id: newId('jnl'), practiceId: p.practiceId, period: periodOf(p.serviceDate), source: 'm14', sourceRef: chargeId, eventName: 'charge.captured.v1', description: `Revenue recognised for charge ${chargeId}`, lines: [
      { account: p.funderType === 'scheme' ? '1100' : p.funderType === 'cash' ? '1110' : p.funderType === 'corporate' ? '1130' : '1120', debitCents: priced.totalCents, creditCents: 0, dimensions: { practice: p.practiceId, site: p.siteId, funderType: p.funderType } },
      { account: p.funderType === 'scheme' ? '4000' : p.funderType === 'cash' ? '4010' : p.funderType === 'corporate' ? '4030' : '4020', debitCents: 0, creditCents: priced.subtotalExclCents, dimensions: { practice: p.practiceId, site: p.siteId, funderType: p.funderType } },
      { account: '2100', debitCents: 0, creditCents: priced.vatCents, dimensions: { practice: p.practiceId } },
    ], status: 'posted', postedAt: signedAt, postedBy: 'posting-rules', createdAt: signedAt });

    if (!claimStatus) {
      // Cash charges with no claim still create a patient balance at the desk.
      if (p.funderType === 'cash' && chargeStatus !== 'unbilled') {
        const acc = await accountFor(p.practiceId, p.patientId, 'patient', signedAt);
        await postTxn(acc, 'invoice', priced.totalCents, `Invoice: ${p.codes.map((cd) => TARIFF_BY_CODE[cd]?.patientDescription ?? cd).join(', ')}`, signedAt, { reason: 'cash', refType: 'charge', refId: chargeId, arithmetic: { totalCents: priced.totalCents, schemePaidCents: 0, patientOwesCents: priced.totalCents, reason: 'Cash patient: the full amount is payable' } });
        acc.liabilityReason = 'cash';
      }
      continue;
    }

    claimSeq++;
    const claimId = newId('clm');
    const claimRef = `${p.practiceId === ctx.practiceA ? 'A' : 'B'}-${String(18000 + claimSeq).padStart(6, '0')}`;
    const entity = entities.find((e) => e.id === p.practiceId);
    const site = sites.find((x) => x.id === p.siteId);
    const referrer = referrers.find((x) => x.id === p.referrerId);
    const rad = users.find((x) => x.id === p.radiologistUserId);
    const needsAuth = p.codes.some((cd) => pack.authRequiredCodes.includes(cd));
    const authRef = needsAuth && !inWave ? `RA-${p.funderId.slice(-1).toUpperCase()}-${3000 + claimSeq}` : null;
    const fields = {
      practiceNo: entity?.bhfPracticeNo ?? null, treatingProviderNo: rad?.hpcsaNo ?? 'MP 0456789', referrerNo: referrer?.bhfPracticeNo ?? null, memberNo: patient?.memberNo ?? null,
      dependantCode: patient?.dependantCode ?? '00', serviceDate: p.serviceDate, siteCode: site?.code ?? null, patientDob: patient?.dateOfBirth ?? null, authRef,
    };
    const staleDate = pack.staleClaimDays ? dayOnly(new Date(new Date(p.serviceDate).getTime() + pack.staleClaimDays * 86400_000).toISOString()) : null;
    const submittedAt = claimStatus === 'scrubbed' ? null : dayIso(now, Math.max(0, ageDays - 1));
    let respondedAt: string | null = null;
    let paidCents = 0;
    let rejectionCode: string | null = null;
    let rejectionClass: string | null = null;
    let rejectionReason: string | null = null;
    let claimException: Record<string, unknown> | null = null;
    const channel = pack.realtime && p.funderType === 'scheme' ? 'realtime' : p.funderType === 'scheme' ? 'batch' : 'portal';

    if (claimStatus === 'submitted') {
      const respRoll = r();
      if (inWave) {
        claimStatus = 'rejected'; respondedAt = dayIso(now, Math.max(0, ageDays - 2));
        rejectionCode = r() < 0.72 ? 'AUTH_REQ' : 'ICD_INVALID';
        rejectionClass = rejectionCode === 'AUTH_REQ' ? 'authorisation' : 'coding';
        rejectionReason = rejectionCode === 'AUTH_REQ' ? 'Pre-authorisation number required for out-of-hospital CT (circular 14/2026)' : 'Invalid diagnosis for procedure: symptom code not accepted as primary';
        if (rejectionCode === 'ICD_INVALID') p.icd10 = [pick(r, SYMPTOM_PRIMARY)];
        claimException = {
          family: 'Funder rule', reason: rejectionReason, code: rejectionCode,
          suggestion: rejectionCode === 'AUTH_REQ' ? `Attach a retrospective authorisation for ${p.codes.filter((cd) => CT_CODES.includes(cd)).join(', ')} and resubmit in the next batch` : 'Replace the symptom code with the diagnosis the signed report supports, then resubmit',
          path: rejectionCode === 'AUTH_REQ' ? 'retro_auth' : 'recode', level: rejectionCode === 'AUTH_REQ' ? 'A3' : 'A1', openedAt: respondedAt,
          provenance: { modelId: 'coding-hand', modelVersion: '2026.09.2', confidence: rejectionCode === 'AUTH_REQ' ? 0.93 : 0.88, outputClass: 2, demo: true },
        };
        chargeStatus = 'rejected';
      } else if (respRoll < 0.025) {
        claimStatus = 'rejected'; respondedAt = dayIso(now, Math.max(0, ageDays - 2));
        const pickCode = r();
        rejectionCode = pickCode < 0.3 ? 'MEMBER_NOT_FOUND' : pickCode < 0.55 ? 'BENEFIT_EXHAUSTED' : pickCode < 0.75 ? 'REFERRER_MISSING' : pickCode < 0.9 ? 'DUPLICATE' : 'TECHNICAL';
        rejectionClass = rejectionCode === 'MEMBER_NOT_FOUND' ? 'member' : rejectionCode === 'BENEFIT_EXHAUSTED' ? 'benefit' : rejectionCode === 'REFERRER_MISSING' ? 'referrer' : rejectionCode === 'DUPLICATE' ? 'duplicate' : 'technical';
        rejectionReason = ({ MEMBER_NOT_FOUND: 'Member not found', BENEFIT_EXHAUSTED: 'Benefit exhausted for the year', REFERRER_MISSING: 'Referring practitioner practice number invalid', DUPLICATE: 'Duplicate claim', TECHNICAL: 'Batch format error' } as Record<string, string>)[rejectionCode]!;
        claimException = { family: rejectionCode === 'MEMBER_NOT_FOUND' ? 'Identity' : rejectionCode === 'REFERRER_MISSING' ? 'Referrer' : rejectionCode === 'DUPLICATE' ? 'Data quality' : rejectionCode === 'TECHNICAL' ? 'Technical' : 'Funder rule', reason: rejectionReason, code: rejectionCode, suggestion: 'See the rejection taxonomy for the auto-fix path', path: 'manual', level: 'A1', openedAt: respondedAt };
        chargeStatus = 'rejected';
      } else if (respRoll < 0.045) {
        claimStatus = 'pended'; respondedAt = dayIso(now, Math.max(0, ageDays - 2));
        claimException = { family: 'Funder rule', reason: 'Pended for clinical review (high value)', code: 'PENDED', suggestion: 'Claims Hand issues a status enquiry after the expected adjudication time', path: 'manual', level: 'A3', openedAt: respondedAt };
      } else if (ageDays > 12 && respRoll < 0.88) {
        claimStatus = 'paid'; respondedAt = dayIso(now, Math.max(0, ageDays - 3)); paidCents = priced.expectedFunderCents; chargeStatus = 'paid';
      } else if (ageDays > 12 && respRoll < 0.92) {
        claimStatus = 'short_paid'; respondedAt = dayIso(now, Math.max(0, ageDays - 3)); paidCents = Math.round(priced.expectedFunderCents * (0.62 + r() * 0.2)); chargeStatus = 'partially_paid';
      } else if (ageDays > 3) {
        claimStatus = 'accepted'; respondedAt = dayIso(now, Math.max(0, ageDays - 2));
      }
    }

    await db.insert(s.claims).values({
      id: claimId, practiceId: p.practiceId, claimRef, chargeId, patientId: p.patientId, siteId: p.siteId, funderId: p.funderId, funderType: p.funderType, memberNo: fields.memberNo, dependantCode: fields.dependantCode,
      icd10: p.icd10, lines: priced.lines as unknown as Array<Record<string, unknown>>, fields, totalCents: priced.totalCents, expectedFunderCents: priced.expectedFunderCents, expectedPatientCents: priced.expectedPatientCents,
      paidCents, status: claimStatus, channel, switchRef: submittedAt ? `${(0x7f21 + claimSeq).toString(16).toUpperCase()}-${(0x88a0 + claimSeq).toString(16).toUpperCase()}` : null,
      responseCodes: rejectionCode ? [rejectionCode] : null, submittedAt, respondedAt, serviceDate: p.serviceDate, staleDate, rulePackVersion: pack.version,
      rejectionCode, rejectionClass, rejectionReason, exception: claimException as never, pmb, submittedBy: 'hand:claims', createdAt: signedAt, updatedAt: respondedAt ?? submittedAt ?? signedAt,
      scrub: { pass: !claimException, errors: claimException ? 1 : 0, warnings: 0, fixes: 0, rulePackId: pack.id, rulePackVersion: pack.version, staleDate, findings: [] },
    });
    await db.update(s.charges).set({ claimId, status: chargeStatus }).where(eq(s.charges.id, chargeId));
    claimCount++;
    claimRows.push({ id: claimId, claimRef, practiceId: p.practiceId, status: claimStatus, funderId: p.funderId });

    if (submittedAt) await db.insert(s.claimResponses).values({ id: newId('rsp'), practiceId: p.practiceId, claimId, channel, receivedAt: submittedAt, outcome: 'acknowledged', switchRef: `ACK-${claimSeq}`, message: 'Technical acknowledgement', createdAt: submittedAt });
    if (respondedAt) {
      await db.insert(s.claimResponses).values({
        id: newId('rsp'), practiceId: p.practiceId, claimId, channel, receivedAt: respondedAt, outcome: claimStatus === 'paid' || claimStatus === 'short_paid' ? 'paid' : claimStatus === 'rejected' ? 'rejected' : claimStatus === 'pended' ? 'pended' : 'accepted',
        code: rejectionCode === 'AUTH_REQ' ? '4231' : rejectionCode === 'ICD_INVALID' ? '4232' : rejectionCode === 'MEMBER_NOT_FOUND' ? '4101' : rejectionCode === 'BENEFIT_EXHAUSTED' ? '4301' : rejectionCode === 'REFERRER_MISSING' ? '4501' : rejectionCode === 'DUPLICATE' ? '4401' : rejectionCode === 'TECHNICAL' ? '4900' : null,
        message: rejectionReason ?? (claimStatus === 'short_paid' ? 'Paid at scheme rate' : 'Accepted'), rule: inWave ? (rejectionCode === 'AUTH_REQ' ? 'SB-CT-OOH-2026-09' : 'SB-ICD-2026-09') : null,
        switchRef: `${(0x7f21 + claimSeq).toString(16).toUpperCase()}`, paidCents: paidCents || null, createdAt: respondedAt,
      });
    }

    // Patient liability from co-payments, short-payments and cash
    const liabilityAt = respondedAt ?? submittedAt ?? signedAt;
    if (claimStatus === 'short_paid') {
      const short = priced.expectedFunderCents - paidCents;
      const acc = await accountFor(p.practiceId, p.patientId, 'patient', liabilityAt);
      const amount = short + priced.expectedPatientCents;
      await postTxn(acc, 'transfer', amount, 'Patient liability: scheme paid at scheme rate; provider rate is above scheme rate', liabilityAt, { reason: 'rate_difference', refType: 'claim', refId: claimId, arithmetic: { lines: priced.lines.map((l) => ({ code: l.code, description: l.description, quantity: l.quantity, inclCents: l.inclCents })), totalCents: priced.totalCents, schemePaidCents: paidCents, adjustmentsCents: 0, patientOwesCents: amount, reason: 'Scheme paid at scheme rate, provider charges above scheme rate' } });
      acc.liabilityReason = 'rate_difference';
      journalValues.push({ id: newId('jnl'), practiceId: p.practiceId, period: periodOf(dayOnly(liabilityAt)), source: 'm14', sourceRef: claimId, eventName: 'claim.short_paid.v1', description: 'Contractual adjustment (rate_difference)', lines: [{ account: '4100', debitCents: 0, creditCents: 0 }, { account: '1100', debitCents: 0, creditCents: 0 }], status: 'posted', postedAt: liabilityAt, postedBy: 'posting-rules', createdAt: liabilityAt });
    } else if ((claimStatus === 'paid' || claimStatus === 'accepted') && priced.expectedPatientCents > 0) {
      const acc = await accountFor(p.practiceId, p.patientId, 'patient', liabilityAt);
      await postTxn(acc, 'transfer', priced.expectedPatientCents, 'Patient liability: network co-payment per the scheme option', liabilityAt, { reason: 'co_payment', refType: 'claim', refId: claimId, arithmetic: { totalCents: priced.totalCents, schemePaidCents: paidCents, patientOwesCents: priced.expectedPatientCents, reason: 'Network co-payment per the scheme option' } });
      acc.liabilityReason = 'co_payment';
    } else if (claimStatus === 'rejected' && rejectionCode === 'BENEFIT_EXHAUSTED') {
      const acc = await accountFor(p.practiceId, p.patientId, 'patient', liabilityAt);
      await postTxn(acc, 'transfer', priced.totalCents, 'Patient liability: scheme benefit for the year is exhausted', liabilityAt, { reason: 'benefit_exhausted', refType: 'claim', refId: claimId, arithmetic: { totalCents: priced.totalCents, schemePaidCents: 0, patientOwesCents: priced.totalCents, reason: 'Scheme benefit for the year is exhausted' } });
      acc.liabilityReason = 'benefit_exhausted';
    }
    // Long-cycle debtor classes carry their own book
    if (['raf', 'coida', 'corporate'].includes(p.funderType) && claimStatus !== 'paid') {
      const acc = await accountFor(p.practiceId, p.patientId, p.funderType as DebtorClass, submittedAt ?? signedAt);
      await postTxn(acc, 'invoice', priced.totalCents, `${p.funderType.toUpperCase()} claim ${claimRef}`, submittedAt ?? signedAt, { reason: p.funderType, refType: 'claim', refId: claimId });
      await db.update(s.patientAccounts).set({ externalRef: p.funderType === 'raf' ? `RAF-${2000 + claimSeq}` : p.funderType === 'coida' ? `CF-${5000 + claimSeq}` : `PO-${9000 + claimSeq}`, debtorName: p.funderType === 'corporate' ? 'Mine Occupational Health (demo)' : undefined }).where(eq(s.patientAccounts.id, acc.id));
    }
    // Point-of-service collection on some cash and co-payment charges
    if ((p.funderType === 'cash' || priced.expectedPatientCents > 0) && r() < 0.45) {
      const key = `${p.practiceId}:${p.patientId}:patient`;
      const acc = accountsByPatient.get(key);
      if (acc && acc.balanceCents > 0) {
        receiptSeq++;
        const method = pick(r, ['card', 'payshap', 'cash', 'qr', 'eft'] as const);
        const amount = r() < 0.8 ? acc.balanceCents : Math.round(acc.balanceCents * 0.5);
        const at = dayIso(now, Math.max(0, ageDays - 0.1));
        await db.insert(s.payments).values({
          id: newId('pay'), practiceId: p.practiceId, accountId: acc.id, patientId: p.patientId, siteId: p.siteId, method, amountCents: amount, status: 'settled',
          reference: `PAY-${p.practiceId === ctx.practiceA ? 'A' : 'B'}-${String(receiptSeq).padStart(6, '0')}`, receiptNo: `RCT-${p.practiceId === ctx.practiceA ? 'A' : 'B'}-${String(receiptSeq).padStart(6, '0')}`,
          takenBy: ctx.users.FDK ?? null, settledAt: at, at, createdAt: at,
        });
        await postTxn(acc, 'payment', -amount, `Payment received (${method})`, at, { refType: 'payment', refId: `rcpt-${receiptSeq}` });
        journalValues.push({ id: newId('jnl'), practiceId: p.practiceId, period: periodOf(dayOnly(at)), source: 'm14', sourceRef: `pay-${receiptSeq}`, eventName: 'payment.received.v1', description: `Cash received (${method})`, lines: [{ account: '1000', debitCents: amount, creditCents: 0 }, { account: '1110', debitCents: 0, creditCents: amount }], status: 'posted', postedAt: at, postedBy: 'posting-rules', createdAt: at });
      }
    }
  }
  summary.charges = chargeCount;
  summary.claims = claimCount;

  for (const t of txnValues) await db.insert(s.accountTransactions).values(t);
  summary.accountTransactions = txnValues.length;
  for (const j of journalValues) await db.insert(s.journals).values(j);

  /* ---------------- Rejection wave record ---------------- */
  const waveClaims = claimRows.filter((x) => x.funderId === 'scheme-b' && x.status === 'rejected');
  if (waveClaims.length >= 3) {
    for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
      const forPractice = waveClaims.filter((x) => x.practiceId === practiceId);
      if (forPractice.length < 3) continue;
      const claims = await db.select().from(s.claims).where(eq(s.claims.practiceId, practiceId));
      const cohort = claims.filter((x) => x.funderId === 'scheme-b' && x.status === 'rejected' && x.rejectionCode === 'AUTH_REQ' && x.serviceDate >= waveWindowStart);
      if (cohort.length < 3) continue;
      await db.insert(s.rejectionWaves).values({
        id: newId('wave'), practiceId, funderId: 'scheme-b', reasonCode: 'AUTH_REQ', codes: CT_CODES, startedAt: cohort.map((x) => x.respondedAt!).filter(Boolean).sort()[0] ?? dayIso(now, 13),
        claimCount: cohort.length, atRiskCents: cohort.reduce((a, x) => a + x.totalCents, 0), status: 'open', pausedRule: 'R21:scheme-b:AUTH_REQ',
        probableCause: 'Scheme B (demo) rule change: circular 14/2026 requires a pre-authorisation number on out-of-hospital CT tariffs and no longer accepts symptom codes as primary. Rule pack 2026.08 did not include it.',
        rulePackVersion: '2026.09.2', createdAt: dayIso(now, 13),
      });
      summary.rejectionWaves = (summary.rejectionWaves ?? 0) + 1;
    }
  }

  /* ---------------- Remittances ---------------- */
  let remCount = 0;
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    for (const funderId of ['scheme-a', 'scheme-b', 'scheme-c']) {
      const paid = await db.select().from(s.claims).where(eq(s.claims.practiceId, practiceId));
      const cohort = paid.filter((x) => x.funderId === funderId && ['paid', 'short_paid'].includes(x.status));
      if (!cohort.length) continue;
      for (let batch = 0; batch < 2; batch++) {
        const slice = cohort.filter((_, i) => i % 2 === batch);
        if (!slice.length) continue;
        const receivedAt = dayIso(now, batch === 0 ? 4 : 18);
        const lines: s.RemittanceLine[] = slice.map((cl) => ({
          claimRef: cl.claimRef, claimId: cl.id, expectedCents: cl.expectedFunderCents, paidCents: cl.paidCents, reasonCode: cl.status === 'short_paid' ? '4303' : null,
          shortPaymentClass: cl.status === 'short_paid' ? 'rate_difference' : null, route: cl.status === 'short_paid' ? 'patient_liability' : null, matchConfidence: 1,
          status: cl.status === 'short_paid' ? 'short_paid' : 'matched',
        }));
        // one unmatched credit per batch for the DEB matching queue
        if (r() < 0.6) lines.push({ claimRef: `UNREF-${funderId.slice(-1).toUpperCase()}${batch}${remCount}`, claimId: null, expectedCents: 0, paidCents: 120000 + Math.round(r() * 300000), reasonCode: null, shortPaymentClass: null, route: null, matchConfidence: 0, status: 'unmatched' });
        const id = newId('rem');
        const matched = lines.filter((l) => l.status !== 'unmatched').reduce((a, l) => a + l.paidCents, 0);
        const unmatched = lines.filter((l) => l.status === 'unmatched').reduce((a, l) => a + l.paidCents, 0);
        const short = lines.filter((l) => l.status === 'short_paid').reduce((a, l) => a + (l.expectedCents - l.paidCents), 0);
        await db.insert(s.remittances).values({
          id, practiceId, funderId, reference: `ERA-${funderId.toUpperCase().replace('SCHEME-', 'S')}-${dayOnly(receivedAt).replace(/-/g, '')}-${String(100 + remCount)}`, receivedAt,
          totalCents: lines.reduce((a, l) => a + l.paidCents, 0), lines, matchedCents: matched, unmatchedCents: unmatched, shortCents: short,
          status: unmatched > 0 ? 'partially_matched' : batch === 1 ? 'banked' : 'matched', bankRef: unmatched > 0 ? null : batch === 1 ? `BNK-${dayOnly(receivedAt).replace(/-/g, '')}-${remCount}` : null,
          bankedAt: unmatched > 0 ? null : batch === 1 ? receivedAt : null, handTaskId: 'remittance-hand', createdAt: receivedAt,
        });
        remCount++;
      }
    }
  }
  summary.remittances = remCount;

  /* ---------------- Ageing spread and flags on accounts ---------------- */
  const accounts = await db.select().from(s.patientAccounts);
  for (const acc of accounts) {
    const row = [...accountsByPatient.values()].find((x) => x.id === acc.id);
    const balance = row?.balanceCents ?? 0;
    if (balance <= 0) {
      await db.update(s.patientAccounts).set({ balanceCents: Math.max(0, balance), status: 'settled' }).where(eq(s.patientAccounts.id, acc.id));
      continue;
    }
    const score = propensityToPay({ amountCents: balance, daysOutstanding: Math.max(0, Math.round((now.getTime() - new Date(acc.ageingStartAt ?? ctx.now).getTime()) / 86400_000)), priorPaymentsOnTime: r() < 0.5 ? 1 : 0, priorDefaults: r() < 0.12 ? 1 : 0, channelReachable: (acc.consentChannels ?? []).length > 0, openDispute: false, liabilityReason: (row?.liabilityReason ?? 'other') as 'other' });
    await db.update(s.patientAccounts).set({ balanceCents: balance, liabilityReason: row?.liabilityReason ?? null, propensity: score as never, dunningStage: balance > 0 ? (r() < 0.4 ? 'day7' : r() < 0.7 ? 'day21' : 'statement') : null, delivered: ['statement'], contactsLast7d: r() < 0.5 ? 1 : 0, lastContactAt: dayIso(now, Math.round(r() * 7)) }).where(eq(s.patientAccounts.id, acc.id));
  }
  summary.patientAccounts = accounts.length;

  // Exclusion flags so the Collections Hand demo has something to exclude
  const patientAccounts = accounts.filter((a) => a.debtorClass === 'patient' && (accountsByPatient.get(`${a.practiceId}:${a.patientId}:patient`)?.balanceCents ?? 0) > 0);
  const flagPlan: Array<[string, number]> = [['urgent_care', 6], ['vulnerable', 4], ['deceased', 2], ['wrong_number', 2]];
  let idx = 0;
  for (const [flag, count] of flagPlan) {
    for (let i = 0; i < count && idx < patientAccounts.length; i++, idx++) {
      await db.update(s.patientAccounts).set({ flags: [flag] }).where(eq(s.patientAccounts.id, patientAccounts[idx]!.id));
    }
  }

  /* ---------------- Payment plans (8) ---------------- */
  const balanceOf = (a: { practiceId: string; patientId: string }) => accountsByPatient.get(`${a.practiceId}:${a.patientId}:patient`)?.balanceCents ?? 0;
  const byBalance = [...patientAccounts].sort((a, b) => balanceOf(b) - balanceOf(a));
  // Reserve the largest balances (two per practice) for the handover queue so both consoles have work.
  const handoverReserved = [ctx.practiceA, ctx.practiceB].flatMap((pid) => byBalance.filter((a) => a.practiceId === pid && balanceOf(a) >= DEFAULT_DUNNING_POLICY.minHandoverCents).slice(0, 2));
  const planTargets = byBalance.filter((a) => !handoverReserved.includes(a) && balanceOf(a) > 150000).slice(0, 8);
  let planCount = 0;
  for (const [i, acc] of planTargets.entries()) {
    const balance = accountsByPatient.get(`${acc.practiceId}:${acc.patientId}:patient`)!.balanceCents;
    const instalments = i % 3 === 0 ? 3 : i % 3 === 1 ? 4 : 6;
    const firstDue = dayOnly(dayIso(now, 30 - i * 3));
    const built = buildPlan(balance, instalments, firstDue);
    const schedule = built.instalments.map((ins, n) => ({ ...ins, status: n === 0 ? 'paid' : n === 1 && i % 4 === 3 ? 'missed' : 'due', paidAt: n === 0 ? dayIso(now, 20) : null }));
    const status = i === 7 ? 'proposed' : i % 4 === 3 ? 'active' : 'active';
    const id = newId('pln');
    await db.insert(s.paymentPlans).values({
      id, practiceId: acc.practiceId, accountId: acc.id, patientId: acc.patientId, totalCents: balance, instalmentCount: instalments, instalmentCents: built.instalmentCents, interestPct: 0,
      schedule: schedule as never, method: i % 2 === 0 ? 'paylink' : 'debit_order', status, approvedBy: status === 'active' ? ctx.users.DEB ?? null : null, approvedAt: status === 'active' ? dayIso(now, 25) : null, createdAt: dayIso(now, 26),
    });
    if (status === 'active') await db.update(s.patientAccounts).set({ planId: id }).where(eq(s.patientAccounts.id, acc.id));
    planCount++;
  }
  summary.paymentPlans = planCount;

  /* ---------------- Disputes (5) ---------------- */
  const disputeTargets = patientAccounts.filter((a) => !planTargets.includes(a) && !handoverReserved.includes(a)).slice(0, 5);
  const disputeReasons = [
    { reason: 'Quote said nothing to pay', message: 'My scheme said this was covered in full. Why must I pay?', status: 'open' },
    { reason: 'Scheme should have paid as a PMB', message: 'This was an emergency scan. My scheme must pay it in full.', status: 'open' },
    { reason: 'Scan was never done', message: 'I never had this scan.', status: 'not_upheld' },
    { reason: 'Amount differs from the quote', message: 'The quote at booking was less than this account.', status: 'open' },
    { reason: 'Paid at the desk already', message: 'I paid at reception on the day.', status: 'upheld' },
  ];
  let disputeCount = 0;
  for (const [i, acc] of disputeTargets.entries()) {
    const d = disputeReasons[i]!;
    const balance = accountsByPatient.get(`${acc.practiceId}:${acc.patientId}:patient`)?.balanceCents ?? 100000;
    const openedAt = dayIso(now, 3 + i * 4);
    const id = newId('dsp');
    await db.insert(s.disputes).values({
      id, practiceId: acc.practiceId, accountId: acc.id, patientId: acc.patientId, raisedVia: i % 2 === 0 ? 'whatsapp' : 'portal', reason: d.reason, message: d.message, amountCents: balance,
      status: d.status, outcome: d.status === 'upheld' ? 'Receipt found; the balance was cleared and a corrected statement sent.' : d.status === 'not_upheld' ? 'Acquisition record, consent and images shown to the patient; the balance stands.' : null,
      evidence: { note: 'Quote, claim and remittance are attached side by side in the console.' }, slaDueAt: dayIso(now, -(5 - i)), resolvedAt: d.status === 'open' ? null : dayIso(now, i), resolvedBy: d.status === 'open' ? null : ctx.users.DEB ?? null, createdAt: openedAt, updatedAt: openedAt,
    });
    if (d.status === 'open') await db.update(s.patientAccounts).set({ flags: ['disputed'] }).where(eq(s.patientAccounts.id, acc.id));
    disputeCount++;
  }
  summary.disputes = disputeCount;

  /* ---------------- Dunning runs and actions ---------------- */
  let runCount = 0, actionCount = 0;
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    const practiceAccounts = accounts.filter((a) => a.practiceId === practiceId && a.debtorClass === 'patient' && (accountsByPatient.get(`${a.practiceId}:${a.patientId}:patient`)?.balanceCents ?? 0) > 0);
    for (let day = 0; day < 5; day++) {
      const startedAt = dayIso(now, day * 2 + (day === 0 ? 0.35 : 0)); // ~06:00 SAST runs
      const runId = newId('run');
      const byChannel: Record<string, number> = {};
      const byStep: Record<string, number> = {};
      const byBand: Record<string, number> = {};
      const exclusions: Record<string, number> = { urgent_care: 6, disputed: disputeCount, prescription_risk: 3, deceased: 2, vulnerable: 4, in_grace: Math.round(practiceAccounts.length * 0.1) };
      let actions = 0;
      for (const acc of practiceAccounts) {
        if (acc.flags.length) continue;
        if (r() < 0.35) continue;
        const step = r() < 0.4 ? 'statement' : r() < 0.7 ? 'day7' : r() < 0.9 ? 'day21' : 'day45';
        const channel = (acc.consentChannels ?? ['sms'])[0] ?? 'sms';
        const band = r() < 0.41 ? 'high' : r() < 0.79 ? 'medium' : 'low';
        byChannel[channel] = (byChannel[channel] ?? 0) + 1;
        byStep[step] = (byStep[step] ?? 0) + 1;
        byBand[band] = (byBand[band] ?? 0) + 1;
        if (day === 0) {
          await db.insert(s.dunningActions).values({
            id: newId('dna'), practiceId, runId, accountId: acc.id, patientId: acc.patientId, step, channel, template: `${step}.v7`, language: acc.language,
            amountCents: accountsByPatient.get(`${acc.practiceId}:${acc.patientId}:patient`)?.balanceCents ?? 0, scheduledFor: startedAt, sentAt: startedAt, status: r() < 0.2 ? 'read' : 'sent',
            paylinkToken: step === 'day21' ? newId('lnk').slice(-24) : null, createdAt: startedAt,
          });
          actionCount++;
        }
        actions++;
      }
      await db.insert(s.dunningRuns).values({
        id: runId, practiceId, startedAt, finishedAt: dayIso(now, day * 2 - 0.01), handTaskId: 'collections-hand', policyVersion: '7', actions, byChannel, byStep, byBand, exclusions,
        insideWindow: actions, needsHuman: Math.max(1, Math.round(actions * 0.04)), sampleReviewedBy: day > 0 ? ctx.users.DEB ?? null : null, sampleReviewedAt: day > 0 ? dayIso(now, day * 2 - 0.2) : null, status: 'done', createdAt: startedAt,
      });
      runCount++;
    }
  }
  summary.dunningRuns = runCount;
  summary.dunningActions = actionCount;

  /* ---------------- Write-offs and handovers ---------------- */
  const writeOffReasons: Array<{ reason: string; rootCause: string; cents: number; status: string }> = [
    { reason: 'quote_honoured_practice_error', rootCause: 'Quote accuracy: out-of-network flag not set at booking', cents: 146000, status: 'approved' },
    { reason: 'funder_rule_change_practice_absorbs', rootCause: 'Rule pack 2026.08 missed circular 14/2026', cents: 380000, status: 'approved' },
    { reason: 'small_balance', rootCause: 'Below the cost of collection', cents: 4200, status: 'approved' },
    { reason: 'uncollectable', rootCause: 'Untraceable after the full sequence', cents: 92000, status: 'approved' },
    { reason: 'deceased_no_estate', rootCause: 'Deceased flag with no estate contact', cents: 68000, status: 'proposed' },
    { reason: 'late_submission_loss', rootCause: 'Claim lapsed the four-month window: process failure', cents: 214000, status: 'proposed' },
  ];
  let woCount = 0;
  for (const [i, w] of writeOffReasons.entries()) {
    const acc = patientAccounts[(i + 12) % Math.max(1, patientAccounts.length)];
    if (!acc) break;
    const approver = w.cents <= 50000 ? 'DEB' : w.cents <= 500000 ? 'PRM' : 'EXE';
    const at = dayIso(now, 5 + i * 3);
    await db.insert(s.writeOffs).values({
      id: newId('wo'), practiceId: acc.practiceId, accountId: acc.id, patientId: acc.patientId, amountCents: w.cents, reason: w.reason, rootCause: w.rootCause,
      proposedBy: 'collections-hand', approverPersona: approver, approvedBy: w.status === 'approved' ? (approver === 'DEB' ? ctx.users.DEB ?? null : ctx.users.PRM ?? null) : null,
      approvedAt: w.status === 'approved' ? at : null, status: w.status, period: periodOf(dayOnly(at)), createdAt: at,
    });
    if (w.status === 'approved') {
      journalValues.push({ id: newId('jnl'), practiceId: acc.practiceId, period: periodOf(dayOnly(at)), source: 'm14', sourceRef: `wo-${i}`, eventName: 'writeoff.approved.v1', description: `Write-off (${w.reason})`, lines: [{ account: '5200', debitCents: w.cents, creditCents: 0 }, { account: '1110', debitCents: 0, creditCents: w.cents }], status: 'posted', postedAt: at, postedBy: 'posting-rules', createdAt: at });
      await db.insert(s.journals).values(journalValues[journalValues.length - 1]!);
    }
    woCount++;
  }
  summary.writeOffs = woCount;

  const belowMinimum = byBalance.filter((a) => !handoverReserved.includes(a) && !planTargets.includes(a) && !disputeTargets.includes(a) && balanceOf(a) > 0 && balanceOf(a) < DEFAULT_DUNNING_POLICY.minHandoverCents).slice(-2);
  const handoverTargets = [...handoverReserved, ...belowMinimum];
  let hoCount = 0;
  for (const acc of handoverTargets) {
    const balance = accountsByPatient.get(`${acc.practiceId}:${acc.patientId}:patient`)?.balanceCents ?? 0;
    const clean = handoverReserved.includes(acc) && balance >= DEFAULT_DUNNING_POLICY.minHandoverCents;
    await db.insert(s.handovers).values({
      id: newId('hov'), practiceId: acc.practiceId, accountId: acc.id, patientId: acc.patientId, amountCents: balance,
      checklist: { statementDelivered: true, finalNoticeDelivered: clean, noOpenDispute: true, notVulnerable: true, notPracticeError: true, notLongCycle: true, aboveMinimum: balance >= DEFAULT_DUNNING_POLICY.minHandoverCents, notPrescribed: true, sequenceComplete: clean },
      clean, failing: clean ? [] : [balance < DEFAULT_DUNNING_POLICY.minHandoverCents ? 'aboveMinimum' : 'finalNoticeDelivered'], collector: 'Registered collector (demo)',
      prescriptionDate: dayOnly(dayIso(now, -(3 * 365 - 200))), status: 'proposed', proposedBy: 'collections-hand', handTaskId: 'collections-hand', createdAt: dayIso(now, 2),
    });
    hoCount++;
  }
  summary.handovers = hoCount;

  /* ---------------- Billing period checklists ---------------- */
  const periods = previousPeriods(periodOf(ctx.now), 6);
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    for (const [i, period] of periods.entries()) {
      const isCurrent = i === periods.length - 1;
      await db.insert(s.billingPeriods).values({
        id: newId('bp'), practiceId, period,
        checklist: [
          { id: 'unbilled', label: 'Unbilled register reviewed and owners assigned', done: !isCurrent, owner: 'BIL' },
          { id: 'inflight', label: 'Claims-in-flight accrual agreed by funder', done: !isCurrent, owner: 'BIL' },
          { id: 'remittances', label: 'Remittances matched and banked', done: !isCurrent, owner: 'DEB' },
          { id: 'provision', label: 'ECL provision computed from the matrix', done: !isCurrent, owner: 'DEB' },
          { id: 'readingfees', label: 'Reading-fee statements approved', done: !isCurrent, owner: 'PRM' },
          { id: 'journals', label: 'Revenue journals reconciled to the debtor sub-ledgers', done: !isCurrent, owner: 'BIL' },
        ],
        status: isCurrent ? 'open' : 'signed', signedBy: isCurrent ? null : ctx.users.BIL ?? null, signedAt: isCurrent ? null : `${period}-28T15:00:00.000Z`,
        provision: isCurrent ? null : { totalProvisionCents: 120000 + Math.round(r() * 200000) },
        createdAt: `${period}-01T06:00:00.000Z`, updatedAt: `${period}-28T15:00:00.000Z`,
      });
    }
  }

  /* ---------------- M15: chart of accounts, P&L, intercompany, distributions ---------------- */
  const { CHART_OF_ACCOUNTS } = await import('@bonakala/domain/billing');
  for (const a of CHART_OF_ACCOUNTS) await db.insert(s.glAccounts).values({ id: `gl_${a.code}`, practiceId: null, code: a.code, name: a.name, type: a.type, ifrsGroup: a.ifrsGroup });
  summary.glAccounts = CHART_OF_ACCOUNTS.length;

  const rels = await db.select().from(s.entityRelationships);
  const costModel: Record<string, { staff: number; consumables: number; rent: number; other: number; depreciation: number; baseRevenue: number; studies: number }> = {
    [ctx.practiceA]: { staff: 1_810_000_00, consumables: 520_000_00, rent: 340_000_00, other: 360_000_00, depreciation: 150_000_00, baseRevenue: 6_120_000_00, studies: 3860 },
    [ctx.practiceB]: { staff: 2_130_000_00, consumables: 690_000_00, rent: 420_000_00, other: 424_000_00, depreciation: 180_000_00, baseRevenue: 7_900_000_00, studies: 4812 },
  };
  let pnlCount = 0, icCount = 0;
  const distributableByPractice: Record<string, Record<string, number>> = {};
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    const cm = costModel[practiceId]!;
    const mgmt = rels.find((x) => x.childId === practiceId && x.type === 'management_agreement');
    const reading = rels.find((x) => x.childId === practiceId && x.type === 'reading_services');
    distributableByPractice[practiceId] = {};
    for (const [i, period] of periods.entries()) {
      const seasonal = 1 + (i - periods.length / 2) * 0.012 + (r() - 0.5) * 0.05;
      const revenueCents = Math.round(cm.baseRevenue * seasonal);
      const studies = Math.round(cm.studies * seasonal);
      const collectionsCents = Math.round(revenueCents * (0.93 + r() * 0.04));
      const shortPaymentsCents = Math.round(revenueCents * (0.006 + r() * 0.004));
      const pnl = computePnl({
        revenueCents, shortPaymentsCents, signedReports: studies, collectionsCents, studies, managementFeeRate: mgmt?.feeModel?.rate ?? 0.08,
        readingFeePerStudyCents: reading?.feeModel?.perStudyCents ?? 32000, platformFeePerStudyCents: 0, rentCents: cm.rent, staffCents: cm.staff, consumablesCents: cm.consumables,
        otherCents: cm.other, depreciationCents: cm.depreciation, taxRate: 0.27, reservePct: 0.1,
      });
      const budgetRevenue = Math.round(cm.baseRevenue * (1 + i * 0.008) * 1.04);
      const why: Record<string, string> = {
        revenue: practiceId === ctx.practiceB && i === periods.length - 2 ? 'CT 1 downtime and MRI outage windows' : 'volume and funder mix',
        short_payments: 'funder rule change absorbed by the practice; rule pack fixed by the bureau',
        reading_fees: `per Hub schedule · ${studies} signed reports`, management_fee: 'covers Platform, billing bureau, HR and procurement',
      };
      const lines = pnl.lines.map((l) => {
        const budgetCents = l.key === 'revenue' ? budgetRevenue : l.key === 'ebitda' ? Math.round(budgetRevenue * 0.265) : l.key === 'distributable' ? Math.round(budgetRevenue * 0.19) : undefined;
        return { ...l, budgetCents, varianceCents: budgetCents === undefined ? undefined : l.amountCents - budgetCents, why: why[l.key] };
      });
      const locked = i < periods.length - 1;
      await db.insert(s.pnlSnapshots).values({
        id: newId('pnl'), practiceId, period, lines: lines as never, revenueCents: pnl.revenueCents, shortPaymentsCents: pnl.shortPaymentsCents, readingFeesCents: pnl.readingFeesCents,
        managementFeeCents: pnl.managementFeeCents, platformFeeCents: 0, rentCents: pnl.rentCents, staffCents: pnl.staffCents, consumablesCents: pnl.consumablesCents, otherCents: pnl.otherCents,
        ebitdaCents: pnl.ebitdaCents, depreciationCents: pnl.depreciationCents, taxProvisionCents: pnl.taxProvisionCents, profitAfterTaxCents: pnl.profitAfterTaxCents, reserveCents: pnl.reserveCents,
        distributableCents: pnl.distributableCents, collectionsCents, unbilledCents: Math.round(revenueCents * 0.049), studies,
        kpis: { ebitdaMarginPct: pnl.ebitdaMarginPct, signedReports: studies, firstPassPct: Math.round((96.4 - (i === periods.length - 2 ? 3.3 : 0)) * 10) / 10, dsoDays: 34 + Math.round(r() * 4) },
        budgetRevenueCents: budgetRevenue, budgetEbitdaCents: Math.round(budgetRevenue * 0.265), status: locked ? 'locked' : 'soft', lockedAt: locked ? `${period}-05T12:00:00.000Z` : null,
        computedBy: 'close-hand', createdAt: `${period}-05T06:00:00.000Z`, updatedAt: `${period}-05T12:00:00.000Z`,
      });
      distributableByPractice[practiceId]![period] = pnl.distributableCents;
      pnlCount++;

      await db.insert(s.fiscalPeriods).values({
        id: newId('fp'), practiceId, period, status: locked ? 'locked' : 'soft_closed', closedBy: locked ? ctx.users.EXE ?? null : null, closedAt: locked ? `${period}-05T12:00:00.000Z` : null,
        lockedAt: locked ? `${period}-05T12:00:00.000Z` : null, lockRef: locked ? `${practiceId.toUpperCase()}-${period}-L1` : null,
        closeSteps: [
          { id: 'm14', day: 1, label: 'M14 outputs received (unbilled register, claims-in-flight, provisions)', level: 'A3', status: 'done', owner: 'BIL', at: `${period}-01T08:00:00.000Z` },
          { id: 'intercompany', day: 2, label: 'Intercompany run and invoices', level: 'A3', status: 'done', owner: 'PRM', at: `${period}-02T09:00:00.000Z` },
          { id: 'pnl', day: 3, label: 'P&L per practice with variance commentary drafted', level: 'A3', status: 'done', owner: 'EXE', at: `${period}-03T10:00:00.000Z` },
          { id: 'distribution', day: 5, label: 'Distribution proposal with bridge, solvency test and waterfall', level: 'A3', status: locked ? 'done' : 'pending', owner: 'EXE', at: locked ? `${period}-05T09:00:00.000Z` : null },
          { id: 'approval', day: 7, label: 'Distribution approvals, resolution and payment file', level: 'A0', status: locked ? 'done' : 'pending', owner: 'EXE', at: locked ? `${period}-07T09:00:00.000Z` : null },
          { id: 'lock', day: 8, label: 'Shareholder portal updated; period locked', level: 'A3', status: locked ? 'done' : 'pending', owner: 'EXE', at: locked ? `${period}-05T12:00:00.000Z` : null },
        ],
        createdAt: `${period}-01T06:00:00.000Z`, updatedAt: `${period}-05T12:00:00.000Z`,
      });

      // Intercompany invoices for the last three periods
      if (i >= periods.length - 3) {
        for (const rel of rels.filter((x) => x.childId === practiceId && ['management_agreement', 'reading_services'].includes(x.type))) {
          const amounts = intercompanyAmount({ type: rel.type as 'management_agreement', fromEntityId: rel.parentId, toEntityId: practiceId, feeModel: rel.feeModel ?? { basis: 'per_study', perStudyCents: 32000 } }, { collectionsCents, signedReports: studies, studies });
          if (!amounts.amountExclCents) continue;
          await db.insert(s.intercompanyInvoices).values({
            id: newId('ici'), practiceId, fromEntityId: rel.parentId, toEntityId: practiceId, period, ruleType: rel.type,
            number: `IC-${rel.type.slice(0, 3).toUpperCase()}-${period.replace('-', '')}-${practiceId === ctx.practiceA ? 'A' : 'B'}`, basis: amounts.basis,
            evidence: { collectionsCents, signedReports: studies, studies }, amountExclCents: amounts.amountExclCents, vatCents: amounts.vatCents, totalCents: amounts.totalCents,
            status: locked ? 'final' : 'issued', disputeWindowEndsAt: `${period}-10T12:00:00.000Z`, createdAt: `${period}-02T09:00:00.000Z`, updatedAt: `${period}-02T09:00:00.000Z`,
          });
          // Lease (rent) intercompany
          icCount++;
        }
        await db.insert(s.intercompanyInvoices).values({
          id: newId('ici'), practiceId, fromEntityId: ctx.group, toEntityId: practiceId, period, ruleType: 'lease', number: `IC-LEA-${period.replace('-', '')}-${practiceId === ctx.practiceA ? 'A' : 'B'}`,
          basis: 'lease schedule, monthly', evidence: { monthlyCents: cm.rent }, amountExclCents: cm.rent, vatCents: Math.round(cm.rent * 0.15), totalCents: Math.round(cm.rent * 1.15),
          status: locked ? 'final' : 'issued', disputeWindowEndsAt: `${period}-10T12:00:00.000Z`, createdAt: `${period}-02T09:00:00.000Z`, updatedAt: `${period}-02T09:00:00.000Z`,
        });
        icCount++;
      }
    }
  }
  summary.pnlSnapshots = pnlCount;
  summary.intercompanyInvoices = icCount;

  /* ---------------- Distributions: one paid, one proposed (Practice B JV) ---------------- */
  const holdingsB = (await db.select().from(s.shareholdings).where(eq(s.shareholdings.entityId, ctx.practiceB))).map((h) => ({ shareholderName: h.shareholderName, shareholderUserId: h.shareholderUserId, shareClass: h.shareClass, shares: h.shares, effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo }));
  await db.update(s.shareholdings).set({ shareholderUserId: ctx.users.SHR ?? null }).where(eq(s.shareholdings.shareholderName, 'Dr A. Pillay'));
  const distPeriods = [periods[periods.length - 2]!, periods[periods.length - 3]!];
  let distCount = 0;
  for (const [i, period] of [...distPeriods].reverse().entries()) {
    const distributable = distributableByPractice[ctx.practiceB]![period] ?? 0;
    const { start, end } = periodBounds(period);
    const waterfall = distributionWaterfall({ distributableCents: distributable, holdings: holdingsB, periodStart: start, periodEnd: end, dividendsTaxRate: 0.2 });
    const solvency = solvencyLiquidityTest({ cashCents: Math.round(distributable * 2.4), receivablesCents: Math.round(distributable * 3), liabilitiesCents: Math.round(distributable * 0.8), proposedCents: distributable, workingCapitalFloorCents: 1_500_000_00 });
    const proposed = i === 1; // the most recent one is still proposed
    const id = newId('dst');
    const approvals = proposed
      ? [{ persona: 'PRM', userId: ctx.users.PRM ?? '', name: 'Lerato Mahlangu', at: `${period}-06T08:00:00.000Z` }, { persona: 'EXE', userId: ctx.users.EXE ?? '', name: 'Priya Reddy', at: `${period}-06T12:00:00.000Z` }]
      : [{ persona: 'PRM', userId: ctx.users.PRM ?? '', name: 'Lerato Mahlangu', at: `${period}-06T08:00:00.000Z` }, { persona: 'SHR', userId: ctx.users.SHR ?? '', name: 'Dr A. Pillay', at: `${period}-07T18:00:00.000Z` }, { persona: 'EXE', userId: ctx.users.EXE ?? '', name: 'Priya Reddy', at: `${period}-08T09:00:00.000Z` }];
    await db.insert(s.distributions).values({
      id, practiceId: ctx.practiceB, period, distributableCents: distributable,
      bridge: [
        { key: 'profit_after_tax', label: 'Profit after tax', amountCents: Math.round(distributable / 0.9) },
        { key: 'reserve', label: 'Transfer to reserve (10 % per the shareholders agreement)', amountCents: -Math.round(distributable / 0.9 * 0.1) },
        { key: 'distributable', label: 'Distributable profit', amountCents: distributable },
      ],
      solvencyTest: solvency as never, waterfall: waterfall as never, approvals, requiredApprovals: 3, resolutionRef: `RES-PRAC_B-${period}`,
      status: proposed ? 'proposed' : 'paid', paymentFile: proposed ? null : { generatedAt: `${period}-09T08:00:00.000Z`, totalCents: waterfall.totalNetCents, lines: waterfall.entitlements.map((e) => ({ shareholderName: e.shareholderName, netCents: e.netCents, reference: `RES-PRAC_B-${period}-${e.shareholderName.split(' ').pop()}` })) },
      paymentFileHash: proposed ? null : `demo-hash-${period}`, proposedBy: 'close-hand', releasedBy: proposed ? null : ctx.users.EXE ?? null, releasedAt: proposed ? null : `${period}-09T08:30:00.000Z`,
      paidAt: proposed ? null : `${period}-09T14:00:00.000Z`, bankRef: proposed ? null : `BNK-PB-${period.replace('-', '').slice(2)}09-014`, createdAt: `${period}-06T06:00:00.000Z`, updatedAt: `${period}-09T14:00:00.000Z`,
    });
    for (const e of waterfall.entitlements) {
      await db.insert(s.shareholderStatements).values({
        id: newId('shs'), practiceId: ctx.practiceB, distributionId: id, period, shareholderName: e.shareholderName,
        shareholderUserId: e.shareholderName === 'Dr A. Pillay' ? ctx.users.SHR ?? null : null, shareClass: e.shareClass, pct: Math.round(e.pct * 100),
        grossCents: e.grossCents, dividendsTaxCents: e.dividendsTaxCents, netCents: e.netCents, segments: e.segments as never,
        bankRef: proposed ? null : `BNK-PB-${period.replace('-', '').slice(2)}09-014`, status: proposed ? 'issued' : 'paid', createdAt: `${period}-06T06:00:00.000Z`,
      });
    }
    distCount++;
  }
  summary.distributions = distCount;

  /* ---------------- Reserved matter vote (open) ---------------- */
  await db.insert(s.reservedMatters).values({
    id: newId('rm'), practiceId: ctx.practiceB, ref: 'RM-2026-07', kind: 'capex', title: 'Capex: CT replacement',
    description: 'Replace the CT 2 tube assembly and detector ahead of failure (tube arc trend and a recorded vendor SLA breach). The vendor quote is valid to 15 October. Avoided downtime is modelled at R118 000 per event at the current case mix.',
    amountCents: 240_000_000, rule: { majorityPct: 75, quorumBothClasses: true, requireLocalPartner: false, abstentionCountsAs: 'abstain' },
    votes: [{ shareholderName: 'Bonakala Professional Holdings Inc.', userId: ctx.users.EXE ?? null, pct: 51, vote: 'approve', condition: null, at: dayIso(now, 4) }],
    attachments: [{ name: 'Vendor quotes (2)', kind: 'PDF' }, { name: 'What-if model with assumptions', kind: 'XLSX' }, { name: "Attorneys' note", kind: 'PDF' }],
    thread: [
      { from: "COO's office", at: dayIso(now, 3), text: 'Site power plan attached; the room build has municipal approval on file in M18.' },
      { from: 'Dr A. Pillay', at: dayIso(now, 2), text: 'What happens to helium and power costs under Stage 6 load-shedding?' },
      { from: "COO's office", at: dayIso(now, 1), text: 'Generator cover is sized for the CT; diesel at the current price adds about R21 400 a month at Stage 6.' },
    ],
    opensAt: dayIso(now, 6), closesAt: dayIso(now, -14), status: 'open', createdAt: dayIso(now, 6),
  });
  summary.reservedMatters = 1;

  /* ---------------- Budgets ---------------- */
  const fyPeriods = previousPeriods(periodOf(ctx.now), 12);
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    const cm = costModel[practiceId]!;
    const lines = fyPeriods.flatMap((period, i) => [
      { period, key: 'revenue', amountCents: Math.round(cm.baseRevenue * (1 + i * 0.008) * 1.04) },
      { period, key: 'ebitda', amountCents: Math.round(cm.baseRevenue * (1 + i * 0.008) * 1.04 * 0.265) },
      { period, key: 'distributable', amountCents: Math.round(cm.baseRevenue * (1 + i * 0.008) * 1.04 * 0.19) },
      { period, key: 'studies', amountCents: Math.round(cm.studies * (1 + i * 0.006)) },
    ]);
    await db.insert(s.budgets).values({
      id: newId('bdg'), practiceId, financialYear: 'FY2027', version: 2, status: 'approved',
      assumptions: { tariffIncreasePct: 5.5, cpiPct: 4.8, schemeMixShift: 'Scheme B DSP renewal at −8 %', loadSheddingStage: 'Stage 4 average', dataCostPct: 2 },
      lines, approvedBy: ctx.users.EXE ?? null, createdAt: '2026-02-20T09:00:00.000Z',
    });
  }
  summary.budgets = 2;

  /* ---------------- Publish handles ---------------- */
  ctx.extra.claims = claimRows;
  ctx.extra.patientAccounts = [...accountsByPatient.values()].map((a) => ({ id: a.id, practiceId: a.practiceId, patientId: a.patientId, balanceCents: a.balanceCents }));

  // ECL provision sanity for the demo dashboards (not persisted; computed live by the API).
  const ageable: AgeableBalance[] = [...accountsByPatient.values()].filter((a) => a.balanceCents > 0).map((a) => ({ debtorClass: a.debtorClass, balanceCents: a.balanceCents, ageingStartAt: a.ageingStartAt }));
  void eclProvision(ageBalances(ageable, dayOnly(ctx.now)));

  return summary;
}
