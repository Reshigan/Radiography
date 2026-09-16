import { describe, expect, it } from 'vitest';
import { METRICS, getMetric, metricsByGroup, assessAgainstTarget } from './metrics.js';
import { benchmark, matchMetrics, median, percentile, whatIfSecondModality, parseQuestionFilters, irr, caseMixAdjust } from './helpers.js';

describe('metric catalogue', () => {
  it('has at least 60 definitions with unique ids and every required field', () => {
    expect(METRICS.length).toBeGreaterThanOrEqual(60);
    const ids = new Set(METRICS.map((d) => d.id));
    expect(ids.size).toBe(METRICS.length);
    for (const d of METRICS) {
      expect(d.name).toBeTruthy();
      expect(d.formula).toBeTruthy();
      expect(d.grain).toBeTruthy();
      expect(d.owner).toBeTruthy();
      expect(['higher', 'lower', 'band']).toContain(d.direction);
      expect(d.sources.length).toBeGreaterThan(0);
      expect(d.keywords.length).toBeGreaterThan(0);
    }
  });
  it('groups follow docs/13 §4', () => {
    const groups = metricsByGroup().map((g) => g.group);
    expect(groups).toEqual(['access', 'operations', 'clinical_quality', 'patient_experience', 'referrer', 'revenue_cycle', 'finance', 'workforce', 'assets', 'compliance', 'ai_ops', 'shareholder']);
    expect(getMetric('AIO.SLIP')?.target).toBe(0);
  });
  it('assesses values against targets by direction', () => {
    expect(assessAgainstTarget(getMetric('OPS.TAT.SLA')!, 96)).toBe('ok');
    expect(assessAgainstTarget(getMetric('OPS.TAT.SLA')!, 88)).toBe('att');
    expect(assessAgainstTarget(getMetric('OPS.TAT.SLA')!, 60)).toBe('crit');
    expect(assessAgainstTarget(getMetric('ACC.NOSHOW')!, 4)).toBe('ok');
    expect(assessAgainstTarget(getMetric('ACC.NOSHOW')!, 9)).toBe('crit');
    expect(assessAgainstTarget(getMetric('OPS.UTIL')!, 78)).toBe('ok');
    expect(assessAgainstTarget(getMetric('OPS.UTIL')!, 65)).toBe('att');
    expect(assessAgainstTarget(getMetric('OPS.UTIL')!, 50)).toBe('crit');
    expect(assessAgainstTarget(getMetric('OPS.UTIL')!, null)).toBe('none');
  });
});

describe('statistics and benchmarking', () => {
  it('median and percentile', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
  it('suppresses small cells with complementary suppression and anonymises peers', () => {
    const r = benchmark([
      { practiceId: 'a', label: 'A', value: 10, n: 100 }, { practiceId: 'b', label: 'B', value: 20, n: 50 }, { practiceId: 'c', label: 'C', value: 30, n: 5 },
    ], { identify: false });
    expect(r.rows.map((x) => x.label)).toEqual(['P1', 'P2', 'P3']);
    expect(r.rows[2]!.value).toBeNull();
    // complementary: exactly one small cell → next smallest also suppressed
    expect(r.rows[1]!.value).toBeNull();
    expect(r.suppressed).toBe(2);
    expect(r.peerMedian).toBe(10);
    const identified = benchmark([{ practiceId: 'a', label: 'A', value: 10, n: 100 }, { practiceId: 'b', label: 'B', value: 20, n: 50 }], { identify: true });
    expect(identified.rows[0]!.label).toBe('A');
    expect(identified.peerMedian).toBe(15);
  });
  it('case-mix adjusts by indirect standardisation', () => {
    expect(caseMixAdjust(200, 250, 180)).toBe(144);
    expect(caseMixAdjust(200, 0, 180)).toBeNull();
  });
});

describe('insight matching', () => {
  it('maps natural-language questions to metrics by keywords', () => {
    expect(matchMetrics('Which sites are over 85 % CT utilisation for three months?')[0]!.metric.id).toBe('OPS.UTIL');
    expect(matchMetrics('Which referrers dropped more than 30 % this month?')[0]!.metric.id).toBe('REF.CHURN');
    expect(matchMetrics('Show my no-show rate by weekday')[0]!.metric.id).toBe('ACC.NOSHOW');
    expect(matchMetrics('how many AI slips this year')[0]!.metric.id).toBe('AIO.SLIP');
    expect(matchMetrics('zzqx unknown thing')).toEqual([]);
  });
  it('parses simple filters', () => {
    const f = parseQuestionFilters('Which sites are over 85 % CT utilisation in the last 3 months at Umhlanga?');
    expect(f.modality).toBe('CT');
    expect(f.threshold).toBe(85);
    expect(f.comparator).toBe('over');
    expect(f.siteHint).toBe('umhlanga');
  });
});

describe('what-if', () => {
  it('second modality payback model returns a payback and assumptions', () => {
    const out = whatIfSecondModality();
    expect(out.paybackMonths).not.toBeNull();
    expect(out.paybackMonths!).toBeGreaterThan(12);
    expect(out.paybackMonths!).toBeLessThan(60);
    expect(out.monthlyCashflow.length).toBe(60);
    expect(out.assumptions.length).toBeGreaterThanOrEqual(8);
    expect(out.utilisationYear1Pct).toBeGreaterThan(50);
    const worse = whatIfSecondModality({ studiesPerDayYear1: 6 });
    expect(worse.paybackMonths).toBeNull();
    expect(irr([-100, 60, 60])).toBeGreaterThan(10);
  });
});
