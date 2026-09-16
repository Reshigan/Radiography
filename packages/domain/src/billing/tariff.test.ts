import { describe, expect, it } from 'vitest';
import { buildSchedule, mapProcedureToTariff, priceCharge, scheduleInForce, splitLiability, type FeeSchedule } from './tariff.js';
import { DEFAULT_PRICING_RULES } from './tariff.js';

const schemeA: FeeSchedule = buildSchedule({ id: 'fs-a', practiceId: 'prac_a', funderId: 'scheme-a', funderType: 'scheme', name: 'Scheme A 2026', kind: 'scheme_rate', version: 1, effectiveFrom: '2026-01-01', upliftPct: 0 });
const cash: FeeSchedule = buildSchedule({ id: 'fs-cash', practiceId: 'prac_a', funderId: 'cash', funderType: 'cash', name: 'Cash 2026', kind: 'cash', version: 1, effectiveFrom: '2026-01-01', upliftPct: 20 });

describe('tariff engine', () => {
  it('prices a single procedure with VAT per line', () => {
    const p = priceCharge({ procedures: [{ code: '30110' }], funderType: 'scheme' }, schemeA);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.exclCents).toBe(52000);
    expect(p.lines[0]!.vatCents).toBe(7800);
    expect(p.totalCents).toBe(59800);
    expect(p.expectedFunderCents).toBe(59800);
    expect(p.expectedPatientCents).toBe(0);
  });

  it('adds contrast administration modifier and NAPPI consumable for a contrast CT', () => {
    const p = priceCharge({ procedures: [{ code: '34320' }], funderType: 'scheme' }, schemeA);
    const codes = p.lines.map((l) => l.code);
    expect(codes).toEqual(['34320', '0012', '700123']);
    expect(p.subtotalExclCents).toBe(342000 + 48000 + 61500);
    expect(p.vatCents).toBe(Math.round(342000 * 0.15) + Math.round(48000 * 0.15) + Math.round(61500 * 0.15));
    expect(p.totalCents).toBe(p.subtotalExclCents + p.vatCents);
    expect(p.lines.every((l) => l.inclCents === l.exclCents + l.vatCents)).toBe(true);
  });

  it('applies the multiple-procedure reduction to the second same-modality procedure only', () => {
    const p = priceCharge({ procedures: [{ code: '34100' }, { code: '34200' }, { code: '30110' }], funderType: 'scheme' }, schemeA);
    const brain = p.lines.find((l) => l.code === '34100')!; // 298000 (secondary)
    const cspine = p.lines.find((l) => l.code === '34200')!; // 318000 primary
    const chest = p.lines.find((l) => l.code === '30110')!; // DX, not reduced (different modality)
    expect(cspine.adjustmentCents).toBe(0);
    expect(brain.adjustmentCents).toBe(-149000);
    expect(brain.exclCents).toBe(149000);
    expect(chest.adjustmentCents).toBe(0);
    const across = priceCharge({ procedures: [{ code: '34200' }, { code: '30110' }], funderType: 'scheme' }, schemeA, { ...DEFAULT_PRICING_RULES, reduceAcrossModalities: true });
    expect(across.lines.find((l) => l.code === '30110')!.adjustmentCents).toBe(-26000);
  });

  it('applies cash uplift, quantity, bilateral and after-hours modifiers', () => {
    const p = priceCharge({ procedures: [{ code: '30150', quantity: 2, laterality: 'bilateral', modifiers: ['0018'] }], funderType: 'cash' }, cash);
    const line = p.lines[0]!;
    expect(line.unitExclCents).toBe(54000); // 45000 × 1.2
    // 108000 base → +25 % after-hours = 135000 → +50 % bilateral = 202500
    expect(line.exclCents).toBe(202500);
    expect(p.expectedPatientCents).toBe(p.totalCents);
    expect(p.patientPortionReason).toBe('cash');
  });

  it('splits network co-pay and PMB zero co-pay', () => {
    expect(splitLiability(100000, 'scheme', { ...DEFAULT_PRICING_RULES, networkCoPayPct: 7 })).toEqual({ expectedFunderCents: 93000, expectedPatientCents: 7000, patientPortionReason: 'network_co_pay' });
    expect(splitLiability(100000, 'scheme', { ...DEFAULT_PRICING_RULES, networkCoPayPct: 7, pmbZeroCoPay: true }, true).expectedPatientCents).toBe(0);
    expect(splitLiability(100000, 'raf', DEFAULT_PRICING_RULES).expectedFunderCents).toBe(100000);
  });

  it('selects the schedule in force on the service date, latest version wins', () => {
    const v1 = { ...schemeA, id: 'v1', version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' };
    const v2 = { ...schemeA, id: 'v2', version: 2, effectiveFrom: '2026-07-01' };
    expect(scheduleInForce([v1, v2], 'scheme-a', '2026-03-10')?.id).toBe('v1');
    expect(scheduleInForce([v1, v2], 'scheme-a', '2026-09-10')?.id).toBe('v2');
    expect(scheduleInForce([v1, v2], 'scheme-b', '2026-09-10')).toBeUndefined();
  });

  it('maps procedure descriptions to tariff codes with confidence', () => {
    expect(mapProcedureToTariff({ code: '35110' })).toMatchObject({ code: '35110', confidence: 0.99 });
    expect(mapProcedureToTariff({ description: 'CT brain with contrast', modality: 'CT' })).toMatchObject({ code: '34101', confidence: 0.9 });
    expect(mapProcedureToTariff({ description: 'Chest PA and lateral', modality: 'DX' })?.code).toBe('30110');
    expect(mapProcedureToTariff({ description: 'unknown thing', modality: 'MG' })?.confidence).toBeLessThan(0.9);
    expect(mapProcedureToTariff({ description: 'x', modality: 'NM' })).toBeNull();
  });

  it('rejects unknown codes and empty charges', () => {
    expect(() => priceCharge({ procedures: [], funderType: 'cash' }, cash)).toThrow();
    expect(() => priceCharge({ procedures: [{ code: '99999' }], funderType: 'cash' }, cash)).toThrow(/Unknown procedure/);
  });
});
