import { describe, expect, it } from 'vitest';
import { computePnl, consolidate, distributionWaterfall, intercompanyAmount, journalBalanced, journalForEvent, periodBounds, previousPeriods, solvencyLiquidityTest } from './finance.js';

describe('posting rules', () => {
  it('produces balanced journals for M14 events and null for unknown', () => {
    const j = journalForEvent('charge.captured.v1', { chargeId: 'c1', practiceId: 'prac_a', siteId: 's', modality: 'CT', funderType: 'scheme', subtotalExclCents: 100000, vatCents: 15000 })!;
    expect(journalBalanced(j.lines)).toBe(true);
    expect(j.lines.find((l) => l.account === '4000')?.creditCents).toBe(100000);
    expect(j.lines.find((l) => l.account === '2100')?.creditCents).toBe(15000);
    const pay = journalForEvent('payment.received.v1', { paymentId: 'p1', practiceId: 'prac_a', amountCents: 5000, method: 'card', funderType: 'cash' })!;
    expect(journalBalanced(pay.lines)).toBe(true);
    expect(pay.lines[0]).toMatchObject({ account: '1000', debitCents: 5000 });
    expect(journalForEvent('writeoff.approved.v1', { writeOffId: 'w', practiceId: 'p', amountCents: 100, reason: 'goodwill' })!.lines[0]!.account).toBe('5200');
    expect(journalForEvent('something.else.v1', {})).toBeNull();
  });
});

describe('practice P&L', () => {
  it('builds the P&L bridge from revenue to distributable profit', () => {
    const p = computePnl({ revenueCents: 790000000, shortPaymentsCents: 6400000, signedReports: 4812, collectionsCents: 765000000, studies: 4812, managementFeeRate: 0.08, readingFeePerStudyCents: 32000, platformFeePerStudyCents: 0, rentCents: 42000000, staffCents: 213000000, consumablesCents: 69000000, otherCents: 42400000, depreciationCents: 18000000, taxRate: 0.27, reservePct: 0.1 });
    expect(p.readingFeesCents).toBe(4812 * 32000);
    expect(p.managementFeeCents).toBe(61200000);
    expect(p.ebitdaCents).toBe(790000000 - 6400000 - 4812 * 32000 - 61200000 - 42000000 - 213000000 - 69000000 - 42400000);
    expect(p.profitAfterTaxCents).toBe(p.profitBeforeTaxCents - p.taxProvisionCents);
    expect(p.distributableCents).toBe(p.profitAfterTaxCents - p.reserveCents);
    expect(p.lines.find((l) => l.key === 'distributable')!.amountCents).toBe(p.distributableCents);
  });
  it('computes intercompany amounts with VAT', () => {
    const mf = intercompanyAmount({ type: 'management_agreement', fromEntityId: 'ent_mso', toEntityId: 'prac_b', feeModel: { basis: 'pct_of_collections', rate: 0.08 } }, { collectionsCents: 1000000, signedReports: 10, studies: 12 });
    expect(mf).toMatchObject({ amountExclCents: 80000, vatCents: 12000, totalCents: 92000 });
    const rf = intercompanyAmount({ type: 'reading_services', fromEntityId: 'ent_hub', toEntityId: 'prac_b', feeModel: { basis: 'per_study', perStudyCents: 32000 } }, { collectionsCents: 0, signedReports: 10, studies: 12 });
    expect(rf.amountExclCents).toBe(320000);
  });
});

describe('distribution waterfall for the 51/49 JV', () => {
  const holdings = [
    { shareholderName: 'Bonakala Professional Holdings Inc.', shareClass: 'A ordinary', shares: 510, effectiveFrom: '2026-02-01' },
    { shareholderName: 'Dr A. Pillay', shareClass: 'B ordinary', shares: 245, effectiveFrom: '2026-02-01' },
    { shareholderName: 'Dr S. Naidoo', shareClass: 'B ordinary', shares: 245, effectiveFrom: '2026-02-01' },
  ];
  it('splits pro-rata by shares with dividends tax and exact totals', () => {
    const w = distributionWaterfall({ distributableCents: 141200000, holdings, periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    const hold = w.entitlements.find((e) => e.shareholderName.startsWith('Bonakala'))!;
    const pillay = w.entitlements.find((e) => e.shareholderName === 'Dr A. Pillay')!;
    expect(hold.pct).toBe(51);
    expect(pillay.pct).toBe(24.5);
    expect(hold.grossCents).toBe(72012000);
    expect(pillay.grossCents).toBe(34594000);
    expect(pillay.dividendsTaxCents).toBe(Math.round(34594000 * 0.2));
    expect(pillay.netCents).toBe(34594000 - pillay.dividendsTaxCents);
    expect(w.totalGrossCents + w.roundingCents).toBe(141200000);
    expect(w.segments).toHaveLength(1);
  });
  it('segments a mid-period transfer by days and keeps history exact', () => {
    const transfer = [
      holdings[0]!,
      { ...holdings[1]!, effectiveTo: '2026-08-14' },
      { shareholderName: 'Dr A. Pillay', shareClass: 'B ordinary', shares: 122, effectiveFrom: '2026-08-15' },
      { shareholderName: 'Dr T. Mthembu', shareClass: 'B ordinary', shares: 123, effectiveFrom: '2026-08-15' },
      holdings[2]!,
    ];
    const w = distributionWaterfall({ distributableCents: 310000000, holdings: transfer, periodStart: '2026-08-01', periodEnd: '2026-08-31', exemptShareholders: ['Bonakala Professional Holdings Inc.'] });
    expect(w.segments.map((s) => s.days)).toEqual([14, 17]);
    const mthembu = w.entitlements.find((e) => e.shareholderName === 'Dr T. Mthembu')!;
    expect(mthembu.segments).toHaveLength(1);
    expect(mthembu.segments[0]!.from).toBe('2026-08-15');
    const pillay = w.entitlements.find((e) => e.shareholderName === 'Dr A. Pillay')!;
    expect(pillay.segments).toHaveLength(2);
    expect(w.entitlements.find((e) => e.shareholderName.startsWith('Bonakala'))!.dividendsTaxCents).toBe(0);
    expect(Math.abs(w.roundingCents)).toBeLessThan(10);
  });
  it('runs the solvency and liquidity test', () => {
    expect(solvencyLiquidityTest({ cashCents: 500, receivablesCents: 900, liabilitiesCents: 300, proposedCents: 200, workingCapitalFloorCents: 100 }).passed).toBe(true);
    const fail = solvencyLiquidityTest({ cashCents: 150, receivablesCents: 900, liabilitiesCents: 300, proposedCents: 200, workingCapitalFloorCents: 100 });
    expect(fail.passed).toBe(false);
    expect(fail.liquidity).toBe(false);
  });
});

describe('consolidation', () => {
  it('eliminates matched intercompany pairs and computes minority interest for the JV', () => {
    const pnlA = computePnl({ revenueCents: 1000, shortPaymentsCents: 0, signedReports: 0, collectionsCents: 1000, studies: 0, managementFeeRate: 0.08, readingFeePerStudyCents: 0, platformFeePerStudyCents: 0, rentCents: 0, staffCents: 0, consumablesCents: 0, otherCents: 0, depreciationCents: 0, taxRate: 0, reservePct: 0 });
    const c = consolidate([
      { entityId: 'prac_a', name: 'A', ownershipPct: 100, method: 'full', pnl: pnlA, intercompanyChargesCents: 80 },
      { entityId: 'prac_b', name: 'B', ownershipPct: 51, method: 'full', pnl: pnlA, intercompanyChargesCents: 80 },
      { entityId: 'aff', name: 'Affiliate', ownershipPct: 0, method: 'none', pnl: pnlA, intercompanyChargesCents: 0 },
    ], [{ pair: 'ent_mso→prac_a', amountCents: 80, matched: true }, { pair: 'ent_mso→prac_b', amountCents: 80, matched: true }]);
    expect(c.revenueCents).toBe(2000);
    expect(c.eliminationsCents).toBe(160);
    expect(c.entities).toHaveLength(2);
    expect(c.entities[1]!.minorityInterestCents).toBe(Math.round(920 * 0.49));
    expect(c.attributableToGroupCents).toBe(c.profitAfterTaxCents - c.minorityInterestCents);
  });
  it('period helpers', () => {
    expect(periodBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousPeriods('2026-09', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});
