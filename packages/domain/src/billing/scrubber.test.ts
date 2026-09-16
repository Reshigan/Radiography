import { describe, expect, it } from 'vitest';
import { classifyFunderCode, routeShortPayment, rulePackInForce, scrubClaim, REJECTION_TAXONOMY, type ClaimForScrub } from './rules.js';

const base: ClaimForScrub = {
  funderId: 'scheme-b', serviceDate: '2026-09-10', today: '2026-09-16',
  fields: { practiceNo: '0123457', treatingProviderNo: 'MP0456789', referrerNo: '0223344', memberNo: '123456789', dependantCode: '00', siteCode: 'UMH', patientDob: '1982-03-14' },
  lines: [{ code: '34320', quantity: 1 }, { code: '0012', quantity: 1 }, { code: '700123', quantity: 1 }], icd10: ['K80.2'], patient: { sex: 'F', dateOfBirth: '1982-03-14' },
};

describe('rule packs and scrubber', () => {
  it('selects the pack in force on the service date (Scheme B rule change on 1 Sep)', () => {
    expect(rulePackInForce('scheme-b', '2026-08-20').version).toBe('2026.08.1');
    expect(rulePackInForce('scheme-b', '2026-09-02').version).toBe('2026.09.2');
    expect(rulePackInForce('unknown', '2026-09-02').funderId).toBe('cash');
  });

  it('passes a clean claim with the fields, ICD-10 and auth the pack needs', () => {
    const r = scrubClaim({ ...base, fields: { ...base.fields, authRef: 'RA-B-3311' } }, rulePackInForce('scheme-b', base.serviceDate));
    expect(r.pass).toBe(true);
    expect(r.errors).toBe(0);
    expect(r.staleDate).toBe('2027-01-08'); // 120 days
    expect(r.rulePackVersion).toBe('2026.09.2');
  });

  it('blocks out-of-hospital CT without an authorisation under the September pack but not under August', () => {
    const sep = scrubClaim(base, rulePackInForce('scheme-b', '2026-09-10'));
    expect(sep.pass).toBe(false);
    expect(sep.findings.map((f) => f.code)).toContain('AUTH_REQ');
    const aug = scrubClaim({ ...base, serviceDate: '2026-08-20' }, rulePackInForce('scheme-b', '2026-08-20'));
    expect(aug.findings.map((f) => f.code)).not.toContain('AUTH_REQ');
  });

  it('flags symptom codes as primary for CT, missing ICD-10 and missing referrer', () => {
    const r = scrubClaim({ ...base, fields: { ...base.fields, authRef: 'RA-1', referrerNo: '' }, icd10: ['R51'] }, rulePackInForce('scheme-b', base.serviceDate));
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('ICD_INVALID');
    expect(codes).toContain('REFERRER_MISSING');
    const noIcd = scrubClaim({ ...base, fields: { ...base.fields, authRef: 'RA-1' }, icd10: [] }, rulePackInForce('scheme-b', base.serviceDate));
    expect(noIcd.findings.map((f) => f.code)).toContain('ICD_MISSING');
  });

  it('applies deterministic fixes (dependant code padding) and records them', () => {
    const r = scrubClaim({ ...base, fields: { ...base.fields, authRef: 'RA-1', dependantCode: '1' } }, rulePackInForce('scheme-b', base.serviceDate));
    expect(r.pass).toBe(true);
    expect(r.fixes).toBe(1);
    expect(r.fields.dependantCode).toBe('01');
  });

  it('detects duplicates, near-duplicates, frequency limits and stale claims', () => {
    const packA = rulePackInForce('scheme-a', '2026-09-10');
    const mammo: ClaimForScrub = { ...base, funderId: 'scheme-a', lines: [{ code: '39120', quantity: 1 }], icd10: ['Z12.3'], patient: { sex: 'F', dateOfBirth: '1975-01-01' } };
    const dup = scrubClaim({ ...mammo, priorClaims: [{ serviceDate: '2026-09-10', codes: ['39120'], status: 'submitted' }] }, packA);
    expect(dup.findings.map((f) => f.code)).toContain('DUPLICATE');
    const near = scrubClaim({ ...mammo, priorClaims: [{ serviceDate: '2026-09-10', codes: ['33020'], status: 'submitted' }] }, packA);
    expect(near.findings.map((f) => f.code)).toContain('NEAR_DUPLICATE');
    expect(near.pass).toBe(true);
    const freq = scrubClaim({ ...mammo, priorClaims: [{ serviceDate: '2026-03-01', codes: ['39120'], status: 'paid' }] }, packA);
    expect(freq.findings.map((f) => f.code)).toContain('NOT_COVERED');
    const stale = scrubClaim({ ...mammo, serviceDate: '2026-04-01', today: '2026-09-16' }, packA);
    expect(stale.findings.map((f) => f.code)).toContain('STALE');
  });

  it('applies age and sex edits and warns on contrast without NAPPI', () => {
    const packA = rulePackInForce('scheme-a', '2026-09-10');
    const obs = scrubClaim({ ...base, funderId: 'scheme-a', lines: [{ code: '33040', quantity: 1 }], patient: { sex: 'M', dateOfBirth: '1990-01-01' } }, packA);
    expect(obs.findings.map((f) => f.code)).toContain('AGE_SEX_EDIT');
    const ct = scrubClaim({ ...base, funderId: 'scheme-a', lines: [{ code: '34320', quantity: 1 }] }, packA);
    expect(ct.findings.find((f) => f.code === 'CONTRAST_NO_NAPPI')?.severity).toBe('warn');
    expect(ct.pass).toBe(true);
  });

  it('RAF and COIDA packs require their claim numbers; cash needs almost nothing', () => {
    const raf = scrubClaim({ ...base, funderId: 'raf', fields: { serviceDate: '2026-09-10', siteCode: 'SAN' }, icd10: [] }, rulePackInForce('raf', base.serviceDate));
    expect(raf.findings.map((f) => f.code).sort()).toEqual(['ATTORNEY_MISSING', 'CLAIM_NUMBER_MISSING']);
    const cash = scrubClaim({ ...base, funderId: 'cash', fields: { serviceDate: '2026-09-10', siteCode: 'SAN' }, icd10: [] }, rulePackInForce('cash', base.serviceDate));
    expect(cash.pass).toBe(true);
    expect(cash.staleDate).toBeNull();
  });

  it('maps every funder response code to the taxonomy with an auto-fix path', () => {
    expect(classifyFunderCode('4231')).toMatchObject({ reason: 'AUTH_REQ', mapping: { class: 'authorisation', path: 'retro_auth', level: 'A3' } });
    expect(classifyFunderCode('4232').mapping.exceptionFamily).toBe('Funder rule');
    expect(classifyFunderCode('0000').reason).toBe('TECHNICAL');
    expect(classifyFunderCode('BENEFIT_EXHAUSTED').mapping.path).toBe('patient_liability');
    for (const m of Object.values(REJECTION_TAXONOMY)) expect(m.suggestion.length).toBeGreaterThan(10);
  });

  it('routes short-payments by class and balance-billing policy', () => {
    expect(routeShortPayment('co_payment')).toBe('patient_liability');
    expect(routeShortPayment('co_payment', false)).toBe('contractual_adjustment');
    expect(routeShortPayment('pmb_dispute')).toBe('appeal');
    expect(routeShortPayment('unknown')).toBe('deb_review');
  });
});
