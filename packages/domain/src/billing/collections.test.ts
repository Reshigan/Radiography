import { describe, expect, it } from 'vitest';
import { ageBalances, ageingBucket, ageingTotals, buildPlan, chooseChannel, collectionsExclusions, dunningStepFor, eclProvision, handoverChecklist, isWithinContactWindow, nextContactSlot, propensityToPay, writeOffApprover, DEFAULT_DUNNING_POLICY } from './collections.js';

describe('ageing and provisioning', () => {
  it('buckets by days outstanding', () => {
    expect(ageingBucket(0)).toBe('current');
    expect(ageingBucket(29)).toBe('current');
    expect(ageingBucket(30)).toBe('30');
    expect(ageingBucket(89)).toBe('60');
    expect(ageingBucket(119)).toBe('90');
    expect(ageingBucket(400)).toBe('120+');
  });
  it('ages balances by class with plans on schedule reported as current', () => {
    const m = ageBalances([
      { debtorClass: 'patient', balanceCents: 100000, ageingStartAt: '2026-06-01' },
      { debtorClass: 'patient', balanceCents: 50000, ageingStartAt: '2026-06-01', planOnSchedule: true },
      { debtorClass: 'scheme', balanceCents: 200000, ageingStartAt: '2026-09-01' },
      { debtorClass: 'raf', balanceCents: 0, ageingStartAt: '2023-01-01' },
    ], '2026-09-16');
    expect(m.patient['90']).toBe(100000);
    expect(m.patient.current).toBe(50000);
    expect(m.scheme.current).toBe(200000);
    expect(m.raf.total).toBe(0);
    expect(ageingTotals(m).total).toBe(350000);
  });
  it('computes an ECL provision from the matrix', () => {
    const m = ageBalances([{ debtorClass: 'patient', balanceCents: 100000, ageingStartAt: '2026-01-01' }], '2026-09-16');
    const p = eclProvision(m);
    expect(p.totalExposureCents).toBe(100000);
    expect(p.totalProvisionCents).toBe(65000);
    expect(p.lines[0]).toMatchObject({ debtorClass: 'patient', bucket: '120+', rate: 0.65 });
  });
});

describe('propensity to pay', () => {
  it('scores reachable, small, recent balances high and disputed old balances low; never uses protected features', () => {
    const high = propensityToPay({ amountCents: 40000, daysOutstanding: 5, priorPaymentsOnTime: 3, priorDefaults: 0, channelReachable: true, openDispute: false });
    const low = propensityToPay({ amountCents: 900000, daysOutstanding: 100, priorPaymentsOnTime: 0, priorDefaults: 2, channelReachable: false, openDispute: true });
    expect(high.band).toBe('high');
    expect(high.nextBestAction).toBe('paylink_first');
    expect(low.band).toBe('low');
    expect(low.nextBestAction).toBe('deb_review');
    expect(Object.keys(high.features)).not.toContain('language');
    expect(high.p30).toBeLessThan(high.p60);
    expect(high.p60).toBeLessThanOrEqual(high.p90);
  });
});

describe('dunning policy', () => {
  it('enforces contact windows 08:00–20:00 SAST and no Sundays', () => {
    expect(isWithinContactWindow('2026-09-14T07:30:00Z')).toBe(true); // Mon 09:30 SAST
    expect(isWithinContactWindow('2026-09-14T05:30:00Z')).toBe(false); // Mon 07:30 SAST
    expect(isWithinContactWindow('2026-09-14T18:30:00Z')).toBe(false); // Mon 20:30 SAST
    expect(isWithinContactWindow('2026-09-13T10:00:00Z')).toBe(false); // Sunday
    expect(nextContactSlot('2026-09-13T10:00:00Z')).toBe('2026-09-14T06:00:00.000Z'); // Monday 08:00 SAST
    expect(nextContactSlot('2026-09-14T07:30:00Z')).toBe('2026-09-14T07:30:00.000Z');
  });
  it('chooses the sequence step and channel in consent order', () => {
    expect(dunningStepFor(0)?.action).toBe('statement');
    expect(dunningStepFor(10)?.id).toBe('day7');
    expect(dunningStepFor(50)?.action).toBe('final_notice');
    expect(dunningStepFor(95)?.action).toBe('handover_proposal');
    expect(chooseChannel(['sms', 'email'], DEFAULT_DUNNING_POLICY.steps[1]!)).toBe('sms');
    expect(chooseChannel([], DEFAULT_DUNNING_POLICY.steps[0]!)).toBe('post');
  });
  it('excludes urgent care, disputes, prescription risk, deceased, long-cycle and frequency-capped accounts', () => {
    const asOf = '2026-09-16';
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: ['urgent_care'], debtorClass: 'patient' }, asOf)).toContain('urgent_care');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: ['disputed'], debtorClass: 'patient' }, asOf)).toContain('disputed');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: ['deceased'], debtorClass: 'patient' }, asOf)).toContain('deceased');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2023-10-20', flags: [], debtorClass: 'patient' }, asOf)).toContain('prescription_risk');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2023-01-20', flags: [], debtorClass: 'patient' }, asOf)).toContain('prescribed');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: [], debtorClass: 'raf' }, asOf)).toContain('long_cycle_receivable');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: [], debtorClass: 'patient', contactsLast7d: 2 }, asOf)).toContain('frequency_cap');
    expect(collectionsExclusions({ balanceCents: 1000, ageingStartAt: '2026-08-01', flags: [], debtorClass: 'patient' }, asOf)).toEqual([]);
  });
  it('builds interest-free plans with rounding on the last instalment and flags policy breaches', () => {
    const p = buildPlan(780000, 4, '2026-10-01');
    expect(p.interestPct).toBe(0);
    expect(p.instalments.map((i) => i.amountCents)).toEqual([195000, 195000, 195000, 195000]);
    expect(p.instalments[3]!.dueDate).toBe('2027-01-01');
    const odd = buildPlan(100001, 3, '2026-01-31');
    expect(odd.instalments.reduce((a, i) => a + i.amountCents, 0)).toBe(100001);
    expect(odd.instalments[1]!.dueDate).toBe('2026-02-28');
    expect(buildPlan(900000, 9, '2026-10-01').withinPolicy).toBe(false);
  });
  it('write-off approver by limit and handover checklist as a gate', () => {
    expect(writeOffApprover(40000)).toBe('DEB');
    expect(writeOffApprover(400000)).toBe('PRM');
    expect(writeOffApprover(4000000)).toBe('EXE');
    const clean = handoverChecklist({ balanceCents: 300000, ageingStartAt: '2026-05-01', flags: [], debtorClass: 'patient', delivered: ['statement', 'final_notice'], daysSinceNotification: 138 }, '2026-09-16');
    expect(clean.clean).toBe(true);
    const dirty = handoverChecklist({ balanceCents: 30000, ageingStartAt: '2026-05-01', flags: ['vulnerable'], debtorClass: 'patient', delivered: ['statement'], daysSinceNotification: 138 }, '2026-09-16');
    expect(dirty.clean).toBe(false);
    expect(dirty.failing).toEqual(expect.arrayContaining(['finalNoticeDelivered', 'notVulnerable', 'aboveMinimum']));
  });
});
