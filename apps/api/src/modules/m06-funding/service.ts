import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { schema, type BenefitCheckResult, type QuoteLine } from '@bonakala/db';
import { addVat, defineHand, newId, notFound, invalid } from '@bonakala/domain';
import { emit, emitDirect, registerHand, runHand, type AppContext, type Services } from '../../kernel/index.js';
import { loadCatalogue, CONTRAST_LINE, type ProcedureDef } from '../m04-referrals/catalogue.js';
import { simulateAuth, simulateBenefitCheck } from '../../sim/funder.js';

export const FEE_SCHEDULE_VERSION = 'demo-2026.1';
export const RULE_PACK_VERSION = 'demo-2026.1';

export async function getFunderByCode(services: Services, code: string | null | undefined, practiceId: string) {
  if (!code) return null;
  const [f] = await services.db.select().from(schema.funders).where(and(eq(schema.funders.code, code), or(isNull(schema.funders.practiceId), eq(schema.funders.practiceId, practiceId)))).limit(1);
  return f ?? null;
}

export function authRequiredFor(funder: typeof schema.funders.$inferSelect | null, option: string | null | undefined, procedure: ProcedureDef): boolean {
  if (!funder || funder.type !== 'scheme') return false;
  const perOption = option && funder.rules.authByOption?.[option];
  const list = perOption ?? funder.rules.authRequiredModalities;
  return list.includes(procedure.modality) || (procedure.authFlag && list.length > 0);
}

/** Itemised quote: tariff x units, contrast line, VAT 15 % separate, scheme and patient portions with reasons. */
export function buildQuote(procedures: ProcedureDef[], contrastFlags: boolean[], funderType: string, check: BenefitCheckResult | null, funder: typeof schema.funders.$inferSelect | null) {
  const cash = funderType === 'cash' || check?.result === 'invalid';
  const lines: QuoteLine[] = [];
  procedures.forEach((p, i) => {
    const unit = cash ? p.cashCents : Math.round(p.tariffCents * ((funder?.rules.ratePct ?? 100) / 100));
    lines.push({ tariffCode: p.tariffCode, description: p.description, units: 1, unitCents: unit, totalCents: unit, kind: 'procedure' });
    if (contrastFlags[i]) lines.push({ tariffCode: CONTRAST_LINE.tariffCode, description: CONTRAST_LINE.description, units: 1, unitCents: CONTRAST_LINE.cents, totalCents: CONTRAST_LINE.cents, kind: 'contrast' });
  });
  const subtotalCents = lines.reduce((a, l) => a + l.totalCents, 0);
  const { vat: vatCents, incl: totalCents } = addVat(subtotalCents);
  const reasonCodes: string[] = [];
  const assumptions: string[] = [];
  let patientPortionCents = 0;
  if (['raf', 'coida', 'corporate', 'state'].includes(funderType)) { reasonCodes.push('CONTRACT'); assumptions.push('Priced under the third-party contract; no patient portion while the claim reference is valid.'); }
  else if (cash) { patientPortionCents = totalCents; reasonCodes.push(check?.result === 'invalid' ? 'MEMBERSHIP_INVALID' : 'CASH'); }
  else if (!check) { patientPortionCents = 0; reasonCodes.push('UNCHECKED'); assumptions.push('Benefit not yet checked; the patient portion may change.'); }
  else if (check.result === 'exhausted') { patientPortionCents = totalCents; reasonCodes.push('BENEFIT_EXHAUSTED'); }
  else {
    const pct = check.coPayPct ?? 0;
    patientPortionCents = Math.round((totalCents * pct) / 100);
    reasonCodes.push(...check.reasonCodes.filter((x) => x !== 'AUTH_REQUIRED'));
    if (check.result === 'needs_auth') assumptions.push('Assumes the scheme authorises the procedure; without authorisation the patient portion is the full amount.');
    if (pct) assumptions.push(`Co-payment of ${pct} % applies on this option.`);
  }
  const schemePortionCents = totalCents - patientPortionCents;
  return { lines, subtotalCents, vatCents, totalCents, schemePortionCents, patientPortionCents, reasonCodes: [...new Set(reasonCodes)], assumptions };
}

/** Create or refresh the funding case for an order: benefit check via the funder simulator, then a binding quote. */
export async function ensureFundingCase(services: Services, orderId: string, opts: { c?: AppContext; funderType?: string | null; funderCode?: string | null; memberNo?: string | null; schemeOption?: string | null; thirdPartyRef?: string | null; siteId?: string | null; actor?: string } = {}) {
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) throw notFound('Order');
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, order.patientId)).limit(1);
  if (!patient) throw notFound('Patient');
  const catalogue = await loadCatalogue(services);
  const procs = order.procedures.map((p) => catalogue.find((x) => x.code === p.code)).filter((x): x is ProcedureDef => !!x);
  if (!procs.length) throw invalid('Order has no catalogue procedures');
  const [existing] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.orderId, orderId)).orderBy(desc(schema.fundingCases.createdAt)).limit(1);
  const funderType = opts.funderType ?? existing?.funderType ?? order.funderType ?? (patient.schemeId ? 'scheme' : 'cash');
  const funderCode = funderType === 'scheme' ? (opts.funderCode ?? existing?.funderId ?? patient.schemeId ?? null) : funderType;
  const funder = await getFunderByCode(services, funderCode, order.practiceId);
  const memberNo = opts.memberNo ?? existing?.memberNo ?? patient.memberNo ?? null;
  const option = opts.schemeOption ?? existing?.schemeOption ?? patient.schemeOption ?? null;
  const siteId = opts.siteId ?? existing?.siteId ?? order.siteId ?? null;
  const authRequired = procs.some((p) => authRequiredFor(funder, option, p));
  let check: BenefitCheckResult | null = null;
  if (funderType === 'scheme') {
    const outOfNetwork = !!(funder && option && funder.rules.networkOptions?.includes(option) && siteId && funder.rules.networkSiteIds?.length && !funder.rules.networkSiteIds.includes(siteId));
    const res = simulateBenefitCheck({ funderCode: funder?.code ?? 'unknown', option, memberNo, dependantCode: patient.dependantCode, modality: procs[0]!.modality, procedureCode: procs[0]!.code, siteId, authRequired, networkCoPayPct: funder?.rules.networkCoPayPct, outOfNetwork });
    check = { result: res.result, checkedAt: new Date().toISOString(), source: 'sim:funder', reasonCodes: res.reasonCodes, coPayPct: res.coPayPct, message: res.message, raw: { reference: res.reference, latencyMs: res.latencyMs } };
  } else if (['raf', 'coida', 'corporate'].includes(funderType)) {
    check = { result: 'contract', checkedAt: new Date().toISOString(), source: 'manual', reasonCodes: ['CONTRACT'], message: `Priced under ${funderType.toUpperCase()} contract terms.` };
  } else check = { result: 'cash', checkedAt: new Date().toISOString(), source: 'manual', reasonCodes: ['CASH'], message: 'Cash tariff applies; payable before or on the day.' };
  const q = buildQuote(procs, order.procedures.map((p) => !!p.contrast), funderType, check, funder);
  const caseId = existing?.id ?? newId('fnd');
  const status = ['raf', 'coida', 'corporate'].includes(funderType) ? 'contract' : funderType === 'cash' ? 'deposit_due' : check?.result === 'invalid' ? 'deposit_due' : 'quoted';
  const authStatus = authRequired && check?.result === 'needs_auth' ? (existing?.authStatus && existing.authStatus !== 'not_required' ? existing.authStatus : 'pending') : 'not_required';
  const base = { practiceId: order.practiceId, orderId, patientId: order.patientId, siteId, funderType, funderId: funder?.code ?? funderCode, schemeName: funder?.name ?? patient.schemeName, schemeOption: option, memberNo, dependantCode: patient.dependantCode, status, benefitCheck: check, totalCents: q.totalCents, schemePortionCents: q.schemePortionCents, patientPortionCents: q.patientPortionCents, reasonCodes: q.reasonCodes, authRequired: authRequired && check?.result === 'needs_auth', authStatus, thirdPartyRef: opts.thirdPartyRef ?? existing?.thirdPartyRef ?? null, updatedAt: new Date().toISOString() };
  if (existing) await services.db.update(schema.fundingCases).set(existing.authStatus === 'approved' ? { ...base, status: 'authorised', authStatus: 'approved' } : base).where(eq(schema.fundingCases.id, caseId));
  else await services.db.insert(schema.fundingCases).values({ id: caseId, ...base });
  const prev = await services.db.select({ v: sql<number>`coalesce(max(version),0)` }).from(schema.quotes).where(eq(schema.quotes.fundingCaseId, caseId));
  const quoteId = newId('qte');
  await services.db.insert(schema.quotes).values({ id: quoteId, practiceId: order.practiceId, fundingCaseId: caseId, orderId, patientId: order.patientId, version: (prev[0]?.v ?? 0) + 1, lines: q.lines, subtotalCents: q.subtotalCents, vatCents: q.vatCents, totalCents: q.totalCents, schemePortionCents: q.schemePortionCents, patientPortionCents: q.patientPortionCents, reasonCodes: q.reasonCodes, assumptions: q.assumptions, validUntil: new Date(Date.now() + 30 * 86400_000).toISOString(), binding: true, feeScheduleVersion: FEE_SCHEDULE_VERSION, rulePackVersion: RULE_PACK_VERSION });
  await services.db.update(schema.fundingCases).set({ quoteId }).where(eq(schema.fundingCases.id, caseId));
  await services.db.update(schema.orders).set({ fundingCaseId: caseId, funderType, updatedAt: new Date().toISOString() }).where(eq(schema.orders.id, orderId));
  const payload = { orderId, patientId: order.patientId, practiceId: order.practiceId, funderType, schemePortionCents: q.schemePortionCents, patientPortionCents: q.patientPortionCents, authRequired: base.authRequired, authStatus, quoteId, fundingCaseId: caseId };
  if (opts.c) await emit(opts.c, 'funding.quoted.v1', payload, { aggregateType: 'funding_case', aggregateId: caseId, practiceId: order.practiceId });
  else await emitDirect(services, 'funding.quoted.v1', payload, { aggregateType: 'funding_case', aggregateId: caseId, practiceId: order.practiceId });
  const [row] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, caseId)).limit(1);
  const [quote] = await services.db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).limit(1);
  return { fundingCase: row!, quote: quote! };
}

export async function fundingForOrder(services: Services, orderId: string) {
  const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.orderId, orderId)).orderBy(desc(schema.fundingCases.createdAt)).limit(1);
  if (!fc) return null;
  const quote = fc.quoteId ? (await services.db.select().from(schema.quotes).where(eq(schema.quotes.id, fc.quoteId)).limit(1))[0] ?? null : null;
  const auths = await services.db.select().from(schema.authorisations).where(eq(schema.authorisations.fundingCaseId, fc.id)).orderBy(desc(schema.authorisations.submittedAt));
  return { fundingCase: fc, quote, authorisations: auths };
}

/** Collect card (docs/processes/03 §7.6): computed here, never edited by FDK. Previous balance comes from cluster C by table name when present. */
export async function collectCard(services: Services, orderId: string) {
  const f = await fundingForOrder(services, orderId);
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) throw notFound('Order');
  let previousBalanceCents = 0;
  try {
    const rows = (await services.db.all(sql`select coalesce(sum(balance_cents),0) as b from patient_accounts where patient_id = ${order.patientId}`)) as Array<{ b: number }>;
    previousBalanceCents = Number(rows[0]?.b ?? 0);
  } catch {
    /* patient_accounts belongs to cluster C; 0 until it exists */
  }
  const [enc] = await services.db.select({ collectedCents: schema.encounters.collectedCents }).from(schema.encounters).where(eq(schema.encounters.orderId, orderId)).orderBy(desc(schema.encounters.createdAt)).limit(1);
  const depositsPaidCents = enc?.collectedCents ?? 0;
  const fc = f?.fundingCase;
  const patientPortionCents = fc?.patientPortionCents ?? 0;
  const reasonText: Record<string, string> = { CO_PAYMENT: 'co-payment on this option', NETWORK_CO_PAYMENT: 'network co-payment: this Practice is not in the option’s designated network for this procedure', BENEFIT_EXHAUSTED: 'radiology benefit exhausted for the year', MEMBERSHIP_INVALID: 'membership could not be confirmed; cash tariff applies', CASH: 'cash tariff', CONTRACT: 'contract: no patient portion', COVERED: 'covered at scheme rate', UNCHECKED: 'benefit not yet checked' };
  return {
    orderId, fundingCaseId: fc?.id ?? null, status: fc?.status ?? 'unknown', funderType: fc?.funderType ?? order.funderType ?? 'cash', schemeName: fc?.schemeName ?? null, schemeOption: fc?.schemeOption ?? null,
    procedure: order.procedures.map((p) => p.description).join(' + '), lines: f?.quote?.lines ?? [], subtotalCents: f?.quote?.subtotalCents ?? 0, vatCents: f?.quote?.vatCents ?? 0, totalCents: fc?.totalCents ?? 0,
    schemePortionCents: fc?.schemePortionCents ?? 0, patientPortionCents, reasonCodes: fc?.reasonCodes ?? [], reasons: (fc?.reasonCodes ?? []).map((k) => reasonText[k] ?? k.toLowerCase()),
    previousBalanceCents, depositsPaidCents, collectNowCents: Math.max(0, patientPortionCents + previousBalanceCents - depositsPaidCents),
    authRequired: fc?.authRequired ?? false, authStatus: fc?.authStatus ?? 'not_required', authNumber: fc?.authNumber ?? null, quoteVersion: f?.quote?.version ?? null, quoteId: f?.quote?.id ?? null, quoteValidUntil: f?.quote?.validUntil ?? null, binding: f?.quote?.binding ?? false,
    assumptions: f?.quote?.assumptions ?? [], paymentMethods: ['card', 'payshap', 'eft', 'qr'], benefitCheckedAt: fc?.benefitCheck?.checkedAt ?? null, benefitMessage: fc?.benefitCheck?.message ?? null,
  };
}

/* ---------------- Authorisation Hand ---------------- */
export const authorisationHand = defineHand({
  id: 'authorisation', name: 'Authorisation Hand', module: 'M06', level: 'A3',
  mandate: 'Check eligibility, evaluate authorisation rules, submit and chase pre-authorisation requests, record outcomes and keep the quote current. Never alters codes to obtain approval; never accepts proceed-at-risk for the patient.',
  defaultLeash: { maxEstimatedCents: 2_500_000, maxResubmissions: 1, maxContactsPerPartyPerDay: 3 },
  approvalPersona: 'BIL', approvalPolicy: 'BIL confirms submissions above R25 000 estimated value and any motivation letter; declines and partial approvals go to the BIL review queue.',
  tools: { 'order.read': 'R0', 'funder.validate_membership': 'R0', 'funder.benefit_enquiry': 'R0', 'funder.auth_submit': 'R2', 'funder.auth_status': 'R0', 'quote.compute': 'R1', 'referral.read_motivation': 'R0', 'message.send': 'R2', 'task.create': 'R1' },
});

export interface AuthHandInput extends Record<string, unknown> { fundingCaseId: string; resubmit?: boolean }

export function registerAuthorisationHand() {
  registerHand<AuthHandInput, Record<string, unknown>>(authorisationHand, async (input, ctx) => {
    const services = ctx.services;
    const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, input.fundingCaseId)).limit(1);
    if (!fc) throw new Error('Funding case not found');
    const order = await ctx.step('order.read', { orderId: fc.orderId }, async () => (await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, fc.id)).limit(1))[0] && (await services.db.select().from(schema.orders).where(eq(schema.orders.id, fc.orderId)).limit(1))[0]);
    if (!order) throw new Error('Order not found');
    if (!fc.authRequired) { ctx.log('No authorisation required for this funding position'); return { status: 'not_required' }; }
    const prior = await services.db.select().from(schema.authorisations).where(eq(schema.authorisations.fundingCaseId, fc.id));
    if (prior.some((a) => a.status === 'approved')) { ctx.log('Already authorised'); return { status: 'approved', authNumber: prior.find((a) => a.status === 'approved')!.authNumber }; }
    ctx.leashCheck([{ rule: 'maxEstimatedCents', actual: fc.totalCents }, { rule: 'maxResubmissions', actual: prior.length }]);
    const motivation = await ctx.step('referral.read_motivation', { orderId: order.id }, async () => order.clinicalInfo ?? null);
    const proc = order.procedures[0]!;
    const payload = { funderCode: fc.funderId ?? 'unknown', memberNo: fc.memberNo, option: fc.schemeOption, procedureCode: proc.code, modality: proc.modality, icd10: order.icd10, estimatedCents: fc.totalCents, clinicalMotivation: motivation, resubmission: input.resubmit ?? prior.length > 0 };
    const res = await ctx.step('funder.auth_submit', { funder: payload.funderCode, procedure: proc.code, estimatedCents: fc.totalCents, icd10: order.icd10 }, async () => simulateAuth(payload), 'funder simulator');
    const now = new Date().toISOString();
    const authId = newId('aut');
    await services.db.insert(schema.authorisations).values({ id: authId, practiceId: fc.practiceId, fundingCaseId: fc.id, orderId: fc.orderId, funderId: fc.funderId, status: res.status, requestPayload: { ...payload, memberNo: fc.memberNo ? `····${fc.memberNo.slice(-4)}` : null }, responsePayload: res as unknown as Record<string, unknown>, funderReference: res.reference, authNumber: res.authNumber ?? null, validFrom: res.validFrom ?? null, validTo: res.validTo ?? null, approvedCents: res.approvedCents ?? null, reason: res.reason ?? null, attempts: prior.length + 1, submittedBy: 'hand:authorisation', submittedAt: now, respondedAt: now });
    const caseStatus = res.status === 'approved' ? 'authorised' : res.status === 'declined' ? 'auth_declined' : 'auth_more_info';
    await services.db.update(schema.fundingCases).set({ status: caseStatus, authStatus: res.status, authNumber: res.authNumber ?? null, authValidTo: res.validTo ?? null, updatedAt: now }).where(eq(schema.fundingCases.id, fc.id));
    await emitDirect(services, `funding.${caseStatus}.v1`, { fundingCaseId: fc.id, orderId: fc.orderId, patientId: fc.patientId, practiceId: fc.practiceId, authStatus: res.status, authNumber: res.authNumber ?? null, reference: res.reference }, { aggregateType: 'funding_case', aggregateId: fc.id, practiceId: fc.practiceId });
    if (res.status !== 'approved') await ctx.step('task.create', { queue: 'BIL', reason: res.reason }, async () => ({ queue: 'authorisation_review', fundingCaseId: fc.id }));
    return { status: res.status, authNumber: res.authNumber ?? null, validTo: res.validTo ?? null, reason: res.reason ?? null, authorisationId: authId };
  });
}

export async function runAuthorisationHand(services: Services, fundingCaseId: string, practiceId: string, trigger = 'funding.quoted.v1') {
  return runHand<AuthHandInput>(services, 'authorisation', { fundingCaseId }, { practiceId, trigger, title: `Authorisation for case ${fundingCaseId.slice(-6)}`, aggregateType: 'funding_case', aggregateId: fundingCaseId });
}
