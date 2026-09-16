import { describe, expect, it, beforeAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { createTestApp, type TestApp } from './harness.js';

describe('cluster B: acquisition, imaging, dose, BCI, reporting and results', () => {
  let t: TestApp;
  let rad: string, rgt: string, rgtA: string, nur: string, aio: string, ref: string, pat: string, cmp: string;

  beforeAll(async () => {
    t = await createTestApp();
    rad = await t.login('rad@demo.bonakala');
    rgt = await t.login('rgt@demo.bonakala');
    rgtA = await t.login('rgt2@demo.bonakala');
    nur = await t.login('nur@demo.bonakala');
    aio = await t.login('aio@demo.bonakala');
    ref = await t.login('ref@demo.bonakala');
    pat = await t.login('pat@demo.bonakala');
    cmp = await t.login('cmp@demo.bonakala');
  });

  it('modality simulator creates a study with images, runs Edge QC and produces BCI results with a priority', async () => {
    const patients = await t.services.db.select().from(schema.patients).where(eq(schema.patients.practiceId, 'prac_a')).limit(1);
    const patientId = patients[0]!.id;
    const send = await t.call(rad, 'POST', '/api/sim/modality/send', { siteId: 'site_san', procedureCode: '30110', patientId });
    expect(send.status).toBe(201);
    expect(send.json.accession).toMatch(/^BSAN-\d{2}-\d{7}-\d$/);
    expect(send.json.instanceCount).toBeGreaterThan(0);
    expect(send.json.qc?.model?.id).toBe('cxr-qc');
    expect(send.json.completed).toBe(true);
    await t.flush();

    const results = await t.call(aio, 'GET', `/api/bci/studies/${send.json.studyId}/results`, undefined, { 'x-practice-id': 'prac_a' });
    expect(results.status).toBe(200);
    const models = results.json.results.map((x: any) => x.modelId);
    expect(models).toContain('cxr-qc');
    expect(models).toContain('cxr-triage');
    expect(models).toContain('cxr-findings');
    const triage = results.json.results.find((x: any) => x.modelId === 'cxr-triage');
    expect(['P1', 'P2', 'P3', 'P4']).toContain(triage.priority);
    expect(triage.result.demo).toBe(true);
    expect(triage.result.schema).toBe('bci.result.v1');

    // The stored image is served by the WADO-like route
    const bundle = await t.call(rad, 'GET', `/api/imaging/studies/${send.json.studyId}`);
    expect(bundle.status).toBe(200);
    const instanceId = bundle.json.instances[0].id;
    const img = await t.app.request(`/api/imaging/studies/${send.json.studyId}/instances/${instanceId}`, { headers: { cookie: rad } });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toContain('image/svg');
    expect(await img.text()).toContain('DEMO');

    // Dose record was written from study.completed.v1 with a DRL comparison
    const dose = await t.call(rad, 'GET', `/api/dose/study/${send.json.studyId}`);
    expect(dose.status).toBe(200);
    expect(dose.json.dose.quantity).toBe('DAP');
    expect(dose.json.dose.drlValue).toBeGreaterThan(0);
  });

  it('reading worklist orders STAT first, then AI priority, then age, and supports claim and lock', async () => {
    const wl = await t.call(rgt, 'GET', '/api/reporting/worklist?scope=all&limit=50');
    expect(wl.status).toBe(200);
    expect(wl.json.items.length).toBeGreaterThan(0);
    // Effective rank = ordered priority, raised (never lowered) by the AI triage class.
    for (let i = 1; i < wl.json.items.length; i++) {
      const a = wl.json.items[i - 1], b = wl.json.items[i];
      expect(a.effectiveRank).toBeLessThanOrEqual(b.effectiveRank);
      if (a.effectiveRank === b.effectiveRank) {
        const ai = (x: any) => (x.aiPriority ? Number(String(x.aiPriority).slice(1)) : 5);
        expect(ai(a)).toBeLessThanOrEqual(ai(b));
      }
    }
    // A routine study never outranks a STAT study, and AI never lowers a study below its ordered band.
    for (const x of wl.json.items) expect(x.effectiveRank).toBeLessThanOrEqual(x.priority === 'stat' ? 0 : x.priority === 'urgent' ? 1 : 2);
    expect(wl.json.items[0]).toHaveProperty('slaPct');
    const target = wl.json.items[0];
    const claim = await t.call(rgt, 'POST', `/api/reporting/reports/${target.id}/claim`);
    expect(claim.status).toBe(200);
    const steal = await t.call(rgtA, 'POST', `/api/reporting/reports/${target.id}/claim`, undefined, { 'x-practice-id': target.practiceId });
    expect(steal.status).toBe(409);
  });

  it('a draft is never published: results endpoints exclude unsigned reports', async () => {
    const drafts = await t.services.db.select().from(schema.reports).where(eq(schema.reports.status, 'draft')).limit(5);
    expect(drafts.length).toBeGreaterThan(0);
    const draft = drafts[0]!;
    // Referrer results only ever contain signed reports
    const referrerView = await t.call(ref, 'GET', '/api/results/referrer?limit=200', undefined, { 'x-practice-id': draft.practiceId });
    expect(referrerView.status).toBe(200);
    expect(referrerView.json.reports.every((x: any) => x.status === 'signed' || x.status === 'amended')).toBe(true);
    expect(referrerView.json.reports.some((x: any) => x.id === draft.id)).toBe(false);
    // Patient results only ever contain signed reports
    const mine = await t.call(pat, 'GET', '/api/results/mine');
    expect(mine.status).toBe(200);
    expect(mine.json.reports.some((x: any) => x.id === draft.id)).toBe(false);
    // The renderer refuses to render an unsigned report
    const render = await t.call(rgt, 'GET', `/api/results/${draft.id}/render`);
    expect(render.status).toBe(409);
    expect(render.json.error).toBe('not_signed');
  });

  it('the Drafting Hand produces a Class 2 draft and holds no sign, distribute or notify tool', async () => {
    const { listHands } = await import('../src/kernel/hands.js');
    const drafting = listHands().find((h) => h.id === 'drafting')!;
    expect(Object.keys(drafting.tools).some((x) => /sign|publish|distribute|notify/.test(x))).toBe(false);
    expect(Object.values(drafting.tools)).not.toContain('R4');

    const study = (await t.services.db.select().from(schema.studies).where(eq(schema.studies.status, 'complete')).limit(1))[0]!;
    const open = await t.call(rgt, 'POST', `/api/reporting/studies/${study.id}/report`, {}, { 'x-practice-id': study.practiceId });
    expect(open.status).toBe(200);
    const reportId = open.json.report.id;
    const draft = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/draft`, { transcript: 'Lungs are clear. No pleural effusion.' }, { 'x-practice-id': study.practiceId });
    expect(draft.status).toBe(200);
    expect(draft.json.task.status).toBe('done');
    expect(draft.json.report.status).toBe('draft');
    expect(draft.json.report.draftProvenance.outputClass).toBe(2);
    expect(draft.json.report.draftProvenance.modelId).toBe('draft-report');
    expect(draft.json.report.sections.findings).toContain('Lungs are clear');
    // The draft is still not visible to the referrer
    const refView = await t.call(ref, 'GET', '/api/results/referrer?limit=200', undefined, { 'x-practice-id': study.practiceId });
    expect(refView.json.reports.some((x: any) => x.id === reportId)).toBe(false);
  });

  it('a consistency warning blocks signing until it is acknowledged, then sign emits report.signed.v1', async () => {
    const study = (await t.services.db.select().from(schema.studies).where(and(eq(schema.studies.status, 'complete'), eq(schema.studies.practiceId, 'prac_b'))).limit(1))[0]!;
    const open = await t.call(rgt, 'POST', `/api/reporting/studies/${study.id}/report`, {});
    const reportId = open.json.report.id;
    // Deliberately mismatched body part: the checker warns
    await t.call(rgt, 'PATCH', `/api/reporting/reports/${reportId}`, { sections: { findings: 'The examined structures are unremarkable.', impression: 'No acute abnormality.' } });
    // Decide any candidates so only the consistency gate remains
    const detail = await t.call(rgt, 'GET', `/api/reporting/reports/${reportId}`);
    for (const cand of detail.json.report.candidates.filter((x: any) => x.flag)) {
      await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/candidates/${encodeURIComponent(cand.id)}`, { decision: 'rejected', reason: 'Not supported on review' });
    }
    const blocked = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/sign`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe('consistency_warnings');
    expect(blocked.json.warnings.length).toBeGreaterThan(0);
    let after = await t.services.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).limit(1);
    expect(after[0]!.status).toBe('draft');

    const ack = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/acknowledge-warnings`, { reason: 'Reviewed on the images; wording is correct' });
    expect(ack.status).toBe(200);
    const signed = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/sign`, {});
    expect(signed.status).toBe(200);
    expect(signed.json.fee.cents).toBeGreaterThan(0);
    after = await t.services.db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).limit(1);
    expect(after[0]!.status).toBe('signed');
    expect(after[0]!.signedHpcsaNo).toBe('MP 0456789');
    await t.flush();
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'report.signed.v1'));
    expect(events.some((e) => (e.payload as any).reportId === reportId)).toBe(true);
    // Distribution ran: the referrer can now see it and the renderer works
    const render = await t.call(rgt, 'GET', `/api/results/${reportId}/render`);
    expect(render.status).toBe(200);
    const deliveries = await t.call(rgt, 'GET', `/api/results/deliveries/${reportId}`);
    expect(deliveries.json.deliveries.length).toBeGreaterThan(0);
  });

  it('only a radiologist with an HPCSA number can sign, and mandatory sections are enforced', async () => {
    const study = (await t.services.db.select().from(schema.studies).where(and(eq(schema.studies.status, 'complete'), eq(schema.studies.practiceId, 'prac_a'))).limit(1))[0]!;
    const open = await t.call(rgtA, 'POST', `/api/reporting/studies/${study.id}/report`, {});
    const reportId = open.json.report.id;
    // A radiographer may not sign
    expect((await t.call(rad, 'POST', `/api/reporting/reports/${reportId}/sign`, {})).status).toBe(403);
    // Empty mandatory sections block signing
    await t.call(rgtA, 'POST', `/api/reporting/reports/${reportId}/candidates/none`, { decision: 'rejected', reason: 'n/a' });
    await t.call(rgtA, 'PATCH', `/api/reporting/reports/${reportId}`, { sections: { findings: '', impression: '' } });
    const empty = await t.call(rgtA, 'POST', `/api/reporting/reports/${reportId}/sign`, {});
    expect(empty.status).toBe(409);
    expect(empty.json.error).toBe('mandatory_fields');
  });

  it('a critical flag needs MFA, emits report.critical_flag.confirmed.v1 and the Hand escalates within its leash', async () => {
    const study = (await t.services.db.select().from(schema.studies).where(and(eq(schema.studies.status, 'complete'), eq(schema.studies.practiceId, 'prac_b'))).limit(3))[2]!;
    const open = await t.call(rgt, 'POST', `/api/reporting/studies/${study.id}/report`, {});
    const reportId = open.json.report.id;
    await t.call(rgt, 'PATCH', `/api/reporting/reports/${reportId}`, { sections: { findings: `Findings in the ${study.bodyPart} are described. Comparison with the prior study.`, impression: 'Critical finding requiring immediate communication.' }, critical: true, criticalCategory: 'critical' });
    const detail = await t.call(rgt, 'GET', `/api/reporting/reports/${reportId}`);
    for (const cand of detail.json.report.candidates.filter((x: any) => x.flag)) {
      await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/candidates/${encodeURIComponent(cand.id)}`, { decision: 'accepted' });
    }
    await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/acknowledge-warnings`, { reason: 'Reviewed on the images' });
    const noMfa = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/sign`, {});
    expect(noMfa.status).toBe(401);
    expect(noMfa.json.error).toBe('mfa_required');
    const signed = await t.call(rgt, 'POST', `/api/reporting/reports/${reportId}/sign`, { mfaConfirmed: true });
    expect(signed.status).toBe(200);
    await t.flush();

    const evts = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'report.critical_flag.confirmed.v1'));
    expect(evts.some((e) => (e.payload as any).reportId === reportId)).toBe(true);
    const loops = await t.services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.reportId, reportId));
    expect(loops.length).toBe(1);
    const loop = loops[0]!;
    expect(loop.attempts.length).toBeGreaterThan(0);
    expect(loop.attempts[0]!.channel).toBe('call');
    // The Hand never closes the loop itself
    expect(loop.status).not.toBe('closed');
    const tasks = await t.services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.handId, 'critical-results'));
    expect(tasks.length).toBeGreaterThan(0);
    expect(Object.keys((await import('../src/kernel/hands.js')).getHand('critical-results')!.def.tools)).not.toContain('close_loop');
    // Escalation advances the level within the leash
    const before = loop.escalationLevel;
    const esc = await t.call(rgt, 'POST', `/api/results/critical/${loop.id}/escalate`, {});
    expect(esc.status).toBe(200);
    const after = (await t.services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.id, loop.id)).limit(1))[0]!;
    expect(after.escalationLevel).toBeGreaterThanOrEqual(before);
    expect(after.attempts.length).toBeGreaterThan(loop.attempts.length);
    // A clinician's acknowledgement closes it
    const ack = await t.call(rgt, 'POST', `/api/results/critical/${loop.id}/acknowledge`, { acknowledgedBy: 'Dr S. Naidoo', channel: 'voice' });
    expect(ack.status).toBe(200);
    const closed = (await t.services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.id, loop.id)).limit(1))[0]!;
    expect(closed.status).toBe('closed');
    expect(closed.acknowledgedBy).toBe('Dr S. Naidoo');
  });

  it('the Follow-up Hand creates tracked items from a signed report and closes only on evidence', async () => {
    const withFollowups = (await t.services.db.select().from(schema.reports).where(eq(schema.reports.status, 'signed')).limit(200)).find((x) => (x.followups ?? []).length > 0);
    expect(withFollowups).toBeDefined();
    const items = await t.services.db.select().from(schema.followups).where(eq(schema.followups.reportId, withFollowups!.id));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.dueAt).toBeTruthy();
    expect(items[0]!.scheduleSource).toBeTruthy();
    const list = await t.call(rgt, 'GET', '/api/results/followups', undefined, { 'x-practice-id': withFollowups!.practiceId });
    expect(list.status).toBe(200);
    expect(list.json.followups.length).toBeGreaterThan(0);
    const close = await t.call(rgt, 'POST', `/api/results/followups/${items[0]!.id}/close`, { reason: 'performed', evidence: 'CT chest performed at Sandton on 12 September, reported' }, { 'x-practice-id': withFollowups!.practiceId });
    expect(close.status).toBe(200);
    const closed = (await t.services.db.select().from(schema.followups).where(eq(schema.followups.id, items[0]!.id)).limit(1))[0]!;
    expect(closed.status).toBe('closed');
    expect(closed.closedEvidence).toContain('CT chest');
  });

  it('the kill switch stops inference for a model at a site', async () => {
    const patients = await t.services.db.select().from(schema.patients).where(eq(schema.patients.practiceId, 'prac_a')).limit(2);
    const off = await t.call(aio, 'PATCH', '/api/bci/models/cxr-findings@3.1.0/status', { siteId: 'site_san', status: 'paused', reason: 'test kill switch' }, { 'x-practice-id': 'prac_a' });
    expect(off.status).toBe(200);
    const send = await t.call(rad, 'POST', '/api/sim/modality/send', { siteId: 'site_san', procedureCode: '30110', patientId: patients[1]!.id });
    await t.flush();
    const results = await t.call(aio, 'GET', `/api/bci/studies/${send.json.studyId}/results`, undefined, { 'x-practice-id': 'prac_a' });
    const findings = results.json.results.find((x: any) => x.modelId === 'cxr-findings');
    expect(findings.task).toBe('not_analysed');
    expect((findings.result as any).reason).toContain('paused');
    // Triage still runs at that site
    expect(results.json.results.find((x: any) => x.modelId === 'cxr-triage').task).toBe('triage');
    const ev = await t.services.db.select().from(schema.modelEvents).where(and(eq(schema.modelEvents.modelId, 'cxr-findings'), eq(schema.modelEvents.type, 'kill_switch')));
    expect(ev.length).toBeGreaterThan(0);
    await t.call(aio, 'PATCH', '/api/bci/models/cxr-findings@3.1.0/status', { siteId: 'site_san', status: 'activated', reason: 'test restore' }, { 'x-practice-id': 'prac_a' });
  });

  it('the technologist console flow gates on identity, safety and overdue blocking QA', async () => {
    const wl = await t.call(rad, 'GET', '/api/acquisition/worklist?siteId=site_san');
    expect(wl.status).toBe(200);
    expect(wl.json.items.length).toBeGreaterThan(0);
    const scheduled = wl.json.items.find((x: any) => x.status === 'arrived') ?? wl.json.items.find((x: any) => x.status === 'scheduled');
    expect(scheduled).toBeDefined();
    if (scheduled.status === 'scheduled') await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/arrive`, {});
    // Starting without an identity check is refused
    const early = await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/start`, {});
    expect(early.status).toBe(409);
    const ident = await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/identity`, { identifiers: ['full_name', 'date_of_birth'], wristbandScanned: true });
    expect(ident.status).toBe(200);
    await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/safety`, { pregnancy: 'no', allergies: 'none', metformin: 'n/a' });
    const start = await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/start`, {});
    expect(start.status).toBe(200);
    // A repeat needs a reason code, and "other" needs free text
    const badRepeat = await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/repeat`, { reasonCode: 'other' });
    expect(badRepeat.status).toBe(400);
    const goodRepeat = await t.call(rad, 'POST', `/api/acquisition/worklist/${scheduled.id}/repeat`, { reasonCode: 'positioning' });
    expect(goodRepeat.status).toBe(201);

    // Overdue blocking QA blocks the room (M02-R-006)
    const qaStatus = await t.call(rad, 'GET', '/api/dose/rooms/room_rbg_xr1/qa-status');
    expect(qaStatus.status).toBe(200);
    expect(qaStatus.json.blocked).toBe(true);
    expect(qaStatus.json.reasons[0]).toContain('overdue');
  });

  it('the Protocol Hand suggests protocols and routes CT and MR to the radiologist (A1)', async () => {
    const ct = (await t.services.db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.modalityType, 'CT'), eq(schema.worklistItems.status, 'scheduled'))).limit(1))[0];
    if (!ct) return;
    const res = await t.call(rad, 'POST', `/api/acquisition/worklist/${ct.id}/protocol/suggest`, {}, { 'x-practice-id': ct.practiceId });
    expect(res.status).toBe(200);
    expect(res.json.task.status).toBe('done');
    expect(res.json.suggestion.reasons.length).toBeGreaterThan(0);
    expect(res.json.suggestion.confidence).toBeGreaterThan(0);
    // CT protocols need RGT acceptance unless a standing rule applies
    if (!res.json.suggestion.standingRule) expect(res.json.suggestion.requiresRgt).toBe(true);
  });

  it('contrast administration requires a batch scan or a documented manual reason, and a reaction opens an incident', async () => {
    const candidates = await t.services.db.select().from(schema.worklistItems).where(eq(schema.worklistItems.contrast, true)).limit(40);
    const flagged = new Set((await t.services.db.select({ id: schema.patients.id, flags: schema.patients.flags }).from(schema.patients)).filter((x) => (x.flags ?? []).includes('contrast_reaction')).map((x) => x.id));
    const item = candidates.find((x) => !flagged.has(x.patientId))!;
    expect(item).toBeDefined();
    const noBatch = await t.call(nur, 'POST', `/api/acquisition/contrast/${item.id}/administer`, { agent: 'Iohexol 350 (demo)', weightKg: 70, egfr: 80, volumePlannedMl: 105 }, { 'x-practice-id': item.practiceId });
    expect(noBatch.status).toBe(400);
    const ok = await t.call(nur, 'POST', `/api/acquisition/contrast/${item.id}/administer`, { agent: 'Iohexol 350 (demo)', weightKg: 70, egfr: 80, volumePlannedMl: 105, batchNo: 'LOT-202609-441' }, { 'x-practice-id': item.practiceId });
    expect(ok.status).toBe(201);
    const reaction = await t.call(nur, 'POST', `/api/acquisition/contrast/${ok.json.id}/reaction`, { severity: 'moderate', symptoms: 'Urticaria and mild bronchospasm', treatment: 'Antihistamine and salbutamol; observed 30 minutes' }, { 'x-practice-id': item.practiceId });
    expect(reaction.status).toBe(200);
    await t.flush();
    const evts = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'incident.opened.v1'));
    expect(evts.some((e) => (e.payload as any).category === 'contrast_reaction')).toBe(true);
    const [pat2] = await t.services.db.select({ flags: schema.patients.flags }).from(schema.patients).where(eq(schema.patients.id, item.patientId)).limit(1);
    expect(pat2!.flags).toContain('contrast_reaction');
  });

  it('share links are time-bound, audited and revocable', async () => {
    const study = (await t.services.db.select().from(schema.studies).limit(1))[0]!;
    const fdk = await t.login('fdk@demo.bonakala');
    const created = await t.call(fdk, 'POST', `/api/imaging/studies/${study.id}/share`, { recipientName: 'Dr T. Moodley', recipientMobile: '082 000 4473', consentBasis: 'referrer_under_referral', days: 14 });
    expect(created.status).toBe(201);
    const token = created.json.token;
    const otpRequired = await t.app.request(`/api/imaging/share/${token}`);
    expect(otpRequired.status).toBe(401);
    const opened = await t.app.request(`/api/imaging/share/${token}?otp=000000`);
    expect(opened.status).toBe(200);
    const body = (await opened.json()) as any;
    expect(body.watermark).toContain('not for diagnostic use');
    expect(body.instances.length).toBeGreaterThan(0);
    await t.call(fdk, 'POST', `/api/imaging/share/${created.json.id}/revoke`, {});
    expect((await t.app.request(`/api/imaging/share/${token}?otp=000000`)).status).toBe(410);
  });

  it('monitoring reports coverage, latency, agreement and per-site positive rates', async () => {
    const mon = await t.call(aio, 'GET', '/api/bci/monitoring?days=40', undefined, { 'x-practice-id': 'prac_a' });
    expect(mon.status).toBe(200);
    expect(mon.json.coveragePct).toBeGreaterThan(0);
    expect(mon.json.latencyP95).toBeGreaterThan(0);
    expect(mon.json.models.length).toBeGreaterThan(0);
    expect(mon.json.sites.length).toBeGreaterThan(0);
    expect(mon.json.agreement).not.toBeNull();
    expect(mon.json.daily.length).toBeGreaterThan(0);
    const models = await t.call(aio, 'GET', '/api/bci/models', undefined, { 'x-practice-id': 'prac_a' });
    expect(models.json.models.length).toBeGreaterThanOrEqual(8);
    const shadow = await t.call(aio, 'GET', '/api/bci/shadow', undefined, { 'x-practice-id': 'prac_a' });
    expect(shadow.json.evaluations.some((x: any) => x.modelId === 'msk-fracture')).toBe(true);
  });

  it('dose, QA and dosimetry registers are populated and DRL comparisons are computed', async () => {
    const dose = await t.call(cmp, 'GET', '/api/dose?limit=300', undefined, { 'x-practice-id': 'prac_b' });
    expect(dose.status).toBe(200);
    expect(dose.json.records.length).toBeGreaterThan(10);
    expect(dose.json.summary.length).toBeGreaterThan(0);
    expect(dose.json.summary[0].drl).toBeGreaterThan(0);
    const drl = await t.call(cmp, 'GET', '/api/dose/drl', undefined, { 'x-practice-id': 'prac_b' });
    expect(drl.json.drls.length).toBeGreaterThan(10);
    const qa = await t.call(cmp, 'GET', '/api/dose/qa', undefined, { 'x-practice-id': 'prac_a' });
    expect(qa.json.tests.length).toBeGreaterThan(0);
    expect(qa.json.blocking).toBeGreaterThan(0);
    const dosi = await t.call(cmp, 'GET', '/api/dose/dosimetry', undefined, { 'x-practice-id': 'prac_a' });
    expect(dosi.json.register.length).toBeGreaterThan(0);
  });

  it('patient results respect the release delay and withheld categories', async () => {
    const mine = await t.call(pat, 'GET', '/api/results/mine');
    expect(mine.status).toBe(200);
    expect(mine.json.releaseDelayHours).toBe(2);
    for (const rep of mine.json.reports) {
      if (rep.released) {
        expect(rep.plainLanguage.label).toContain('not the medical report');
        expect(rep.plainLanguage.provenance.outputClass).toBe(3);
      } else {
        expect(rep.message).toContain('sent to your doctor');
        expect(rep.sections).toBeUndefined();
      }
    }
  });

  it('peer review sampling is stratified and scores route significant discrepancies', async () => {
    const prm = await t.login('prm@demo.bonakala');
    const sample = await t.call(prm, 'POST', '/api/reporting/peer-reviews/sample', { ratePct: 3 });
    expect(sample.status).toBe(201);
    const list = await t.call(rgt, 'GET', '/api/reporting/peer-reviews');
    expect(list.status).toBe(200);
    const pending = list.json.reviews.find((x: any) => x.status === 'pending');
    if (pending) {
      const scored = await t.call(rgt, 'POST', `/api/reporting/peer-reviews/${pending.id}/score`, { score: '2b', category: 'perception', notes: 'Subtle finding not described', blindedImpression: 'Recorded before seeing the original' });
      expect(scored.status).toBe(200);
      expect(scored.json.routed).toBe(true);
    }
  });

  it('reading fees and analytics are computed from signed reports', async () => {
    const fees = await t.call(rgt, 'GET', '/api/reporting/fees');
    expect(fees.status).toBe(200);
    expect(fees.json.count).toBeGreaterThan(0);
    expect(fees.json.totalCents).toBeGreaterThan(0);
    const analytics = await t.call(rgt, 'GET', '/api/reporting/analytics?days=40');
    expect(analytics.json.signed).toBeGreaterThan(0);
    expect(analytics.json.tatMedianMinutes.routine).toBeGreaterThan(0);
    const refAnalytics = await t.call(ref, 'GET', '/api/results/analytics/referrers?days=60', undefined, { 'x-practice-id': 'prac_b' });
    expect(refAnalytics.status).toBe(200);
  });

  it('QC runs as an accountable Hand task, not a bare function call, and never blocks sending', async () => {
    const patients = await t.services.db.select().from(schema.patients).where(eq(schema.patients.practiceId, 'prac_a')).limit(1);
    const before = await t.services.db.select({ id: schema.agentTasks.id }).from(schema.agentTasks).where(eq(schema.agentTasks.handId, 'qc'));
    const send = await t.call(rad, 'POST', '/api/sim/modality/send', { siteId: 'site_san', procedureCode: '30110', patientId: patients[0]!.id });
    expect(send.status).toBe(201);
    const after = await t.services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.handId, 'qc'));
    expect(after.length).toBe(before.length + 1);
    const task = after[after.length - 1]!;
    expect(task.status).toBe('done');
    expect(task.steps.some((step) => step.tool === 'run_qc_model')).toBe(true);
    // The Hand's tool list has no delete/block capability; the study exists regardless of the QC outcome.
    const hands = await t.call(rad, 'GET', '/api/hands');
    const qc = hands.json.hands.find((h: any) => h.id === 'qc');
    expect(qc.name).toBe('QC Hand');
    expect(Object.keys(qc.tools ?? {})).not.toContain('delete_image');
    expect(Object.keys(qc.tools ?? {})).not.toContain('block_send');
  });

  it('unmatched studies are held out of inference until reconciliation, then analysed', async () => {
    const unmatched = (await t.services.db.select().from(schema.studies).where(eq(schema.studies.unmatched, true)).limit(1))[0]!;
    const before = await t.services.db.select().from(schema.inferenceResults).where(eq(schema.inferenceResults.studyId, unmatched.id));
    expect(before.every((x) => x.task === 'not_analysed')).toBe(true);
    const item = (await t.services.db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.practiceId, unmatched.practiceId), eq(schema.worklistItems.status, 'scheduled'))).limit(1))[0]!;
    const rec = await t.call(rad, 'POST', `/api/imaging/studies/${unmatched.id}/reconcile`, { worklistItemId: item.id, reason: 'Typed at the modality; matched by name and time' }, { 'x-practice-id': unmatched.practiceId });
    expect(rec.status).toBe(200);
    await t.flush();
    const after = await t.services.db.select().from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, unmatched.id), inArray(schema.inferenceResults.task, ['triage', 'findings'])));
    expect(after.length).toBeGreaterThan(0);
  });
});
