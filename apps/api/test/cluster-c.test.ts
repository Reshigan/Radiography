import { describe, expect, it, beforeAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { createTestApp, type TestApp } from './harness.js';
import { runHand } from '../src/kernel/hands.js';
import { switchState } from '../src/sim/switch.js';

const PRAC_A = 'prac_a';
const PRAC_B = 'prac_b';

describe('cluster C — revenue cycle and finance', () => {
  let t: TestApp;
  let bil: string, deb: string, exe: string, prm: string, fdk: string, shr: string, pay: string, rgt: string;

  beforeAll(async () => {
    t = await createTestApp();
    [bil, deb, exe, prm, fdk, shr, pay, rgt] = await Promise.all([
      t.login('bil@demo.bonakala'), t.login('deb@demo.bonakala'), t.login('exe@demo.bonakala'), t.login('prm@demo.bonakala'),
      t.login('fdk@demo.bonakala'), t.login('shr@demo.bonakala'), t.login('pay@demo.bonakala'), t.login('rgt@demo.bonakala'),
    ]) as [string, string, string, string, string, string, string, string];
  }, 120_000);

  const A = { 'x-practice-id': PRAC_A };
  const B = { 'x-practice-id': PRAC_B };

  /* ---------------- Console reads ---------------- */

  it('serves billing tiles, exceptions and rejections for a practice', async () => {
    const tiles = await t.call(bil, 'GET', '/api/billing/tiles', undefined, B);
    expect(tiles.status).toBe(200);
    expect(tiles.json.tiles.inFlight.count).toBeGreaterThan(0);
    expect(tiles.json.tiles.firstPass.pct).toBeGreaterThan(50);
    expect(tiles.json.waves.length).toBeGreaterThan(0);

    const ex = await t.call(bil, 'GET', '/api/billing/exceptions', undefined, B);
    expect(ex.status).toBe(200);
    expect(ex.json.exceptions.length).toBeGreaterThan(0);
    expect(Object.keys(ex.json.families).length).toBeGreaterThan(1);
    for (const e of ex.json.exceptions) expect(e.suggestion.length).toBeGreaterThan(5);

    const rej = await t.call(bil, 'GET', '/api/billing/rejections', undefined, B);
    expect(Object.keys(rej.json.byReason)).toContain('AUTH_REQ');
    expect(rej.json.deadlines.length).toBeGreaterThan(0);
  });

  it('scopes every list to the requested practice (tenant isolation)', async () => {
    // A practice user is pinned to their own practice even when a header asks for another.
    const pinned = await t.call(bil, 'GET', '/api/billing/claims?limit=500', undefined, A);
    expect(pinned.json.claims.every((x: { id: string }) => x.id)).toBe(true);
    // A Group persona switches tenant with x-practice-id; the two sets never overlap.
    const a = await t.call(exe, 'GET', '/api/billing/claims?limit=500', undefined, A);
    const b = await t.call(exe, 'GET', '/api/billing/claims?limit=500', undefined, B);
    expect(a.json.claims.length).toBeGreaterThan(0);
    expect(b.json.claims.length).toBeGreaterThan(0);
    const aIds = new Set(a.json.claims.map((x: { id: string }) => x.id));
    expect(b.json.claims.every((x: { id: string }) => !aIds.has(x.id))).toBe(true);
  });

  /* ---------------- Tariff and scrubber (via the API's reference data) ---------------- */

  it('exposes tariff codes and versioned rule packs', async () => {
    const tar = await t.call(bil, 'GET', '/api/billing/tariffs', undefined, B);
    expect(tar.json.tariffs.every((x: { demo: boolean }) => x.demo)).toBe(true);
    const packs = await t.call(bil, 'GET', '/api/billing/rule-packs', undefined, B);
    const schemeB = packs.json.rulePacks.filter((p: { funderId: string }) => p.funderId === 'scheme-b');
    expect(schemeB.length).toBe(2); // 2026.08 superseded by 2026.09
    expect(packs.json.taxonomy.AUTH_REQ.path).toBe('retro_auth');
  });

  /* ---------------- report.signed.v1 → charge → Coding Hand ---------------- */

  async function signReport(patientId: string, practiceId: string, procedureCodes: string[], icd10: string[], suffix: string) {
    const reportId = `rep_test_${suffix}`;
    await t.services.db.insert(schema.events).values({
      id: `evt_test_${suffix}`, name: 'report.signed.v1', practiceId,
      payload: { reportId, studyId: `stu_test_${suffix}`, accession: `BTST-26-000${suffix}-1`, patientId, practiceId, siteId: practiceId === PRAC_A ? 'site_san' : 'site_umh', referrerId: 'ref_naidoo', radiologistUserId: 'user_rgt', procedureCodes, icd10, critical: false, reportableCategories: [], signedAt: new Date().toISOString() },
      aggregateType: 'report', aggregateId: reportId,
    });
    await t.flush();
    const [charge] = await t.services.db.select().from(schema.charges).where(eq(schema.charges.reportId, reportId)).limit(1);
    return charge;
  }

  async function cleanPatient(practiceId: string, schemeId: string) {
    const pts = await t.services.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, practiceId), eq(schema.patients.schemeId, schemeId)));
    const today = new Date().toISOString().slice(0, 10);
    for (const p of pts) {
      if (/99$/.test(p.memberNo ?? '')) continue;
      const charges = await t.services.db.select().from(schema.charges).where(eq(schema.charges.patientId, p.id));
      if (charges.some((c) => c.serviceDate === today)) continue;
      return p;
    }
    return pts[0]!;
  }

  it('captures a charge on report.signed.v1 and the Coding Hand auto-accepts a clean scheme claim', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    const charge = await signReport(patient!.id, PRAC_A, ['30110'], ['J18.9'], '1');
    expect(charge).toBeDefined();
    expect(charge!.totalCents).toBeGreaterThan(0);
    expect(charge!.vatCents).toBe(Math.round(charge!.subtotalExclCents * 0.15));
    expect(charge!.coding?.modelId).toBe('coding-hand');
    expect(charge!.coding?.outputClass).toBe(2);
    expect(charge!.coding?.status).toBe('auto_accepted');
    expect(charge!.status).toBe('ready');
    expect(charge!.claimId).toBeTruthy();
    const [claim] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, charge!.claimId!)).limit(1);
    expect(claim!.status).toBe('scrubbed');
    expect(claim!.staleDate).toBeTruthy();
  });

  it('routes a charge to the exception queue when the scrubber blocks (Scheme B CT without authorisation)', async () => {
    const patient = await cleanPatient(PRAC_B, 'scheme-b');
    const charge = await signReport(patient!.id, PRAC_B, ['34320'], ['K80.2'], '2');
    expect(charge!.status).toBe('coded');
    expect(charge!.claimId).toBeNull();
    expect(charge!.coding?.status).toBe('proposed');
    expect(charge!.coding?.gate?.scrubOk).toBe(false);
    expect(charge!.exception?.code).toBe('AUTH_REQ');
    expect(charge!.exception?.family).toBe('Funder rule');

    // BIL accepts with the retro authorisation attached; the claim is then assembled.
    const accept = await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, { authRef: 'RA-B-9001', note: 'Retro auth granted' }, B);
    expect(accept.status).toBe(200);
    expect(accept.json.ok).toBe(true);
    expect(accept.json.claimRef).toMatch(/^B-\d{6}$/);
    const [after] = await t.services.db.select().from(schema.charges).where(eq(schema.charges.id, charge!.id)).limit(1);
    expect(after!.coding?.status).toBe('edited');
    expect(after!.coding?.acceptedBy).toBeTruthy();
    expect(after!.exception).toBeNull();
  });

  it('proposes a low-confidence coding when the report carries no ICD-10', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    const charge = await signReport(patient!.id, PRAC_A, ['30150'], [], '3');
    expect(charge!.status).toBe('coded');
    expect(charge!.coding!.confidence).toBeLessThan(0.95);
    expect(charge!.coding!.proposedIcd10).toEqual(['Z01.6']);
    expect(charge!.exception?.family).toBe('Coding confidence');
  });

  /* ---------------- Claims Hand: submit via the switch simulator ---------------- */

  it('submits a scrubbed claim through the switch simulator and records acceptance', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    const charge = await signReport(patient!.id, PRAC_A, ['33020'], ['K80.2'], '4');
    const res = await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [charge!.claimId] }, A);
    expect(res.status).toBe(200);
    expect(res.json.task.status).toBe('done');
    expect(res.json.task.output.submitted).toBe(1);
    const [claim] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, charge!.claimId!)).limit(1);
    expect(['accepted', 'submitted']).toContain(claim!.status);
    expect(claim!.switchRef).toBeTruthy();
    await t.flush();
    const events = await t.services.db.select().from(schema.events);
    expect(events.some((e) => e.name === 'claim.submitted.v1')).toBe(true);
    expect(events.some((e) => e.name === 'claim.responded.v1')).toBe(true);
  });

  it('the scrubber blocks a symptom ICD-10 as primary for CT before the claim ever reaches the switch', async () => {
    const patient = await cleanPatient(PRAC_B, 'scheme-b');
    const charge = await signReport(patient!.id, PRAC_B, ['34100'], ['R51'], '5');
    const accept = await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, { authRef: 'RA-B-9002' }, B);
    expect(accept.json.ok).toBe(false);
    expect(accept.json.scrub.findings.some((f: { code: string }) => f.code === 'ICD_INVALID')).toBe(true);
    // Recoding to the diagnosis the report supports clears the block and assembles the claim.
    const fixed = await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, { authRef: 'RA-B-9002', icd10: ['G43.9'], note: 'Report supports migraine' }, B);
    expect(fixed.json.ok).toBe(true);
    expect(fixed.json.claimId).toBeTruthy();
  });

  it('rejects via the switch when the funder cannot find the member, and a corrected resubmission is accepted', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    await t.services.db.update(schema.patients).set({ memberNo: '123456799' }).where(eq(schema.patients.id, patient!.id));
    const charge = await signReport(patient!.id, PRAC_A, ['30130'], ['M50.1'], '5b');
    const claimId = charge!.claimId ?? (await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, {}, A)).json.claimId;
    await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [claimId] }, A);
    const [claim] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
    expect(claim!.status).toBe('rejected');
    expect(claim!.rejectionCode).toBe('MEMBER_NOT_FOUND');
    expect(claim!.rejectionClass).toBe('member');
    expect(claim!.exception?.family).toBe('Identity');
    expect(claim!.exception?.path).toBe('verify_member');
    const resub = await t.call(bil, 'POST', `/api/billing/claims/${claimId}/resubmit`, { memberNo: '123456781', note: 'Confirmed with the patient' }, A);
    expect(resub.status).toBe(200);
    expect(resub.json.ok).toBe(true);
    const [after] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
    expect(after!.status).toBe('accepted');
    expect(after!.resubmitCount).toBe(1);
  });

  it('a rejection wave pauses the Claims Hand rule: matching claims are held, not submitted', async () => {
    // Open a fresh wave on Scheme C by switching on a rule and rejecting three claims.
    const res = await t.call(bil, 'POST', '/api/sim/switch/rule-change', { funderId: 'scheme-c', codes: ['35110'], reasonCode: 'AUTH_REQ', message: 'Scheme C now needs an authorisation on MRI lumbar spine' }, B);
    expect(res.status).toBe(200);
    const claimIds: string[] = [];
    const patients = await t.services.db.select().from(schema.patients).where(eq(schema.patients.practiceId, PRAC_B));
    for (let i = 0; i < 4; i++) {
      const p = patients[i + 5]!;
      await t.services.db.update(schema.patients).set({ schemeId: 'scheme-c', schemeName: 'Scheme C (demo)', memberNo: `4400000${i}` }).where(eq(schema.patients.id, p.id));
      const charge = await signReport(p.id, PRAC_B, ['35110'], ['M51.1'], `w${i}`);
      const claimId = charge!.claimId ?? (await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, { authRef: `RA-C-70${i}` }, B)).json.claimId;
      if (claimId) claimIds.push(claimId);
    }
    expect(claimIds.length).toBeGreaterThanOrEqual(3);
    // First three go out and are rejected (the switch requires an auth the scrubber did not).
    for (const id of claimIds.slice(0, 3)) {
      await t.services.db.update(schema.claims).set({ fields: { ...(await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1))[0]!.fields, authRef: null }, status: 'scrubbed' }).where(eq(schema.claims.id, id));
      await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [id] }, B);
    }
    // Scheme C is a batch funder: the adjudications arrive when the switch runs its batch.
    const batch = await t.call(bil, 'POST', '/api/sim/switch/run-batch', {}, B);
    expect(batch.json.applied).toBeGreaterThanOrEqual(3);
    const waves = await t.call(bil, 'GET', '/api/billing/waves', undefined, B);
    const wave = waves.json.waves.find((w: { funderId: string; reasonCode: string }) => w.funderId === 'scheme-c' && w.reasonCode === 'AUTH_REQ');
    expect(wave).toBeDefined();
    expect(wave.pausedRule).toContain('scheme-c');
    // The fourth claim is now held by the Hand rather than submitted.
    const last = claimIds[3]!;
    await t.services.db.update(schema.claims).set({ fields: { ...(await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, last)).limit(1))[0]!.fields, authRef: null }, status: 'scrubbed' }).where(eq(schema.claims.id, last));
    const submit = await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [last] }, B);
    expect(submit.json.task.output.held).toBe(1);
    const [heldClaim] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, last)).limit(1);
    expect(heldClaim!.status).toBe('held');
    expect(heldClaim!.exception?.reason).toContain('rejection wave');
    // clean up the simulator rule so later tests are unaffected
    await t.call(bil, 'POST', '/api/sim/switch/rule-change', { id: switchState.rules.find((x) => x.funderId === 'scheme-c')!.id, funderId: 'scheme-c', codes: ['35110'], reasonCode: 'AUTH_REQ', active: false }, B);
  });

  it('holds a claim above the per-claim leash until a human confirms', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    const charge = await signReport(patient!.id, PRAC_A, ['35100'], ['G43.9'], '6');
    const claimId = charge!.claimId ?? (await t.call(bil, 'POST', `/api/billing/charges/${charge!.id}/accept`, { authRef: 'RA-A-5001' }, A)).json.claimId;
    await t.services.db.update(schema.claims).set({ totalCents: 9_999_999, status: 'scrubbed' }).where(eq(schema.claims.id, claimId));
    const submit = await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [claimId] }, A);
    expect(submit.json.task.output.held).toBe(1);
    const [held] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
    expect(held!.status).toBe('held');
    expect(held!.exception?.code).toBe('ABOVE_LEASH');
  });

  /* ---------------- Remittance → patient liability ---------------- */

  it('matches a remittance, short-pays a claim and transfers the balance to the patient account', async () => {
    const patient = await cleanPatient(PRAC_A, 'scheme-a');
    const charge = await signReport(patient!.id, PRAC_A, ['30140'], ['M51.1'], '7');
    await t.call(bil, 'POST', '/api/billing/claims/submit', { claimIds: [charge!.claimId] }, A);
    const [claim] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, charge!.claimId!)).limit(1);
    expect(claim!.status).toBe('accepted');

    const remId = `rem_test_1`;
    const short = Math.round(claim!.expectedFunderCents * 0.7);
    await t.services.db.insert(schema.remittances).values({
      id: remId, practiceId: PRAC_A, funderId: 'scheme-a', reference: 'ERA-TEST-1', receivedAt: new Date().toISOString(), totalCents: short,
      lines: [{ claimRef: claim!.claimRef, claimId: claim!.id, expectedCents: claim!.expectedFunderCents, paidCents: short, reasonCode: '4303', status: 'unmatched' }], status: 'received',
    });
    const match = await t.call(deb, 'POST', `/api/billing/remittances/${remId}/match`, {}, A);
    expect(match.status).toBe(200);
    expect(match.json.task.status).toBe('done');
    expect(match.json.task.output.short).toBe(1);
    expect(match.json.task.output.liabilities).toBe(1);

    const [after] = await t.services.db.select().from(schema.claims).where(eq(schema.claims.id, claim!.id)).limit(1);
    expect(after!.status).toBe('short_paid');
    expect(after!.paidCents).toBe(short);

    const [account] = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.patientId, patient!.id), eq(schema.patientAccounts.debtorClass, 'patient'))).limit(1);
    expect(account!.balanceCents).toBeGreaterThan(0);
    expect(account!.ageingStartAt).toBeTruthy();
    const txns = await t.services.db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, account!.id));
    const transfer = txns.find((x) => x.type === 'transfer' && x.refId === claim!.id);
    expect(transfer).toBeDefined();
    expect((transfer!.arithmetic as { patientOwesCents: number }).patientOwesCents).toBeGreaterThan(0);
    expect(transfer!.description).toContain('scheme rate');
    await t.flush();
    const events = await t.services.db.select().from(schema.events);
    expect(events.some((e) => e.name === 'patient.liability.v1')).toBe(true);
    expect(events.some((e) => e.name === 'remittance.matched.v1')).toBe(true);
  });

  /* ---------------- Collect card, payments, plans ---------------- */

  it('serves the Collect card with scheme portion, patient portion, reason and previous balance', async () => {
    const [account] = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, PRAC_A), eq(schema.patientAccounts.debtorClass, 'patient'))).limit(1);
    const res = await t.call(fdk, 'GET', `/api/billing/patients/${account!.patientId}/account`, undefined, A);
    expect(res.status).toBe(200);
    expect(res.json.collect).toBeTruthy();
    expect(res.json.collect.reason.length).toBeGreaterThan(5);
    expect(res.json.collect.schemePortionCents + res.json.collect.patientPortionCents).toBe(res.json.collect.totalCents);
    expect(res.json.methods).toContain('payshap');
    expect(Array.isArray(res.json.ledger)).toBe(true);
  });

  it('takes a desk payment, issues a receipt and reduces the balance; a payment link settles through the PSP simulator', async () => {
    const accounts = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, PRAC_A), eq(schema.patientAccounts.status, 'open')));
    const account = accounts.find((a) => a.balanceCents > 20000 && a.debtorClass === 'patient')!;
    const before = account.balanceCents;
    const pay1 = await t.call(fdk, 'POST', '/api/billing/payments', { accountId: account.id, method: 'card', amountCents: 10000 }, A);
    expect(pay1.status).toBe(201);
    expect(pay1.json.receiptNo).toMatch(/^RCT-A-/);
    expect(pay1.json.balanceCents).toBe(before - 10000);

    const link = await t.call(fdk, 'POST', '/api/billing/payments/link', { accountId: account.id, amountCents: 5000 }, A);
    expect(link.status).toBe(201);
    expect(link.json.token).toHaveLength(24);
    const paid = await t.app.request(`/api/sim/psp/pay/${link.json.token}`, { method: 'POST', body: JSON.stringify({ method: 'payshap' }), headers: { 'content-type': 'application/json' } });
    expect(paid.status).toBe(200);
    const reuse = await t.app.request(`/api/sim/psp/pay/${link.json.token}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(reuse.status).toBe(409); // single use
    const [after] = await t.services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, account.id)).limit(1);
    expect(after!.balanceCents).toBe(before - 15000);
    await t.flush();
    const events = await t.services.db.select().from(schema.events);
    expect(events.filter((e) => e.name === 'payment.received.v1').length).toBeGreaterThan(0);
  });

  it('creates an interest-free plan and requires DEB approval above the plan leash', async () => {
    const accounts = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, PRAC_A), eq(schema.patientAccounts.debtorClass, 'patient')));
    const big = accounts.find((a) => a.balanceCents > 500000);
    if (big) {
      const res = await t.call(fdk, 'POST', '/api/billing/debtors/plans', { accountId: big.id, instalments: 6 }, A);
      expect(res.json.status).toBe('proposed');
      const approve = await t.call(deb, 'POST', `/api/billing/debtors/plans/${res.json.id}/approve`, {}, A);
      expect(approve.status).toBe(200);
    }
    const small = accounts.find((a) => a.balanceCents >= 90000 && a.balanceCents <= 500000 && !a.planId)!;
    const res = await t.call(deb, 'POST', '/api/billing/debtors/plans', { accountId: small.id, instalments: 3 }, A);
    expect(res.status).toBe(201);
    expect(res.json.status).toBe('active');
    expect(res.json.schedule.reduce((a: number, s: { amountCents: number }) => a + s.amountCents, 0)).toBe(small.balanceCents);
  });

  /* ---------------- Collections Hand ---------------- */

  it('the Collections Hand respects exclusions and contact windows and never writes off', async () => {
    const accounts = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, PRAC_A), eq(schema.patientAccounts.status, 'open')));
    const target = accounts.find((a) => a.balanceCents > 0 && !a.flags.length && !a.planId)!;
    await t.services.db.update(schema.patientAccounts).set({ flags: ['disputed'], ageingStartAt: new Date(Date.now() - 40 * 86400_000).toISOString(), contactsLast7d: 0 }).where(eq(schema.patientAccounts.id, target.id));
    const res = await t.call(deb, 'POST', '/api/billing/debtors/run', { dryRun: true }, A);
    expect(res.status).toBe(200);
    expect(res.json.task.status).toBe('done');
    const out = res.json.task.output;
    expect(out.exclusions.disputed).toBeGreaterThan(0);
    expect(out.allInsideWindow).toBe(true);
    // never contacted an excluded account
    const [run] = await t.services.db.select().from(schema.dunningRuns).where(eq(schema.dunningRuns.id, out.runId)).limit(1);
    const actions = await t.services.db.select().from(schema.dunningActions).where(eq(schema.dunningActions.runId, run!.id));
    expect(actions.some((a) => a.accountId === target.id)).toBe(false);
    for (const a of actions) {
      const hour = new Date(new Date(a.scheduledFor).getTime() + 2 * 3600_000).getUTCHours();
      const weekday = new Date(new Date(a.scheduledFor).getTime() + 2 * 3600_000).getUTCDay();
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(20);
      expect(weekday).not.toBe(0);
    }
    // the Hand's leash forbids write-offs entirely
    const { getHand } = await import('../src/kernel/hands.js');
    expect(Object.keys(getHand('collections')!.def.tools)).not.toContain('account.write_off');
    expect(getHand('collections')!.def.defaultLeash.maxWriteOffCents).toBe(0);
  });

  it('handover needs approval: DEB cannot approve, PRM can, and an unclean checklist is refused', async () => {
    const proposals = await t.call(deb, 'GET', '/api/billing/debtors/handover', undefined, A);
    expect(proposals.status).toBe(200);
    const clean = proposals.json.handovers.find((h: { clean: boolean; status: string }) => h.clean && h.status === 'proposed');
    const dirty = proposals.json.handovers.find((h: { clean: boolean; status: string }) => !h.clean && h.status === 'proposed');
    expect(clean).toBeDefined();
    const byDeb = await t.call(deb, 'POST', `/api/billing/debtors/handover/${clean.id}/approve`, { confirm: 'Confirm' }, A);
    expect(byDeb.status).toBe(403);
    expect(byDeb.json.needs).toBe('PRM');
    const byPrm = await t.call(prm, 'POST', `/api/billing/debtors/handover/${clean.id}/approve`, { confirm: 'Confirm' }, A);
    expect(byPrm.status).toBe(200);
    if (dirty) {
      const refused = await t.call(prm, 'POST', `/api/billing/debtors/handover/${dirty.id}/approve`, { confirm: 'Confirm' }, A);
      expect(refused.status).toBe(409);
    }
  });

  it('a dispute pauses dunning and resolving it can write off within the approver limit', async () => {
    const accounts = await t.services.db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, PRAC_A), eq(schema.patientAccounts.debtorClass, 'patient')));
    const acc = accounts.find((a) => a.balanceCents > 10000 && !a.flags.includes('disputed'))!;
    const open = await t.call(deb, 'POST', '/api/billing/debtors/disputes', { accountId: acc.id, reason: 'Quote said nothing to pay', message: 'My scheme said this was covered in full.' }, A);
    expect(open.status).toBe(201);
    const [flagged] = await t.services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, acc.id)).limit(1);
    expect(flagged!.flags).toContain('disputed');
    const resolve = await t.call(deb, 'POST', `/api/billing/debtors/disputes/${open.json.id}/resolve`, { outcome: 'upheld', note: 'We quoted R0 at booking and will honour that.', writeOffCents: 20000, reason: 'quote_honoured_practice_error' }, A);
    expect(resolve.status).toBe(200);
    const [after] = await t.services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, acc.id)).limit(1);
    expect(after!.flags).not.toContain('disputed');
    expect(after!.balanceCents).toBe(flagged!.balanceCents - 20000);
  });

  it('write-offs above the DEB limit need a higher approver', async () => {
    const accounts = await t.services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.practiceId, PRAC_A));
    const acc = accounts[0]!;
    const big = await t.call(deb, 'POST', '/api/billing/debtors/write-offs', { accountId: acc.id, amountCents: 300000, reason: 'uncollectable' }, A);
    expect(big.json.status).toBe('proposed');
    expect(big.json.approverPersona).toBe('PRM');
    const approved = await t.call(prm, 'POST', `/api/billing/debtors/write-offs/${big.json.id}/approve`, {}, A);
    expect(approved.status).toBe(200);
    const small = await t.call(deb, 'POST', '/api/billing/debtors/write-offs', { accountId: acc.id, amountCents: 4000, reason: 'small_balance' }, A);
    expect(small.json.status).toBe('approved');
  });

  it('serves debtors ageing by class with an ECL provision', async () => {
    const res = await t.call(deb, 'GET', '/api/billing/debtors/tiles', undefined, A);
    expect(res.status).toBe(200);
    expect(res.json.ageing.patient.total).toBeGreaterThan(0);
    expect(res.json.ageing.scheme.total).toBeGreaterThan(0);
    expect(res.json.provision.totalProvisionCents).toBeGreaterThan(0);
    expect(res.json.provision.totalProvisionCents).toBeLessThan(res.json.provision.totalExposureCents);
    expect(res.json.tiles.dsoDays).toBeGreaterThan(0);
  });

  /* ---------------- Month-end and finance ---------------- */

  it('produces the month-end unbilled register and signs the checklist', async () => {
    const res = await t.call(bil, 'GET', '/api/billing/month-end', undefined, B);
    expect(res.status).toBe(200);
    expect(res.json.register.count).toBeGreaterThan(0);
    expect(Object.keys(res.json.register.byReason).length).toBeGreaterThan(0);
    expect(res.json.inFlight.count).toBeGreaterThan(0);
    expect(res.json.checklist.length).toBeGreaterThan(3);
    const sign = await t.call(bil, 'POST', '/api/billing/month-end/sign', { period: res.json.period, confirm: 'Confirm' }, B);
    expect(sign.status).toBe(200);
    await t.flush();
    const events = await t.services.db.select().from(schema.events);
    expect(events.some((e) => e.name === 'billing.period.checklist.completed.v1')).toBe(true);
  });

  it('posts balanced GL journals from M14 events', async () => {
    const res = await t.call(exe, 'GET', '/api/finance/journals?limit=500', undefined, B);
    expect(res.status).toBe(200);
    expect(res.json.journals.length).toBeGreaterThan(10);
    expect(res.json.balanced).toBe(true);
    expect(res.json.suspense).toBe(0);
    for (const j of res.json.journals.slice(0, 20)) {
      const diff = j.lines.reduce((a: number, l: { debitCents: number; creditCents: number }) => a + l.debitCents - l.creditCents, 0);
      expect(diff).toBe(0);
    }
  });

  it('computes the P&L per practice per month against budget', async () => {
    const res = await t.call(exe, 'GET', '/api/finance/pnl?months=6', undefined, B);
    expect(res.status).toBe(200);
    expect(res.json.pnl.revenueCents).toBeGreaterThan(0);
    expect(res.json.pnl.ebitdaCents).toBeGreaterThan(0);
    expect(res.json.pnl.distributableCents).toBeGreaterThan(0);
    expect(res.json.history.length).toBeGreaterThan(3);
    const p = res.json.pnl;
    // the bridge reconciles
    expect(p.profitAfterTaxCents).toBe(p.ebitdaCents - p.depreciationCents - p.taxProvisionCents);
    expect(p.distributableCents).toBe(p.profitAfterTaxCents - p.reserveCents);
    const revenueLine = res.json.pnl.lines.find((l: { key: string }) => l.key === 'revenue');
    expect(revenueLine.budgetCents).toBeGreaterThan(0);
  });

  it('consolidates the group with eliminations and minority interest for the 51/49 JV', async () => {
    const res = await t.call(exe, 'GET', '/api/finance/consolidation');
    expect(res.status).toBe(200);
    const con = res.json.consolidation;
    expect(con.entities.length).toBe(2);
    const jv = con.entities.find((e: { entityId: string }) => e.entityId === PRAC_B)!;
    const wholly = con.entities.find((e: { entityId: string }) => e.entityId === PRAC_A)!;
    expect(jv.ownershipPct).toBe(51);
    expect(wholly.ownershipPct).toBe(100);
    expect(wholly.minorityInterestCents).toBe(0);
    expect(jv.minorityInterestCents).toBe(Math.round(jv.profitAfterTaxCents * 0.49));
    expect(con.attributableToGroupCents).toBe(con.profitAfterTaxCents - con.minorityInterestCents);
    expect(con.eliminationsCents).toBeGreaterThan(0);
  });

  it('runs the distribution waterfall for the JV and enforces approve-then-release with an independent releaser', async () => {
    const list = await t.call(exe, 'GET', '/api/finance/distributions', undefined, B);
    const proposed = list.json.distributions.find((d: { status: string }) => d.status === 'proposed')!;
    expect(proposed).toBeDefined();
    expect(proposed.solvencyTest.passed).toBe(true);
    const entitlements = proposed.waterfall.entitlements as Array<{ shareholderName: string; pct: number; grossCents: number; dividendsTaxCents: number; netCents: number }>;
    expect(entitlements.map((e) => e.pct).sort((a, b) => b - a)).toEqual([51, 24.5, 24.5]);
    const holdings = entitlements.find((e) => e.shareholderName.startsWith('Bonakala'))!;
    expect(holdings.grossCents).toBe(Math.round(proposed.distributableCents * 0.51));
    expect(holdings.netCents).toBe(holdings.grossCents - holdings.dividendsTaxCents);
    expect(holdings.dividendsTaxCents).toBe(Math.round(holdings.grossCents * 0.2));

    // Releasing before approvals are complete is refused.
    const early = await t.call(exe, 'POST', `/api/finance/distributions/${proposed.id}/release`, { confirm: 'Confirm' }, B);
    expect(early.status).toBe(409);
    const byShr = await t.call(shr, 'POST', `/api/finance/distributions/${proposed.id}/approve`, { confirm: 'Confirm' }, B);
    expect(byShr.status).toBe(200);
    expect(byShr.json.status).toBe('approved');
    const release = await t.call(exe, 'POST', `/api/finance/distributions/${proposed.id}/release`, { confirm: 'Confirm' }, B);
    expect(release.status).toBe(200);
    expect(release.json.hash).toHaveLength(64);
    expect(release.json.totalCents).toBeGreaterThan(0);
    await t.flush();
    const events = await t.services.db.select().from(schema.events);
    expect(events.some((e) => e.name === 'distribution.released.v1')).toBe(true);
  });

  it('a shareholder reads only their own practice', async () => {
    const mine = await t.call(shr, 'GET', '/api/finance/shareholder/me', undefined, B);
    expect(mine.status).toBe(200);
    expect(mine.json.holding.pct).toBe(24.5);
    expect(mine.json.capTable.find((x: { mine: boolean }) => x.mine)).toBeDefined();
    expect(mine.json.statements.every((s: { shareholderName: string }) => s.shareholderName === 'Dr A. Pillay')).toBe(true);
    // Asking for the other practice does not move the shareholder: the tenant is pinned to prac_b.
    const theirs = await t.call(shr, 'GET', '/api/finance/shareholder/me', undefined, A);
    expect(theirs.status).toBe(200);
    expect(theirs.json.entity.id).toBe(PRAC_B);
    const pnlOther = await t.call(shr, 'GET', '/api/finance/pnl', undefined, A);
    expect(pnlOther.json.pnl.practiceId).toBe(PRAC_B);
    const distOther = await t.call(shr, 'GET', '/api/finance/distributions', undefined, A);
    expect(distOther.json.distributions.every((d: { practiceId: string }) => d.practiceId === PRAC_B)).toBe(true);
    // A Group persona may switch, a shareholder may not, and a shareholder cannot read the group pack.
    expect((await t.call(exe, 'GET', '/api/finance/shareholder/me', undefined, A)).json.entity.id).toBe(PRAC_A);
    expect((await t.call(shr, 'GET', '/api/finance/board-pack')).status).toBe(403);
    expect((await t.call(shr, 'GET', '/api/finance/consolidation')).status).toBe(403);
  });

  it('records a reserved-matter vote under the agreement rule', async () => {
    const list = await t.call(shr, 'GET', '/api/finance/votes', undefined, B);
    expect(list.status).toBe(200);
    const matter = list.json.matters.find((m: { status: string }) => m.status === 'open')!;
    expect(matter.rule.majorityPct).toBe(75);
    expect(matter.tally.approve).toBe(51);
    const vote = await t.call(shr, 'POST', `/api/finance/votes/${matter.id}/vote`, { vote: 'approve', condition: 'Subject to the rural carve-out being kept' }, B);
    expect(vote.status).toBe(200);
    expect(vote.json.tally.approve).toBe(75.5);
    expect(vote.json.status).toBe('approved');
  });

  it('runs the Close Hand: intercompany, P&L, provisions and a distribution proposal, but never releases money', async () => {
    const { getHand } = await import('../src/kernel/hands.js');
    const def = getHand('close')!.def;
    expect(def.level).toBe('A2');
    expect(Object.keys(def.tools)).not.toContain('payment.release');
    expect(Object.values(def.tools)).not.toContain('R3');
    const task = await runHand(t.services, 'close', { practiceId: PRAC_A, period: '2026-07' }, { practiceId: PRAC_A, trigger: 'test', title: 'close test' });
    expect(task.status).toBe('done');
    const out = task.output as { steps: Array<{ id: string; status: string }>; distributionId: string };
    expect(out.steps.find((s) => s.id === 'approval')!.status).toBe('pending');
    expect(out.distributionId).toBeTruthy();
    expect(task.steps.some((s) => s.tool === 'distribution.propose')).toBe(true);
  });

  it('serves the group money views: intercompany, cash forecast and the board pack', async () => {
    const ic = await t.call(exe, 'GET', '/api/finance/intercompany', undefined, B);
    expect(ic.json.invoices.length).toBeGreaterThan(0);
    expect(ic.json.invoices[0].vatCents).toBe(Math.round(ic.json.invoices[0].amountExclCents * 0.15));
    const cash = await t.call(exe, 'GET', '/api/finance/cash-forecast', undefined, B);
    expect(cash.json.weeks.length).toBe(13);
    const board = await t.call(exe, 'GET', '/api/finance/board-pack');
    expect(board.json.practices.length).toBe(2);
    expect(board.json.group.revenueCents).toBeGreaterThan(0);
    const budgets = await t.call(exe, 'GET', '/api/finance/budgets', undefined, B);
    expect(budgets.json.vsActual.length).toBeGreaterThan(0);
  });

  /* ---------------- Funder portal and access control ---------------- */

  it('the funder portal shows only that funder and can request an audit pack', async () => {
    const res = await t.call(pay, 'GET', '/api/billing/funder/summary', undefined, A);
    expect(res.status).toBe(200);
    expect(res.json.funderId).toBe('scheme-a');
    expect(res.json.total).toBeGreaterThan(0);
    expect(res.json.topCodes.length).toBeGreaterThan(0);
    const claims = await t.call(pay, 'GET', '/api/billing/claims?limit=50', undefined, A);
    expect(claims.json.claims.every((x: { funderId: string }) => x.funderId === 'scheme-a')).toBe(true);
    expect(claims.json.claims.every((x: { patient: string }) => x.patient.startsWith('Member'))).toBe(true);
    const req = await t.call(pay, 'POST', '/api/billing/funder/audit-request', { claimIds: [claims.json.claims[0].id], reason: 'Routine sample audit of CT claims' }, A);
    expect(req.status).toBe(201);
  });

  it('refuses billing routes to personas outside the mandate', async () => {
    expect((await t.call(rgt, 'GET', '/api/billing/tiles', undefined, B)).status).toBe(403);
    expect((await t.call(fdk, 'POST', '/api/billing/debtors/write-offs', { accountId: 'x', amountCents: 100, reason: 'test' }, A)).status).toBe(403);
    expect((await t.call(bil, 'POST', '/api/finance/periods/2026-07/lock', { confirm: 'Confirm' }, B)).status).toBe(403);
  });

  it('bank feed matches an ERA credit and marks the remittance banked', async () => {
    const rem = await t.services.db.select().from(schema.remittances).where(and(eq(schema.remittances.practiceId, PRAC_A), eq(schema.remittances.status, 'matched'))).limit(1);
    expect(rem.length).toBeGreaterThan(0);
    const res = await t.call(deb, 'POST', '/api/sim/bank/credit', { reference: rem[0]!.reference, amountCents: rem[0]!.totalCents }, A);
    expect(res.status).toBe(200);
    expect(res.json.credit.matchedTo?.type).toBe('remittance');
    const [after] = await t.services.db.select().from(schema.remittances).where(eq(schema.remittances.id, rem[0]!.id)).limit(1);
    expect(after!.status).toBe('banked');
  });
});
