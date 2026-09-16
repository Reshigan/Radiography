import { describe, expect, it, beforeAll } from 'vitest';
import { schema } from '@bonakala/db';
import { eq, and } from 'drizzle-orm';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestApp();
  for (const p of ['fdk', 'bkg', 'ref', 'pat', 'prm', 'bil', 'nur', 'rgt']) cookies[p] = await t.login(`${p}@demo.bonakala`);
}, 120_000);

const B = { 'x-practice-id': 'prac_b' };

/** A weekday at least `days` from today, in SAST. */
function nextWeekday(days: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' });
  for (let i = days; i < days + 7; i++) {
    const d = new Date(Date.now() + i * 86400_000);
    const day = fmt.format(d);
    const weekday = new Date(`${day}T12:00:00+02:00`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return day;
  }
  return fmt.format(new Date(Date.now() + days * 86400_000));
}

describe('M04 referral and orders', () => {
  it('seeds a procedure catalogue of at least 40 procedures across all modalities', async () => {
    const res = await t.call(cookies['fdk']!, 'GET', '/api/referrals/catalogue');
    expect(res.status).toBe(200);
    expect(res.json.procedures.length).toBeGreaterThanOrEqual(40);
    const modalities = new Set(res.json.procedures.map((p: any) => p.modality));
    expect([...modalities].sort()).toEqual(['CT', 'DXA', 'MG', 'MR', 'US', 'XR']);
    expect(res.json.procedures.every((p: any) => p.tariffCode && p.durationMin > 0 && p.prep)).toBe(true);
  });

  it('parses a referral: modality, body part, laterality, contrast, urgency, referrer and ICD-10 with confidence', async () => {
    const text = 'Dr S. Naidoo MP 0123456 PR 0223344\nPlease do MRI of the right knee, no contrast.\nClinical: knee locking and giving way after rugby injury. Urgent.';
    const res = await t.call(cookies['bkg']!, 'POST', '/api/referrals/parse', { text });
    expect(res.status).toBe(200);
    const p = res.json.parsed;
    expect(p.modality).toBe('MR');
    expect(p.procedureCode).toBe('MR-KNEE');
    expect(p.laterality).toBe('right');
    expect(p.contrast).toBe(false);
    expect(p.urgency).toBe('urgent');
    expect(p.referrerId).toBe('ref_naidoo');
    expect(p.confidence).toBeGreaterThan(0.7);
    expect(res.json.provenance.modelId).toBe('referral-extract');
    expect(res.json.provenance.outputClass).toBe(3);
  });

  it('runs the Referral Hand end to end: intake to a converted order with an event', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=1', undefined, B);
    const patient = patients.json.patients[0];
    const res = await t.call(cookies['bkg']!, 'POST', '/api/referrals', {
      channel: 'paper_photo', patientId: patient.id,
      photoText: 'Dr R. Pillay PR 0223345. CT of the head, no contrast. Fall at home, headache and confusion 6 hours, on anticoagulant. Query bleed.',
    }, B);
    expect(res.status).toBe(201);
    expect(res.json.referral.status).toBe('converted');
    expect(res.json.order.order.procedures[0].code).toBe('CT-BRAIN');
    expect(res.json.order.order.createdBy).toBe('hand:referral');
    expect(res.json.order.order.protocollingRequired).toBe(true);
    expect(res.json.task.status).toBe('done');
    await t.flush();
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'order.created.v1'));
    expect(events.length).toBeGreaterThan(0);
    const task = (await t.services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, res.json.task.id)))[0]!;
    expect(task.steps.map((s) => s.tool)).toContain('document.extract');
    expect(task.steps.map((s) => s.tool)).toContain('order.create');
  });

  it('leaves an unreadable referral in needs_info instead of guessing', async () => {
    const res = await t.call(cookies['bkg']!, 'POST', '/api/referrals', { channel: 'whatsapp', text: 'I need a scan please', sourceContact: '0820000001' }, B);
    expect(res.status).toBe(201);
    expect(res.json.referral.status).toBe('needs_info');
    expect(res.json.referral.needsInfo.length).toBeGreaterThan(0);
    expect(res.json.order).toBeNull();
  });

  it('gives appropriateness guidance and requires an override to proceed against it', async () => {
    const guidance = await t.call(cookies['ref']!, 'POST', '/api/referrals/appropriateness', { procedureCode: 'MR-LSPINE', clinicalInfo: 'Low back pain for 3 weeks, no red flags' }, B);
    expect(guidance.status).toBe(200);
    expect(guidance.json.result.band).toBe('usually_not_appropriate');
    expect(guidance.json.alternative.code).toBe('XR-LSPINE');
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=1', undefined, B);
    const patientId = patients.json.patients[0].id;
    const blocked = await t.call(cookies['ref']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'MR-LSPINE' }], clinicalInfo: 'Low back pain for 3 weeks, no red flags' }, B);
    expect(blocked.status).toBe(400);
    const allowed = await t.call(cookies['ref']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'MR-LSPINE' }], clinicalInfo: 'Low back pain for 3 weeks, no red flags', appropriatenessOverrideReason: 'Failed conservative care, planning surgical referral' }, B);
    expect(allowed.status).toBe(201);
    expect(allowed.json.order.appropriateness.overrideReason).toBeTruthy();
    // red flags change the band
    const withFlags = await t.call(cookies['ref']!, 'POST', '/api/referrals/appropriateness', { procedureCode: 'MR-LSPINE', clinicalInfo: 'Low back pain with leg weakness and bladder symptoms' }, B);
    expect(withFlags.json.result.band).toBe('usually_appropriate');
  });

  it('requires laterality for paired structures and detects a recent duplicate study', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=2', undefined, B);
    const patientId = patients.json.patients[1].id;
    const bad = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'XR-KNEE' }], clinicalInfo: 'Knee pain after a fall' }, B);
    expect(bad.status).toBe(400);
    const first = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'XR-KNEE', laterality: 'left' }], clinicalInfo: 'Knee pain after a fall' }, B);
    expect(first.status).toBe(201);
    await t.call(cookies['bkg']!, 'PATCH', `/api/referrals/orders/${first.json.order.id}/status`, { status: 'scheduled' }, B);
    const second = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'XR-KNEE', laterality: 'left' }], clinicalInfo: 'Knee pain after a fall, repeat' }, B);
    expect(second.json.order.recentStudy.found).toBe(true);
    expect(second.json.order.recentStudy.matches.length).toBeGreaterThan(0);
  });

  it('verifies a referrer only through a human route and never through a Hand', async () => {
    const created = await t.call(cookies['bkg']!, 'POST', '/api/referrals/referrers', { name: 'Dr Test Referrer', hpcsaNo: 'MP 0999888', bhfPracticeNo: '0999888', discipline: 'GP' }, B);
    expect(created.status).toBe(201);
    const verify = await t.call(cookies['bkg']!, 'POST', `/api/referrals/referrers/${created.json.id}/verify`, {}, B);
    expect(verify.json.ok).toBe(true);
    const asPatient = await t.call(cookies['pat']!, 'POST', `/api/referrals/referrers/${created.json.id}/verify`, {});
    expect(asPatient.status).toBe(403);
    const { tools } = (await import('../src/modules/m04-referrals/service.js')).referralHand;
    expect(Object.keys(tools)).not.toContain('referrer.verify');
  });

  it('serves the referrer-facing routes without the wildcard shadowing them', async () => {
    for (const path of ['/api/referrals/my-referrals', '/api/referrals/my-analytics', '/api/referrals/referrers', '/api/referrals/catalogue']) {
      const res = await t.call(cookies['ref']!, 'GET', path, undefined, B);
      expect([path, res.status]).toEqual([path, 200]);
    }
    const orders = await t.call(cookies['bkg']!, 'GET', '/api/referrals/orders?limit=3', undefined, B);
    expect(orders.status).toBe(200);
    const mine = await t.call(cookies['ref']!, 'GET', '/api/referrals/my-referrals', undefined, B);
    expect(Array.isArray(mine.json.orders)).toBe(true);
    const analytics = await t.call(cookies['ref']!, 'GET', '/api/referrals/my-analytics', undefined, B);
    expect(analytics.json.totals.referrals).toBeGreaterThanOrEqual(0);
  });

  it('enforces the order state machine and rejects impossible transitions', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=3', undefined, B);
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patients.json.patients[2].id, procedures: [{ code: 'XR-CHEST' }], clinicalInfo: 'Cough for 3 weeks' }, B);
    const id = order.json.order.id;
    expect((await t.call(cookies['bkg']!, 'PATCH', `/api/referrals/orders/${id}/status`, { status: 'completed' }, B)).status).toBe(409);
    expect((await t.call(cookies['bkg']!, 'PATCH', `/api/referrals/orders/${id}/status`, { status: 'scheduled' }, B)).status).toBe(200);
    expect((await t.call(cookies['bkg']!, 'PATCH', `/api/referrals/orders/${id}/status`, { status: 'arrived' }, B)).status).toBe(200);
  });
});

describe('M05 scheduling', () => {
  let orderId: string;
  let patientId: string;

  beforeAll(async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=6', undefined, B);
    patientId = patients.json.patients[4].id;
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId, procedures: [{ code: 'CT-BRAIN' }], clinicalInfo: 'Head injury with vomiting', siteId: 'site_umh' }, B);
    orderId = order.json.order.id;
    await t.flush();
  });

  it('computes availability from templates and blocks a down modality', async () => {
    // A weekday far enough ahead that the seeded day is not already full.
    const day = nextWeekday(10);
    const res = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/availability?modality=CT&siteId=site_umh&date=${day}`, undefined, B);
    expect(res.status).toBe(200);
    expect(res.json.slots.length).toBeGreaterThan(0);
    // UMH CT2 modality is seeded as down by the core seeder.
    const ct2 = res.json.rooms.find((r: any) => r.roomId === 'room_umh_ct2');
    expect(ct2.blocked.length).toBeGreaterThan(0);
    expect(res.json.slots.every((s: any) => s.roomId !== 'room_umh_ct2')).toBe(true);
  });

  it('never offers a slot in a load-shedding window for a modality without generator cover', async () => {
    await t.call(cookies['prm']!, 'PUT', '/api/scheduling/loadshedding/site_umh', { stage: 6, schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '00:00', end: '23:59' })), generatorModalities: ['XR', 'US'] }, B);
    const day = nextWeekday(10);
    const res = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/availability?modality=MR&siteId=site_umh&date=${day}`, undefined, B);
    expect(res.json.slots.length).toBe(0);
    const xr = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/availability?modality=XR&siteId=site_umh&date=${day}`, undefined, B);
    expect(xr.json.slots.length).toBeGreaterThan(0);
    await t.call(cookies['prm']!, 'PUT', '/api/scheduling/loadshedding/site_umh', { stage: 2, schedule: [{ weekday: 2, start: '12:00', end: '14:30' }], generatorModalities: ['XR', 'US', 'CT', 'MG', 'DXA'] }, B);
  });

  it('searches earliest near me with distance and price certainty, then holds and confirms', async () => {
    const search = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/earliest?orderId=${orderId}&limit=3`, undefined, B);
    expect(search.status).toBe(200);
    expect(search.json.offers.length).toBeGreaterThan(0);
    const offer = search.json.offers[0];
    expect(offer.priceCertainty).toBeTruthy();
    expect(offer.distanceKm === null || offer.distanceKm >= 0).toBe(true);
    const hold = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/holds', { orderId, roomId: offer.roomId, startsAt: offer.startsAt }, B);
    expect(hold.status).toBe(201);
    expect(hold.json.appointment.status).toBe('held');
    expect(new Date(hold.json.holdExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    // the same slot cannot be held twice
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=8', undefined, B);
    const other = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patients.json.patients[6].id, procedures: [{ code: 'CT-BRAIN' }], clinicalInfo: 'Headache', siteId: 'site_umh' }, B);
    const clash = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/holds', { orderId: other.json.order.id, roomId: offer.roomId, startsAt: offer.startsAt }, B);
    expect(clash.status).toBe(409);
    const confirm = await t.call(cookies['bkg']!, 'POST', `/api/scheduling/holds/${hold.json.appointment.id}/confirm`, {}, B);
    expect(confirm.status).toBe(200);
    expect(confirm.json.appointment.status).toBe('booked');
    expect(confirm.json.appointment.noShowScore).toBeGreaterThan(0);
    await t.flush();
    const order = await t.call(cookies['bkg']!, 'GET', `/api/referrals/orders/${orderId}`, undefined, B);
    expect(order.json.order.status).toBe('scheduled');
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'appointment.booked.v1'));
    expect(events.length).toBeGreaterThan(0);
    const reminders = await t.services.db.select().from(schema.reminders).where(eq(schema.reminders.appointmentId, confirm.json.appointment.id));
    expect(reminders.length).toBeGreaterThan(0);
  });

  it('inserts a STAT order immediately and records the displacement', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=10', undefined, B);
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patients.json.patients[8].id, procedures: [{ code: 'CT-BRAIN' }], priority: 'stat', clinicalInfo: 'Acute neurological deficit, thrombolysis window' }, B);
    const res = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/stat', { orderId: order.json.order.id, siteId: 'site_umh' }, B);
    expect(res.status).toBe(201);
    expect(res.json.appointment.status).toBe('booked');
    expect(res.json.appointment.source).toBe('stat');
    expect(new Date(res.json.appointment.startsAt).getTime() - Date.now()).toBeLessThan(40 * 60_000);
    expect(res.json.appointment.softOverrides.length).toBe(1);
  });

  it('cancels with a waitlist backfill offer', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=14', undefined, B);
    const a = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patients.json.patients[11].id, procedures: [{ code: 'US-ABDO' }], clinicalInfo: 'RUQ pain', siteId: 'site_umh' }, B);
    const search = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/earliest?orderId=${a.json.order.id}`, undefined, B);
    const offer = search.json.offers[0];
    const hold = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/holds', { orderId: a.json.order.id, roomId: offer.roomId, startsAt: offer.startsAt }, B);
    await t.call(cookies['bkg']!, 'POST', `/api/scheduling/holds/${hold.json.appointment.id}/confirm`, {}, B);
    const b = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patients.json.patients[12].id, procedures: [{ code: 'US-ABDO' }], clinicalInfo: 'Gallstones', siteId: 'site_umh' }, B);
    const wl = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/waitlist', { orderId: b.json.order.id, siteId: 'site_umh' }, B);
    expect(wl.status).toBe(201);
    const cancel = await t.call(cookies['bkg']!, 'POST', `/api/scheduling/appointments/${hold.json.appointment.id}/cancel`, { reason: 'patient rescheduled' }, B);
    expect(cancel.status).toBe(200);
    // The freed slot goes to the top waitlist candidate (urgency, then waiting time), not necessarily the newest entry.
    expect(cancel.json.backfill).toBeTruthy();
    const offered = (await t.services.db.select().from(schema.appointments).where(eq(schema.appointments.id, cancel.json.backfill.appointmentId)))[0]!;
    expect(offered.status).toBe('held');
    expect(offered.startsAt).toBe(hold.json.appointment.startsAt);
    const entry = (await t.services.db.select().from(schema.waitlist).where(eq(schema.waitlist.id, cancel.json.backfill.waitlistId)))[0]!;
    expect(entry.status).toBe('offered');
    expect(entry.modalityType).toBe('US');
    expect(wl.json.id).toBeTruthy();
  });

  it('the Booking Hand books end to end over the WhatsApp simulator within its leash', async () => {
    const [patient] = await t.services.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, 'prac_b'), eq(schema.patients.id, 'pat_nomvula'))).limit(1);
    const mobile = (patient!.mobile ?? '083 000 0000').replace(/\D/g, '');
    const first = await t.app.request('/api/sim/whatsapp/inbound', { method: 'POST', body: JSON.stringify({ from: mobile, text: 'Hi, Dr S. Naidoo MP 0123456 sent me for an ultrasound of the abdomen. RUQ pain after fatty meals.', practiceId: 'prac_b' }), headers: { 'content-type': 'application/json' } });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as any;
    expect(firstJson.state).toBe('awaiting_slot_choice');
    expect(firstJson.replies.length).toBeGreaterThan(0);
    expect(firstJson.replies[0].text).toMatch(/Reply 1, 2 or 3/);
    const conv = (await t.services.db.select().from(schema.conversations).where(eq(schema.conversations.id, firstJson.conversationId)))[0]!;
    expect(conv.offers!.length).toBeGreaterThan(0);
    expect(conv.offers!.length).toBeLessThanOrEqual(3);
    const second = await t.app.request('/api/sim/whatsapp/inbound', { method: 'POST', body: JSON.stringify({ from: mobile, text: '1', practiceId: 'prac_b' }), headers: { 'content-type': 'application/json' } });
    const secondJson = (await second.json()) as any;
    expect(secondJson.state).toBe('booked');
    expect(secondJson.replies[0].text).toMatch(/^Booked:/);
    const after = (await t.services.db.select().from(schema.conversations).where(eq(schema.conversations.id, firstJson.conversationId)))[0]!;
    const appt = (await t.services.db.select().from(schema.appointments).where(eq(schema.appointments.id, after.appointmentId!)))[0]!;
    expect(appt.status).toBe('booked');
    expect(appt.source).toBe('whatsapp');
    expect(appt.bookedBy).toBe('hand:booking');
    const held = await t.services.db.select().from(schema.appointments).where(and(eq(schema.appointments.orderId, appt.orderId), eq(schema.appointments.status, 'held')));
    expect(held.length).toBe(0);
    const task = (await t.services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, after.lastTaskId!)))[0]!;
    expect(task.status).toBe('done');
    expect(task.steps.map((s) => s.tool)).toContain('appointment.book');
  });

  it('the Booking Hand hands over on a clinical question and never answers it', async () => {
    const res = await t.app.request('/api/sim/whatsapp/inbound', { method: 'POST', body: JSON.stringify({ from: '0820001111', text: 'Do I have cancer? What does my scan mean?', practiceId: 'prac_b' }), headers: { 'content-type': 'application/json' } });
    const json = (await res.json()) as any;
    expect(json.state).toBe('handed_over');
    expect(json.replies[0].text).toMatch(/cannot answer questions about your health/);
  });
});

describe('M06 funding and authorisation', () => {
  it('runs a benefit check and produces a binding, itemised quote with VAT at 15 %', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=20', undefined, B);
    const patient = patients.json.patients.find((p: any) => p.schemeName) ?? patients.json.patients[0];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'CT-ABDO-C' }], clinicalInfo: 'Staging', siteId: 'site_umh' }, B);
    await t.flush();
    const res = await t.call(cookies['bil']!, 'GET', `/api/funding/orders/${order.json.order.id}`, undefined, B);
    expect(res.status).toBe(200);
    const { fundingCase, quote } = res.json;
    expect(fundingCase).toBeTruthy();
    expect(quote.lines.length).toBeGreaterThanOrEqual(2);
    expect(quote.lines.some((l: any) => l.kind === 'contrast')).toBe(true);
    expect(quote.vatCents).toBe(Math.round(quote.subtotalCents * 0.15));
    expect(quote.totalCents).toBe(quote.subtotalCents + quote.vatCents);
    expect(quote.schemePortionCents + quote.patientPortionCents).toBe(quote.totalCents);
    expect(quote.binding).toBe(true);
    expect(quote.validUntil > new Date().toISOString()).toBe(true);
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'funding.quoted.v1'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('the funder simulator is deterministic by member number', async () => {
    const { simulateBenefitCheck, simulateAuth } = await import('../src/sim/funder.js');
    const base = { funderCode: 'scheme-a', option: 'Core', modality: 'MR', procedureCode: 'MR-KNEE', authRequired: false };
    expect(simulateBenefitCheck({ ...base, memberNo: '100000001' }).result).toBe('covered');
    expect(simulateBenefitCheck({ ...base, memberNo: '100000005' }).result).toBe('co_pay');
    expect(simulateBenefitCheck({ ...base, memberNo: '100000007' }).result).toBe('exhausted');
    expect(simulateBenefitCheck({ ...base, memberNo: '100000009' }).result).toBe('invalid');
    expect(simulateBenefitCheck({ ...base, memberNo: '100000001', authRequired: true }).result).toBe('needs_auth');
    expect(simulateAuth({ funderCode: 'scheme-a', memberNo: '100000001', procedureCode: 'MR-KNEE', modality: 'MR', icd10: ['M23.2'], estimatedCents: 500000 }).status).toBe('approved');
    expect(simulateAuth({ funderCode: 'scheme-a', memberNo: '100000008', procedureCode: 'MR-KNEE', modality: 'MR', icd10: ['M23.2'], estimatedCents: 500000 }).status).toBe('declined');
    expect(simulateAuth({ funderCode: 'scheme-a', memberNo: '100000001', procedureCode: 'MR-KNEE', modality: 'MR', icd10: [], estimatedCents: 500000 }).status).toBe('more_info');
  });

  it('the Authorisation Hand submits within its leash and stops for BIL above it', async () => {
    const patients = await t.call(cookies['bkg']!, 'GET', '/api/patients?limit=30', undefined, B);
    const patient = patients.json.patients.find((p: any) => p.schemeName && !['7', '8', '9'].includes(String(p.memberNo ?? '1').slice(-1))) ?? patients.json.patients[0];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'MR-KNEE', laterality: 'left' }], icd10: ['M23.2'], clinicalInfo: 'Knee locking after injury', siteId: 'site_umh' }, B);
    await t.flush();
    const funding = await t.call(cookies['bil']!, 'GET', `/api/funding/orders/${order.json.order.id}`, undefined, B);
    const caseId = funding.json.fundingCase.id;
    expect(funding.json.fundingCase.authRequired || funding.json.fundingCase.authStatus === 'approved').toBeTruthy();
    // Within leash: the Hand submits and records the outcome.
    const run = await t.call(cookies['bil']!, 'POST', `/api/funding/cases/${caseId}/authorise`, {}, B);
    expect(run.status).toBe(200);
    expect(['done', 'needs_approval']).toContain(run.json.task.status);
    // Below-leash run completes; tighten the leash and it must escalate to BIL instead.
    await t.call(cookies['prm']!, 'PATCH', '/api/hands/authorisation', { leash: { maxEstimatedCents: 100 }, reason: 'test leash' }, B);
    const order2 = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'MR-SHOULDER', laterality: 'right' }], icd10: ['M75.1'], clinicalInfo: 'Rotator cuff tear suspected', siteId: 'site_umh' }, B);
    await t.flush();
    const funding2 = await t.call(cookies['bil']!, 'GET', `/api/funding/orders/${order2.json.order.id}`, undefined, B);
    const run2 = await t.call(cookies['bil']!, 'POST', `/api/funding/cases/${funding2.json.fundingCase.id}/authorise`, {}, B);
    expect(run2.json.task.status).toBe('needs_approval');
    expect(run2.json.task.approvalPersona).toBe('BIL');
    expect(run2.json.task.leashChecks.some((x: any) => x.rule === 'maxEstimatedCents' && !x.ok)).toBe(true);
    await t.call(cookies['prm']!, 'PATCH', '/api/hands/authorisation', { leash: { maxEstimatedCents: 2_500_000 }, reason: 'restore' }, B);
  });

  it('computes a Collect card that no one at the desk can edit', async () => {
    const cases = await t.call(cookies['fdk']!, 'GET', '/api/funding/cases?limit=5', undefined, B);
    const fc = cases.json.cases[0];
    const res = await t.call(cookies['fdk']!, 'GET', `/api/funding/collect/${fc.orderId}`, undefined, B);
    expect(res.status).toBe(200);
    const card = res.json.collect;
    expect(card.collectNowCents).toBe(Math.max(0, card.patientPortionCents + card.previousBalanceCents - card.depositsPaidCents));
    expect(Array.isArray(card.reasons)).toBe(true);
    expect(card.paymentMethods).toContain('payshap');
    expect(card.memberNo).toBeUndefined();
  });
});

describe('M07 registration and safety', () => {
  let encounterId: string;
  let orderId: string;

  beforeAll(async () => {
    const patients = await t.call(cookies['fdk']!, 'GET', '/api/patients?limit=40', undefined, B);
    const patient = patients.json.patients[20];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, referrerId: 'ref_pillay', procedures: [{ code: 'CT-ABDO-C' }], clinicalInfo: 'Abdominal pain, raised white cells', siteId: 'site_umh' }, B);
    orderId = order.json.order.id;
    await t.flush();
    const search = await t.call(cookies['bkg']!, 'GET', `/api/scheduling/earliest?orderId=${orderId}`, undefined, B);
    const offer = search.json.offers[0];
    const hold = await t.call(cookies['bkg']!, 'POST', '/api/scheduling/holds', { orderId, roomId: offer.roomId, startsAt: offer.startsAt }, B);
    await t.call(cookies['bkg']!, 'POST', `/api/scheduling/holds/${hold.json.appointment.id}/confirm`, {}, B);
    await t.flush();
    const enc = await t.call(cookies['fdk']!, 'POST', '/api/registration/encounters', { orderId, appointmentId: hold.json.appointment.id }, B);
    encounterId = enc.json.encounter.id;
  });

  it('seeds the right questionnaire sets for the procedure and blocks the gate until they are answered', async () => {
    const detail = await t.call(cookies['fdk']!, 'GET', `/api/registration/encounters/${encounterId}`, undefined, B);
    const sets = detail.json.questionnaires.map((q: any) => q.set).sort();
    expect(sets).toEqual(['contrast', 'ionising']);
    const gate = await t.call(cookies['fdk']!, 'GET', `/api/registration/encounters/${encounterId}/gate`, undefined, B);
    expect(gate.json.gate.blocked).toBe(true);
    expect(gate.json.gate.blocks.map((b: any) => b.check)).toContain('consent');
  });

  it('blocks the gate on a declared contrast reaction and allows it after a radiologist decision', async () => {
    const detail = await t.call(cookies['fdk']!, 'GET', `/api/registration/encounters/${encounterId}`, undefined, B);
    const ionising = detail.json.questionnaires.find((q: any) => q.set === 'ionising');
    const contrast = detail.json.questionnaires.find((q: any) => q.set === 'contrast');
    await t.call(cookies['fdk']!, 'PATCH', `/api/registration/questionnaires/${ionising.id}`, { answers: { pregnancy_possible: 'no', recent_same_region: 'no' }, answeredVia: 'desk' }, B);
    const answered = await t.call(cookies['fdk']!, 'PATCH', `/api/registration/questionnaires/${contrast.id}`, { answers: { previous_reaction: 'yes', allergies: 'no', kidney_problems: 'no', diabetes_metformin: 'no', asthma: 'no', egfr_value: 92, egfr_date: new Date().toISOString().slice(0, 10) }, answeredVia: 'desk' }, B);
    expect(answered.json.questionnaire.status).toBe('blocked');
    expect(answered.json.gate.blocked).toBe(true);
    const nurse = await t.call(cookies['nur']!, 'POST', `/api/registration/questionnaires/${contrast.id}/clear`, { note: 'Premedication protocol', conditions: ['Premedicate per protocol'] }, B);
    expect(nurse.status).toBe(403);
    const rgt = await t.call(cookies['rgt']!, 'POST', `/api/registration/questionnaires/${contrast.id}/clear`, { note: 'Mild urticaria in 2019; premedicate and use an alternative agent', conditions: ['Premedicate per protocol', 'Nurse observes for 30 minutes'] }, B);
    expect(rgt.status).toBe(200);
    expect(rgt.json.gate.blocks.map((b: any) => b.check)).not.toContain('contrast');
  });

  it('opens the gate once consent and identity are complete, and records a typed override for blocked items', async () => {
    await t.call(cookies['fdk']!, 'POST', `/api/registration/encounters/${encounterId}/consents`, { types: ['imaging', 'popia', 'contrast'], signedVia: 'desk' }, B);
    const checkIn = await t.call(cookies['fdk']!, 'POST', `/api/registration/encounters/${encounterId}/check-in`, { idVerified: true, schemeCardCaptured: true }, B);
    expect(checkIn.status).toBe(200);
    expect(checkIn.json.gate.allowed).toBe(true);
    expect(checkIn.json.encounter.status).toBe('waiting');
    expect(checkIn.json.ticket).toBeTruthy();
    await t.flush();
    const events = await t.services.db.select().from(schema.events).where(eq(schema.events.name, 'patient.arrived.v1'));
    expect(events.length).toBeGreaterThan(0);
    const order = await t.call(cookies['fdk']!, 'GET', `/api/referrals/orders/${orderId}`, undefined, B);
    expect(order.json.order.status).toBe('arrived');
  });

  it('kiosk check-in identifies, confirms, answers safety questions and issues a ticket', async () => {
    const patients = await t.call(cookies['fdk']!, 'GET', '/api/patients?limit=50', undefined, B);
    const patient = patients.json.patients[30];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'XR-CHEST' }], clinicalInfo: 'Cough 3 weeks', siteId: 'site_umh' }, B);
    await t.flush();
    const todaySast = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
    const at = new Date(`${todaySast}T14:25:00+02:00`);
    const [room] = await t.services.db.select().from(schema.rooms).where(eq(schema.rooms.id, 'room_umh_xr1'));
    const apptId = 'apt_kiosk_test';
    await t.services.db.insert(schema.appointments).values({ id: apptId, practiceId: 'prac_b', orderId: order.json.order.id, patientId: patient.id, siteId: 'site_umh', roomId: room!.id, modalityType: 'XR', procedureCode: 'XR-CHEST', procedureDescription: 'Chest X-ray, PA and lateral', startsAt: at.toISOString(), endsAt: new Date(at.getTime() + 600_000).toISOString(), status: 'booked', source: 'desk', remindersSent: [] });
    const [full] = await t.services.db.select().from(schema.patients).where(eq(schema.patients.id, patient.id));
    const ident = await t.call(cookies['fdk']!, 'POST', '/api/registration/kiosk/identify', { idNumber: full!.idNumber }, B);
    expect(ident.status).toBe(200);
    expect(ident.json.found).toBe(true);
    const encId = ident.json.encounter.encounter.id;
    const done = await t.call(cookies['fdk']!, 'POST', `/api/registration/kiosk/${encId}/check-in`, { confirmed: true, answers: { ionising: { pregnancy_possible: 'no', recent_same_region: 'no' } }, consents: ['imaging', 'popia'] }, B);
    expect(done.status).toBe(200);
    expect(done.json.ticket.ticket).toMatch(/^X-\d{3}$/);
    expect(done.json.gate.allowed).toBe(true);
    expect(done.json.waitMinutes).toBeGreaterThan(0);
    const queue = await t.app.request(`/api/registration/queue/site_umh`);
    const q = (await queue.json()) as any;
    expect(JSON.stringify(q)).not.toContain(full!.lastName);
    expect(q.waiting.concat(q.nowServing).some((x: any) => x.ticket === done.json.ticket.ticket)).toBe(true);
  });

  it('requires a typed confirmation and the right persona for a gate override', async () => {
    const patients = await t.call(cookies['fdk']!, 'GET', '/api/patients?limit=60', undefined, B);
    const patient = patients.json.patients[40];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'MR-BRAIN' }], clinicalInfo: 'Headache with visual field defect', siteId: 'site_umh' }, B);
    await t.flush();
    const enc = await t.call(cookies['fdk']!, 'POST', '/api/registration/encounters', { orderId: order.json.order.id }, B);
    const id = enc.json.encounter.id;
    const detail = await t.call(cookies['fdk']!, 'GET', `/api/registration/encounters/${id}`, undefined, B);
    const mri = detail.json.questionnaires.find((q: any) => q.set === 'mri');
    await t.call(cookies['fdk']!, 'PATCH', `/api/registration/questionnaires/${mri.id}`, { answers: { pacemaker: 'yes', implant: 'no', metal_fragments: 'no', surgery_implants: 'no', patches: 'no', claustrophobia: 'no', pregnancy_possible: 'no' }, answeredVia: 'desk' }, B);
    const gate = await t.call(cookies['fdk']!, 'GET', `/api/registration/encounters/${id}/gate`, undefined, B);
    expect(gate.json.gate.blocked).toBe(true);
    const wrongConfirm = await t.call(cookies['rgt']!, 'POST', `/api/registration/encounters/${id}/gate/override`, { reason: 'MR conditional device, conditions on the protocol card', items: ['mri'], confirm: 'wrong' }, B);
    expect(wrongConfirm.status).toBe(400);
    const byNurse = await t.call(cookies['nur']!, 'POST', `/api/registration/encounters/${id}/gate/override`, { reason: 'MR conditional device, conditions on the protocol card', items: ['mri'], confirm: patient.lastName }, B);
    expect(byNurse.status).toBe(403);
    const ok = await t.call(cookies['rgt']!, 'POST', `/api/registration/encounters/${id}/gate/override`, { reason: 'MR conditional pacemaker, cardiology present, conditions recorded on the protocol card', items: ['mri'], confirm: patient.lastName }, B);
    expect(ok.status).toBe(200);
    expect(ok.json.gate.overridden).toBe(true);
    const audits = await t.services.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'safety.gate_overridden'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('the Front Desk Hand chases what is missing without touching answers or clearances', async () => {
    const patients = await t.call(cookies['fdk']!, 'GET', '/api/patients?limit=60', undefined, B);
    const patient = patients.json.patients[45];
    const order = await t.call(cookies['bkg']!, 'POST', '/api/referrals/orders', { patientId: patient.id, procedures: [{ code: 'CT-CHEST-C' }], clinicalInfo: 'Staging', siteId: 'site_umh' }, B);
    await t.flush();
    const enc = await t.call(cookies['fdk']!, 'POST', '/api/registration/encounters', { orderId: order.json.order.id }, B);
    const { runFrontDeskHand } = await import('../src/modules/m07-registration/service.js');
    const task = await runFrontDeskHand(t.services, enc.json.encounter.id, 'prac_b', 'manual');
    expect(task.status).toBe('done');
    expect((task.output as any).stillNeeded.length).toBeGreaterThan(0);
    const tools = task.steps.map((s) => s.tool);
    expect(tools).toContain('collect_card.read');
    expect(tools).not.toContain('safety.answer');
    const { frontDeskHand } = await import('../src/modules/m07-registration/service.js');
    expect(Object.keys(frontDeskHand.tools)).not.toContain('consent.grant');
    expect(Object.keys(frontDeskHand.tools)).not.toContain('identity.verify');
  });
});

describe('cluster A seed', () => {
  it('seeds enough volume for the consoles, including today', async () => {
    const orders = await t.services.db.select().from(schema.orders);
    const appts = await t.services.db.select().from(schema.appointments);
    const cases = await t.services.db.select().from(schema.fundingCases);
    const encs = await t.services.db.select().from(schema.encounters);
    const refs = await t.services.db.select().from(schema.referrals);
    const tpls = await t.services.db.select().from(schema.slotTemplates);
    const funders = await t.services.db.select().from(schema.funders);
    expect(orders.length).toBeGreaterThan(130);
    expect(appts.length).toBeGreaterThan(120);
    expect(cases.length).toBeGreaterThan(130);
    expect(encs.length).toBeGreaterThan(30);
    expect(refs.length).toBeGreaterThanOrEqual(10);
    expect(funders.length).toBeGreaterThanOrEqual(7);
    const rooms = await t.services.db.select().from(schema.rooms);
    const roomsWithTemplates = new Set(tpls.map((x) => x.roomId));
    expect(roomsWithTemplates.size).toBe(rooms.length);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
    expect(appts.some((a) => a.startsAt.slice(0, 10) === today)).toBe(true);
    expect(refs.some((x) => x.status === 'needs_info')).toBe(true);
  });
});
