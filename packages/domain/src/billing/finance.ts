/**
 * Finance & Consolidation (docs/processes/10): posting rules for M14 events, practice P&L construction,
 * intercompany rules, distribution waterfall over effective-dated shareholdings (pro-rata by days) and
 * group consolidation with eliminations and minority interest. Pure functions; integer cents.
 */
import { VAT_RATE } from '../shared/money.js';
import { daysBetween } from './rules.js';

/* ---------- Chart of accounts (Group standard, illustrative) ---------- */
export interface GlAccount { code: string; name: string; type: 'revenue' | 'contra_revenue' | 'expense' | 'asset' | 'liability' | 'equity' | 'intercompany'; ifrsGroup: string }
export const CHART_OF_ACCOUNTS: GlAccount[] = [
  { code: '1000', name: 'Bank and cash', type: 'asset', ifrsGroup: 'Cash and cash equivalents' },
  { code: '1100', name: 'Trade receivables: scheme', type: 'asset', ifrsGroup: 'Trade receivables' },
  { code: '1110', name: 'Trade receivables: patient', type: 'asset', ifrsGroup: 'Trade receivables' },
  { code: '1120', name: 'Trade receivables: RAF and COIDA', type: 'asset', ifrsGroup: 'Trade receivables' },
  { code: '1130', name: 'Trade receivables: corporate', type: 'asset', ifrsGroup: 'Trade receivables' },
  { code: '1190', name: 'Loss allowance (ECL)', type: 'asset', ifrsGroup: 'Trade receivables' },
  { code: '1500', name: 'Intercompany receivable', type: 'intercompany', ifrsGroup: 'Intercompany' },
  { code: '2100', name: 'VAT output', type: 'liability', ifrsGroup: 'Current tax liabilities' },
  { code: '2110', name: 'VAT input', type: 'liability', ifrsGroup: 'Current tax liabilities' },
  { code: '2500', name: 'Intercompany payable', type: 'intercompany', ifrsGroup: 'Intercompany' },
  { code: '2600', name: 'Distributions payable', type: 'liability', ifrsGroup: 'Other liabilities' },
  { code: '2700', name: 'Dividends tax withheld', type: 'liability', ifrsGroup: 'Current tax liabilities' },
  { code: '3000', name: 'Retained earnings', type: 'equity', ifrsGroup: 'Equity' },
  { code: '3100', name: 'Reserves per shareholders agreement', type: 'equity', ifrsGroup: 'Equity' },
  { code: '4000', name: 'Imaging revenue: scheme', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '4010', name: 'Imaging revenue: patient and cash', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '4020', name: 'Imaging revenue: RAF and COIDA', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '4030', name: 'Imaging revenue: corporate', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '4100', name: 'Contractual adjustments and short-payments', type: 'contra_revenue', ifrsGroup: 'Revenue' },
  { code: '4500', name: 'Reading fee income (Hub)', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '4510', name: 'Management fee income (MSO)', type: 'revenue', ifrsGroup: 'Revenue' },
  { code: '5000', name: 'Reading fees', type: 'expense', ifrsGroup: 'Cost of sales' },
  { code: '5100', name: 'Contrast and consumables', type: 'expense', ifrsGroup: 'Cost of sales' },
  { code: '5200', name: 'Bad debt expense', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '5210', name: 'ECL provision movement', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '6000', name: 'Staff costs', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '6100', name: 'Management fee (MSO)', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '6110', name: 'Platform fee (MSO)', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '6200', name: 'Rent and facilities', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '6300', name: 'Other operating costs', type: 'expense', ifrsGroup: 'Operating expenses' },
  { code: '7000', name: 'Depreciation', type: 'expense', ifrsGroup: 'Depreciation and amortisation' },
  { code: '8000', name: 'Tax provision', type: 'expense', ifrsGroup: 'Income tax' },
  { code: '9990', name: 'Suspense', type: 'liability', ifrsGroup: 'Suspense' },
];
export const ACCOUNT_BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

export interface JournalLine { account: string; debitCents: number; creditCents: number; dimensions?: Record<string, string> }
export interface Journal { source: string; sourceRef: string; description: string; lines: JournalLine[] }
export function journalBalanced(lines: JournalLine[]): boolean {
  return lines.reduce((a, l) => a + l.debitCents - l.creditCents, 0) === 0;
}
const recvAccount = (funderType: string) => (funderType === 'scheme' ? '1100' : funderType === 'cash' ? '1110' : funderType === 'raf' || funderType === 'coida' ? '1120' : '1130');
const revAccount = (funderType: string) => (funderType === 'scheme' ? '4000' : funderType === 'cash' ? '4010' : funderType === 'raf' || funderType === 'coida' ? '4020' : '4030');

/** Posting rules (gl_mapping) for M14 financial events. Unknown event types post to suspense. */
export function journalForEvent(name: string, p: Record<string, any>): Journal | null {
  switch (name) {
    case 'charge.captured.v1': {
      const excl = Number(p.subtotalExclCents ?? 0), vat = Number(p.vatCents ?? 0);
      if (!excl) return null;
      return { source: 'm14', sourceRef: String(p.chargeId), description: `Revenue recognised for charge ${p.chargeId}`, lines: [
        { account: recvAccount(p.funderType), debitCents: excl + vat, creditCents: 0, dimensions: { practice: p.practiceId, site: p.siteId, modality: p.modality, funderType: p.funderType } },
        { account: revAccount(p.funderType), debitCents: 0, creditCents: excl, dimensions: { practice: p.practiceId, site: p.siteId, modality: p.modality, funderType: p.funderType } },
        { account: '2100', debitCents: 0, creditCents: vat, dimensions: { practice: p.practiceId } },
      ] };
    }
    case 'payment.received.v1': {
      const amt = Number(p.amountCents ?? 0);
      if (!amt) return null;
      return { source: 'm14', sourceRef: String(p.paymentId ?? p.remittanceId), description: `Cash received (${p.method ?? 'remittance'})`, lines: [
        { account: '1000', debitCents: amt, creditCents: 0, dimensions: { practice: p.practiceId } },
        { account: recvAccount(p.funderType ?? 'cash'), debitCents: 0, creditCents: amt, dimensions: { practice: p.practiceId } },
      ] };
    }
    case 'claim.short_paid.v1': {
      const amt = Number(p.shortCents ?? 0);
      if (!amt) return null;
      return { source: 'm14', sourceRef: String(p.claimId), description: `Contractual adjustment (${p.shortPaymentClass})`, lines: [
        { account: '4100', debitCents: amt, creditCents: 0, dimensions: { practice: p.practiceId, funderType: 'scheme' } },
        { account: '1100', debitCents: 0, creditCents: amt, dimensions: { practice: p.practiceId } },
      ] };
    }
    case 'patient.liability.v1': {
      const amt = Number(p.amountCents ?? 0);
      if (!amt) return null;
      return { source: 'm14', sourceRef: String(p.accountId), description: `Liability transferred to patient (${p.reason})`, lines: [
        { account: '1110', debitCents: amt, creditCents: 0, dimensions: { practice: p.practiceId } },
        { account: '1100', debitCents: 0, creditCents: amt, dimensions: { practice: p.practiceId } },
      ] };
    }
    case 'writeoff.approved.v1': {
      const amt = Number(p.amountCents ?? 0);
      if (!amt) return null;
      return { source: 'm14', sourceRef: String(p.writeOffId), description: `Write-off (${p.reason})`, lines: [
        { account: '5200', debitCents: amt, creditCents: 0, dimensions: { practice: p.practiceId, reason: p.reason } },
        { account: '1110', debitCents: 0, creditCents: amt, dimensions: { practice: p.practiceId } },
      ] };
    }
    default:
      return null;
  }
}

/* ---------- Practice P&L ---------- */
export interface PnlInputs {
  revenueCents: number; // gross at expected transaction price (excl VAT)
  shortPaymentsCents: number; // contractual adjustments + write-offs
  signedReports: number;
  collectionsCents: number;
  studies: number;
  managementFeeRate: number; // e.g. 0.08 of collections
  readingFeePerStudyCents: number;
  platformFeePerStudyCents: number;
  rentCents: number;
  staffCents: number;
  consumablesCents: number;
  otherCents: number;
  depreciationCents: number;
  taxRate: number; // 0.27 illustrative corporate rate
  reservePct: number; // shareholders' agreement reserve, e.g. 0.10
}
export interface PnlLine { key: string; label: string; amountCents: number; basis?: string }
export interface Pnl {
  lines: PnlLine[];
  revenueCents: number; shortPaymentsCents: number; netRevenueCents: number; readingFeesCents: number; managementFeeCents: number; platformFeeCents: number; rentCents: number;
  staffCents: number; consumablesCents: number; otherCents: number; ebitdaCents: number; depreciationCents: number; profitBeforeTaxCents: number; taxProvisionCents: number;
  profitAfterTaxCents: number; reserveCents: number; distributableCents: number; ebitdaMarginPct: number;
}
export function computePnl(i: PnlInputs): Pnl {
  const netRevenueCents = i.revenueCents - i.shortPaymentsCents;
  const readingFeesCents = i.signedReports * i.readingFeePerStudyCents;
  const managementFeeCents = Math.round(i.collectionsCents * i.managementFeeRate);
  const platformFeeCents = i.studies * i.platformFeePerStudyCents;
  const ebitdaCents = netRevenueCents - readingFeesCents - managementFeeCents - platformFeeCents - i.rentCents - i.staffCents - i.consumablesCents - i.otherCents;
  const profitBeforeTaxCents = ebitdaCents - i.depreciationCents;
  const taxProvisionCents = Math.max(0, Math.round(profitBeforeTaxCents * i.taxRate));
  const profitAfterTaxCents = profitBeforeTaxCents - taxProvisionCents;
  const reserveCents = Math.max(0, Math.round(profitAfterTaxCents * i.reservePct));
  const distributableCents = Math.max(0, profitAfterTaxCents - reserveCents);
  const lines: PnlLine[] = [
    { key: 'revenue', label: 'Revenue', amountCents: i.revenueCents, basis: 'Charges at expected transaction price, service date' },
    { key: 'short_payments', label: 'Short-payments and write-offs', amountCents: -i.shortPaymentsCents, basis: 'Remittance true-up and approved write-offs' },
    { key: 'reading_fees', label: 'Reading fees to Hub', amountCents: -readingFeesCents, basis: `${i.signedReports} signed reports × per-study schedule` },
    { key: 'management_fee', label: `Management fee (${Math.round(i.managementFeeRate * 100)} % of collections)`, amountCents: -managementFeeCents, basis: 'Intercompany rule: MSO management agreement' },
    { key: 'platform_fee', label: 'Platform fee', amountCents: -platformFeeCents, basis: `${i.studies} studies × platform fee` },
    { key: 'rent', label: 'Rent (intercompany)', amountCents: -i.rentCents, basis: 'Lease schedule' },
    { key: 'staff', label: 'Staff', amountCents: -i.staffCents, basis: 'Illustrative fixed (M17 payroll export)' },
    { key: 'consumables', label: 'Consumables', amountCents: -i.consumablesCents, basis: 'Illustrative (M18 stock at cost)' },
    { key: 'other', label: 'Other operating costs', amountCents: -i.otherCents, basis: 'Supplier invoices and allocations' },
    { key: 'ebitda', label: 'EBITDA', amountCents: ebitdaCents },
    { key: 'depreciation', label: 'Depreciation', amountCents: -i.depreciationCents },
    { key: 'tax', label: 'Tax provision', amountCents: -taxProvisionCents, basis: `${Math.round(i.taxRate * 100)} % illustrative` },
    { key: 'reserve', label: 'Reserve per shareholders agreement', amountCents: -reserveCents, basis: `${Math.round(i.reservePct * 100)} % of profit after tax` },
    { key: 'distributable', label: 'Distributable profit', amountCents: distributableCents },
  ];
  return {
    lines, revenueCents: i.revenueCents, shortPaymentsCents: i.shortPaymentsCents, netRevenueCents, readingFeesCents, managementFeeCents, platformFeeCents, rentCents: i.rentCents,
    staffCents: i.staffCents, consumablesCents: i.consumablesCents, otherCents: i.otherCents, ebitdaCents, depreciationCents: i.depreciationCents, profitBeforeTaxCents, taxProvisionCents, profitAfterTaxCents, reserveCents, distributableCents,
    ebitdaMarginPct: i.revenueCents ? Math.round((ebitdaCents / i.revenueCents) * 1000) / 10 : 0,
  };
}

/* ---------- Intercompany ---------- */
export interface IntercompanyRule { type: 'management_agreement' | 'reading_services' | 'lease' | 'platform_fee'; fromEntityId: string; toEntityId: string; feeModel: { basis: string; rate?: number; perStudyCents?: number; monthlyCents?: number } }
export function intercompanyAmount(rule: IntercompanyRule, evidence: { collectionsCents: number; signedReports: number; studies: number }): { amountExclCents: number; vatCents: number; totalCents: number; basis: string } {
  let amount = 0;
  let basis = '';
  const fm = rule.feeModel;
  if (fm.basis === 'pct_of_collections') { amount = Math.round(evidence.collectionsCents * (fm.rate ?? 0)); basis = `${Math.round((fm.rate ?? 0) * 100)} % of collections R ${(evidence.collectionsCents / 100).toFixed(2)}`; }
  else if (fm.basis === 'per_study' && rule.type === 'reading_services') { amount = evidence.signedReports * (fm.perStudyCents ?? 0); basis = `${evidence.signedReports} signed reports × R ${((fm.perStudyCents ?? 0) / 100).toFixed(2)}`; }
  else if (fm.basis === 'per_study') { amount = evidence.studies * (fm.perStudyCents ?? 0); basis = `${evidence.studies} studies × R ${((fm.perStudyCents ?? 0) / 100).toFixed(2)}`; }
  else if (fm.basis === 'monthly') { amount = fm.monthlyCents ?? 0; basis = 'lease schedule, monthly'; }
  const vat = Math.round(amount * VAT_RATE);
  return { amountExclCents: amount, vatCents: vat, totalCents: amount + vat, basis };
}

/* ---------- Distribution waterfall over effective-dated shareholdings ---------- */
export interface Shareholding { shareholderName: string; shareholderUserId?: string | null; shareClass: string; shares: number; effectiveFrom: string; effectiveTo?: string | null }
export interface Entitlement { shareholderName: string; shareholderUserId?: string | null; shareClass: string; pct: number; grossCents: number; dividendsTaxCents: number; netCents: number; segments: Array<{ from: string; to: string; days: number; pct: number; grossCents: number }> }
export interface WaterfallResult { distributableCents: number; entitlements: Entitlement[]; segments: Array<{ from: string; to: string; days: number; capTable: Array<{ shareholderName: string; shares: number; pct: number }> }>; dividendsTaxRate: number; totalGrossCents: number; totalNetCents: number; roundingCents: number }

/** Pro-rata by economic percentage per day-segment (docs/10 §8.2–8.3). Dividends tax illustrative 20 %. */
export function distributionWaterfall(input: { distributableCents: number; holdings: Shareholding[]; periodStart: string; periodEnd: string; dividendsTaxRate?: number; exemptShareholders?: string[] }): WaterfallResult {
  const rate = input.dividendsTaxRate ?? 0.2;
  const boundaries = new Set<string>([input.periodStart]);
  for (const h of input.holdings) {
    if (h.effectiveFrom > input.periodStart && h.effectiveFrom <= input.periodEnd) boundaries.add(h.effectiveFrom);
    if (h.effectiveTo && h.effectiveTo >= input.periodStart && h.effectiveTo < input.periodEnd) boundaries.add(addDay(h.effectiveTo));
  }
  const starts = [...boundaries].sort();
  const totalDays = daysBetween(input.periodStart, input.periodEnd) + 1;
  const segments: WaterfallResult['segments'] = [];
  const byName = new Map<string, Entitlement>();
  let allocated = 0;
  starts.forEach((from, idx) => {
    const to = idx + 1 < starts.length ? subDay(starts[idx + 1]!) : input.periodEnd;
    const days = daysBetween(from, to) + 1;
    const active = input.holdings.filter((h) => h.effectiveFrom <= to && (!h.effectiveTo || h.effectiveTo >= from));
    const totalShares = active.reduce((a, h) => a + h.shares, 0) || 1;
    const segmentCents = Math.round((input.distributableCents * days) / totalDays);
    const capTable = active.map((h) => ({ shareholderName: h.shareholderName, shares: h.shares, pct: Math.round((h.shares / totalShares) * 10000) / 100 }));
    segments.push({ from, to, days, capTable });
    for (const h of active) {
      const gross = Math.round((segmentCents * h.shares) / totalShares);
      allocated += gross;
      const e = byName.get(h.shareholderName) ?? { shareholderName: h.shareholderName, shareholderUserId: h.shareholderUserId ?? null, shareClass: h.shareClass, pct: 0, grossCents: 0, dividendsTaxCents: 0, netCents: 0, segments: [] };
      e.grossCents += gross;
      e.segments.push({ from, to, days, pct: Math.round((h.shares / totalShares) * 10000) / 100, grossCents: gross });
      byName.set(h.shareholderName, e);
    }
  });
  const entitlements = [...byName.values()];
  for (const e of entitlements) {
    e.pct = input.distributableCents ? Math.round((e.grossCents / input.distributableCents) * 10000) / 100 : 0;
    const exempt = input.exemptShareholders?.includes(e.shareholderName);
    e.dividendsTaxCents = exempt ? 0 : Math.round(e.grossCents * rate);
    e.netCents = e.grossCents - e.dividendsTaxCents;
  }
  return { distributableCents: input.distributableCents, entitlements, segments, dividendsTaxRate: rate, totalGrossCents: allocated, totalNetCents: entitlements.reduce((a, e) => a + e.netCents, 0), roundingCents: input.distributableCents - allocated };
}
function addDay(iso: string) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function subDay(iso: string) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

/** Companies Act s.46 solvency and liquidity test (configured policy inputs, illustrative). */
export function solvencyLiquidityTest(i: { cashCents: number; receivablesCents: number; liabilitiesCents: number; proposedCents: number; workingCapitalFloorCents: number }): { passed: boolean; solvency: boolean; liquidity: boolean; cashAfterCents: number; notes: string[] } {
  const solvency = i.cashCents + i.receivablesCents - i.liabilitiesCents - i.proposedCents >= 0;
  const cashAfterCents = i.cashCents - i.proposedCents;
  const liquidity = cashAfterCents >= i.workingCapitalFloorCents;
  const notes: string[] = [];
  if (!solvency) notes.push('Assets after distribution would not cover liabilities');
  if (!liquidity) notes.push('Cash after distribution below the working-capital floor');
  return { passed: solvency && liquidity, solvency, liquidity, cashAfterCents, notes };
}

/* ---------- Consolidation with eliminations and minority interest ---------- */
export interface EntityResult { entityId: string; name: string; ownershipPct: number; method: 'full' | 'none'; pnl: Pnl; intercompanyChargesCents: number /* fees this entity pays to group entities */ }
export interface Consolidation {
  revenueCents: number; ebitdaCents: number; profitAfterTaxCents: number; eliminationsCents: number; minorityInterestCents: number; attributableToGroupCents: number;
  entities: Array<{ entityId: string; name: string; ownershipPct: number; revenueCents: number; ebitdaCents: number; profitAfterTaxCents: number; minorityInterestCents: number }>;
  eliminations: Array<{ pair: string; amountCents: number }>;
}
export function consolidate(entities: EntityResult[], intercompanyPairs: Array<{ pair: string; amountCents: number; matched: boolean }>): Consolidation {
  const inScope = entities.filter((e) => e.method === 'full');
  const revenueGross = inScope.reduce((a, e) => a + e.pnl.revenueCents, 0);
  const eliminationsCents = intercompanyPairs.filter((p) => p.matched).reduce((a, p) => a + p.amountCents, 0);
  const rows = inScope.map((e) => ({
    entityId: e.entityId, name: e.name, ownershipPct: e.ownershipPct, revenueCents: e.pnl.revenueCents, ebitdaCents: e.pnl.ebitdaCents, profitAfterTaxCents: e.pnl.profitAfterTaxCents,
    minorityInterestCents: Math.round(e.pnl.profitAfterTaxCents * (1 - e.ownershipPct / 100)),
  }));
  const minorityInterestCents = rows.reduce((a, r) => a + r.minorityInterestCents, 0);
  const profitAfterTaxCents = rows.reduce((a, r) => a + r.profitAfterTaxCents, 0) + inScope.reduce((a, e) => a + e.intercompanyChargesCents, 0);
  // Intercompany fees paid to the MSO/Hub are group income; they net to zero on consolidation, so the
  // group's profit is practice profit before those charges (the fees are eliminated on both sides).
  return {
    revenueCents: revenueGross, ebitdaCents: rows.reduce((a, r) => a + r.ebitdaCents, 0) + inScope.reduce((a, e) => a + e.intercompanyChargesCents, 0), profitAfterTaxCents, eliminationsCents, minorityInterestCents,
    attributableToGroupCents: profitAfterTaxCents - minorityInterestCents, entities: rows, eliminations: intercompanyPairs.map((p) => ({ pair: p.pair, amountCents: p.amountCents })),
  };
}

/** Month helpers used by periods, snapshots and budgets. */
export function periodBounds(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(end).padStart(2, '0')}` };
}
export function previousPeriods(period: string, n: number): string[] {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.unshift(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}
