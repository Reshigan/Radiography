import { eq, and } from 'drizzle-orm';
import { addVat, newId, luhnCheckDigit } from '@bonakala/domain';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import type { OrderProcedure, QuoteLine, BenefitCheckResult, FunderRules } from '../schema/index.js';
import { rng, pick } from './data.js';
import { PROCEDURES, type ProcedureSeed } from './cluster-a-data.js';

/* ------------------------------------------------------------------ helpers */
const SAST = '+02:00';
const iso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${SAST}`).toISOString();
const dayString = (offsetDays: number, base = new Date()) => {
  const d = new Date(base.getTime() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
};
const weekdayOf = (date: string) => new Date(`${date}T12:00:00${SAST}`).getUTCDay();
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const CLINICAL: Record<string, string[]> = {
  XR: ['Cough for 3 weeks, night sweats. Query TB.', 'Fall at home, unable to weight-bear.', 'Low back pain 4 weeks, no red flags.', 'Shoulder pain after lifting, limited abduction.', 'Twisted ankle on stairs, bony tenderness.', 'Chronic cough, smoker 20 pack-years.'],
  CT: ['Fall at home, headache and confusion 6 h. On anticoagulant. Query bleed.', 'Right flank pain radiating to groin, haematuria. Query renal colic.', 'Acute abdominal pain, raised white cells.', 'Weight loss and cough, staging required.', 'Chest pain and dyspnoea, Wells score 5. Query PE.', 'Head injury with vomiting, GCS 14.'],
  MR: ['Low back pain with right leg radiculopathy and foot weakness for 6 weeks.', 'Knee locking and giving way after rugby injury.', 'Shoulder pain with night symptoms, query rotator cuff tear.', 'Headache with new visual field defect.', 'Neck pain with arm paraesthesia, query disc.', 'Raised PSA, query prostate lesion.'],
  US: ['Right upper quadrant pain after fatty meals, query gallstones.', 'Swollen left calf after a long flight, query DVT.', 'Palpable breast lump, 26 years old.', 'Thyroid swelling, euthyroid.', 'First trimester bleeding, dating scan needed.', 'Loin pain with raised creatinine.'],
  MG: ['Routine screening, family history of breast cancer.', 'Palpable lump upper outer quadrant, 52 years old.', 'Screening recall after dense tissue report.'],
  DXA: ['Post-menopausal, on long-term steroids, fracture risk assessment.', 'Fragility fracture of wrist, assess bone density.'],
};

const REFERRAL_TEXTS = [
  { text: 'Dr S. Naidoo MP 0123456 PR 0223344\nPatient: Thandiwe Mkhize  ID 8503145012089\nPlease do MRI lumbar spine, no contrast.\nClinical: low back pain with right leg radiculopathy 6 weeks, foot weakness.\nUrgent.', channel: 'paper_photo' },
  { text: 'Referral from Dr R. Pillay, practice 0223345. CT of the head, no contrast. Fall at home, headache and confusion 6 hours, on anticoagulant. Query bleed. Urgent please.', channel: 'whatsapp' },
  { text: 'Kindly do an ultrasound of the abdomen. RUQ pain after fatty meals, query gallstones. Dr T. Moodley PR 0223346', channel: 'email' },
  { text: 'X-ray chest PA. Cough 3 weeks, night sweats, query TB. Dr L. Ndlovu MP 0123461', channel: 'fax' },
  { text: 'Please arrange mammogram — routine screening, family history. Dr R. Pillay 0223345', channel: 'portal' },
  { text: 'MRI right knee. Locking and giving way after rugby. Dr J. van Wyk, Sandton Orthopaedic Group, MP 0123459', channel: 'portal' },
  { text: 'Scan of the tummy please, sore on the right side', channel: 'whatsapp' },
  { text: 'X-ray needed, patient fell', channel: 'whatsapp' },
  { text: 'CT abdomen and pelvis with contrast, staging. Dr M. Sibanda MP 0123462. ICD-10 C18.9', channel: 'email' },
  { text: 'Doppler both legs, swollen calf after flight. Dr S. Naidoo MP 0123456', channel: 'portal' },
];

/* ------------------------------------------------------------------ seeder */
export async function seedClusterA(db: Db, ctx: SeedContext): Promise<Record<string, number> | void> {
  const r = rng(1104);
  const now = new Date();

  /* 1. Procedure catalogue -------------------------------------------------- */
  const existingCat = await db.select({ id: s.referenceData.id }).from(s.referenceData).where(eq(s.referenceData.kind, 'procedure')).limit(1);
  if (existingCat.length === 0) {
    for (const p of PROCEDURES) {
      await db.insert(s.referenceData).values({ id: newId('ref'), kind: 'procedure', key: p.code, practiceId: null, value: p as unknown as Record<string, unknown>, effectiveFrom: '2026-01-01', version: 1 });
    }
  }
  const byCode = new Map(PROCEDURES.map((p) => [p.code, p]));

  /* 2. Load-shedding config per site ---------------------------------------- */
  const lsExisting = await db.select({ id: s.referenceData.id }).from(s.referenceData).where(eq(s.referenceData.kind, 'loadshedding')).limit(1);
  if (lsExisting.length === 0) {
    const configs: Record<string, { stage: number; schedule: Array<{ weekday: number; start: string; end: string }>; generatorModalities: string[]; note: string }> = {
      [ctx.sites.SAN]: { stage: 0, schedule: [], generatorModalities: ['XR', 'US', 'CT', 'MR', 'MG', 'DXA'], note: 'Full generator cover, 750 kVA, 18 hours of fuel.' },
      [ctx.sites.RBG]: { stage: 4, schedule: [{ weekday: 1, start: '08:00', end: '10:30' }, { weekday: 2, start: '08:00', end: '10:30' }, { weekday: 3, start: '14:00', end: '16:30' }, { weekday: 4, start: '08:00', end: '10:30' }, { weekday: 5, start: '20:00', end: '22:30' }], generatorModalities: ['XR', 'US'], note: 'Generator carries radiography and ultrasound. CT waits for grid power.' },
      [ctx.sites.UMH]: { stage: 2, schedule: [{ weekday: 2, start: '12:00', end: '14:30' }, { weekday: 4, start: '18:00', end: '20:30' }], generatorModalities: ['XR', 'US', 'CT', 'MG', 'DXA'], note: 'MRI cannot run on the site generator (draw exceeds 400 kVA).' },
      [ctx.sites.BAL]: { stage: 2, schedule: [{ weekday: 1, start: '16:00', end: '18:30' }, { weekday: 3, start: '06:00', end: '08:30' }], generatorModalities: ['XR', 'US'], note: 'UPS covers the Edge Gateway and check-in for 4 hours.' },
    };
    for (const [siteId, cfg] of Object.entries(configs)) await db.insert(s.referenceData).values({ id: newId('ref'), kind: 'loadshedding', key: siteId, practiceId: null, value: cfg, effectiveFrom: '2026-01-01' });
  }

  /* 3. Funders --------------------------------------------------------------- */
  const funderDefs: Array<{ id: string; type: string; code: string; name: string; administrator?: string; options: string[]; dsp: boolean; rules: FunderRules; contact: Record<string, string> }> = [
    { id: 'fdr_scheme_a', type: 'scheme', code: 'scheme-a', name: 'Scheme A (demo)', administrator: 'Demo Administrators (Pty) Ltd', options: ['Core', 'Plus', 'Executive'], dsp: true, rules: { authRequiredModalities: ['MR', 'CT'], authByOption: { Executive: ['MR'] }, networkCoPayPct: 20, networkOptions: ['Core'], networkSiteIds: [ctx.sites.SAN, ctx.sites.UMH], ratePct: 100, turnaroundHours: 24 }, contact: { auth: 'auth@scheme-a.demo', queries: '0800 000 001', claims: 'claims@scheme-a.demo' } },
    { id: 'fdr_scheme_b', type: 'scheme', code: 'scheme-b', name: 'Scheme B (demo)', administrator: 'Demo Health Administrators', options: ['Option Core', 'Option Plus'], dsp: false, rules: { authRequiredModalities: ['MR', 'CT', 'MG'], networkCoPayPct: 0, ratePct: 95, turnaroundHours: 48 }, contact: { auth: 'preauth@scheme-b.demo', queries: '0800 000 002' } },
    { id: 'fdr_scheme_c', type: 'scheme', code: 'scheme-c', name: 'Scheme C (demo)', administrator: 'Demo Managed Care', options: ['Standard', 'Comprehensive'], dsp: true, rules: { authRequiredModalities: ['MR'], networkCoPayPct: 30, networkOptions: ['Standard'], networkSiteIds: [ctx.sites.UMH, ctx.sites.BAL], ratePct: 92, turnaroundHours: 24 }, contact: { auth: 'auth@scheme-c.demo' } },
    { id: 'fdr_cash', type: 'cash', code: 'cash', name: 'Cash and private paying', options: [], dsp: false, rules: { authRequiredModalities: [], cashDiscountPct: 15 }, contact: {} },
    { id: 'fdr_raf', type: 'raf', code: 'raf', name: 'Road Accident Fund (demo)', options: [], dsp: false, rules: { authRequiredModalities: [] }, contact: { claims: 'claims@raf.demo' } },
    { id: 'fdr_coida', type: 'coida', code: 'coida', name: 'Compensation Fund, COIDA (demo)', options: [], dsp: false, rules: { authRequiredModalities: [] }, contact: { claims: 'iod@coida.demo' } },
    { id: 'fdr_corporate', type: 'corporate', code: 'corporate-mine', name: 'Demo Mining Occupational Health', options: [], dsp: false, rules: { authRequiredModalities: [] }, contact: { queries: 'health@demomine.demo' } },
  ];
  for (const f of funderDefs) {
    const ex = await db.select({ id: s.funders.id }).from(s.funders).where(eq(s.funders.id, f.id)).limit(1);
    if (ex.length === 0) await db.insert(s.funders).values({ id: f.id, practiceId: null, type: f.type, code: f.code, name: f.name, administrator: f.administrator ?? null, options: f.options, dsp: f.dsp, rules: f.rules, contact: f.contact, status: 'active' });
  }

  /* 4. Slot templates for every room ---------------------------------------- */
  const rooms = await db.select().from(s.rooms);
  const tplExisting = await db.select({ id: s.slotTemplates.id }).from(s.slotTemplates).limit(1);
  if (tplExisting.length === 0) {
    const grid: Record<string, number> = { XR: 10, US: 20, CT: 15, MR: 30, MG: 20, DXA: 20 };
    for (const room of rooms) {
      const slot = grid[room.roomType] ?? 20;
      for (let weekday = 1; weekday <= 5; weekday++) {
        await db.insert(s.slotTemplates).values({ id: newId('tpl'), practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, weekday, startTime: '07:00', endTime: '17:00', slotMinutes: slot, durationByProcedure: null, blockType: 'open', walkInReservePct: room.roomType === 'XR' ? 20 : 0, effectiveFrom: '2026-01-01' });
      }
      // Saturday morning list
      await db.insert(s.slotTemplates).values({ id: newId('tpl'), practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, weekday: 6, startTime: '08:00', endTime: '13:00', slotMinutes: slot, blockType: 'open', walkInReservePct: 0, effectiveFrom: '2026-01-01' });
      // MRI evening list on Wednesdays and Thursdays (matches the booking console mockup)
      if (room.roomType === 'MR') for (const weekday of [3, 4]) await db.insert(s.slotTemplates).values({ id: newId('tpl'), practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: 'MR', weekday, startTime: '17:00', endTime: '20:00', slotMinutes: 30, blockType: 'open', walkInReservePct: 0, effectiveFrom: '2026-01-01' });
    }
  }

  /* 5. Orders, appointments, funding, encounters ---------------------------- */
  const ordersExisting = await db.select({ id: s.orders.id }).from(s.orders).limit(1);
  const publishedOrders: Array<{ id: string; patientId: string; practiceId: string; siteId: string | null; procedureCode: string; modality: string; appointmentId: string | null; referrerId: string | null; status: string }> = [];

  if (ordersExisting.length === 0) {
    const patientsByPractice = ctx.patientsByPractice;
    const allPatients = await db.select().from(s.patients);
    const patientMap = new Map(allPatients.map((p) => [p.id, p]));
    const roomsBySite: Record<string, typeof rooms> = {};
    for (const room of rooms) (roomsBySite[room.siteId] ??= []).push(room);
    const sitesOfPractice: Record<string, string[]> = { [ctx.practiceA]: [ctx.sites.SAN, ctx.sites.RBG], [ctx.practiceB]: [ctx.sites.UMH, ctx.sites.BAL] };
    let orderSeq = 0;
    const counts = { orders: 0, appointments: 0, fundingCases: 0, quotes: 0, authorisations: 0, encounters: 0, questionnaires: 0, consents: 0, tickets: 0, waitlist: 0, reminders: 0 };

    const makeOrder = async (opts: { practiceId: string; patientId: string; proc: ProcedureSeed; siteId: string; createdAt: string; status: string; priority?: string; referrerId?: string; channel?: string }) => {
      const id = newId('ord');
      orderSeq++;
      const orderNo = `ORD-26-${String(orderSeq).padStart(6, '0')}`;
      const p = opts.proc;
      const laterality: OrderProcedure['laterality'] = p.lateralityRequired ? (r() < 0.5 ? 'left' : 'right') : 'na';
      const procedures: OrderProcedure[] = [{ code: p.code, description: p.description, modality: p.modality, bodyPart: p.bodyPart, laterality, contrast: p.contrast === 'required', tariffCode: p.tariffCode, durationMin: p.durationMin, ionising: p.ionising }];
      const clinicalInfo = pick(r, CLINICAL[p.modality] ?? ['Clinical details on the referral.']);
      const referrerId = opts.referrerId ?? pick(r, ctx.referrers);
      await db.insert(s.orders).values({
        id, practiceId: opts.practiceId, orderNo, siteId: opts.siteId, patientId: opts.patientId, referrerId, referralId: null, channel: opts.channel ?? pick(r, ['portal', 'whatsapp', 'paper_photo', 'email', 'fax', 'phone']),
        procedures, priority: opts.priority ?? (r() < 0.08 ? 'urgent' : r() < 0.2 ? 'priority' : 'routine'), icd10: [], clinicalInfo, justification: 'justified', justificationNote: null,
        appropriateness: { band: 'usually_appropriate', ruleId: 'SEED', guidance: 'Recorded at order entry from the adopted guideline pack.', guidelinePack: 'Practice referral guidelines 2026.1' },
        recentStudy: { found: false, matches: [], windowDays: 30 }, protocollingRequired: ['CT', 'MR'].includes(p.modality), status: opts.status,
        funderType: patientMap.get(opts.patientId)?.schemeId ? 'scheme' : 'cash', createdBy: 'seed', createdAt: opts.createdAt, updatedAt: opts.createdAt, validUntil: new Date(new Date(opts.createdAt).getTime() + 90 * 86400_000).toISOString(),
      });
      counts.orders++;
      return { id, orderNo, procedures, referrerId };
    };

    const makeFunding = async (order: { id: string; procedures: OrderProcedure[] }, patientId: string, practiceId: string, siteId: string, createdAt: string, opts: { forceStatus?: string } = {}) => {
      const patient = patientMap.get(patientId)!;
      const proc = byCode.get(order.procedures[0]!.code)!;
      const funder = funderDefs.find((f) => f.code === patient.schemeId) ?? funderDefs.find((f) => f.code === 'cash')!;
      const isScheme = funder.type === 'scheme';
      const lines: QuoteLine[] = [{ tariffCode: proc.tariffCode, description: proc.description, units: 1, unitCents: isScheme ? Math.round(proc.tariffCents * ((funder.rules.ratePct ?? 100) / 100)) : proc.cashCents, totalCents: isScheme ? Math.round(proc.tariffCents * ((funder.rules.ratePct ?? 100) / 100)) : proc.cashCents, kind: 'procedure' }];
      if (order.procedures[0]!.contrast) lines.push({ tariffCode: 'T-CONTRAST', description: 'Contrast material (IV)', units: 1, unitCents: 85000, totalCents: 85000, kind: 'contrast' });
      const subtotalCents = lines.reduce((a, l) => a + l.totalCents, 0);
      const { vat: vatCents, incl: totalCents } = addVat(subtotalCents);
      const memberNo = patient.memberNo ?? null;
      const lastDigit = memberNo ? Number(memberNo.slice(-1)) : 0;
      const authRequired = isScheme && (funder.rules.authByOption?.[patient.schemeOption ?? ''] ?? funder.rules.authRequiredModalities).includes(proc.modality);
      let patientPortionCents = 0;
      const reasonCodes: string[] = [];
      let result: BenefitCheckResult['result'] = 'covered';
      let message = 'Benefit available; funds confirmed at scheme rate.';
      if (!isScheme) { patientPortionCents = totalCents; reasonCodes.push('CASH'); result = 'cash'; message = 'Cash tariff applies; payable before or on the day.'; }
      else if (lastDigit === 9) { patientPortionCents = totalCents; reasonCodes.push('MEMBERSHIP_LAPSED'); result = 'invalid'; message = 'Membership lapsed; contributions outstanding.'; }
      else if (lastDigit === 7 || lastDigit === 8) { patientPortionCents = totalCents; reasonCodes.push('BENEFIT_EXHAUSTED'); result = 'exhausted'; message = 'Day-to-day radiology benefit exhausted for this year; the patient is liable.'; }
      else if (lastDigit === 5 || lastDigit === 6) { patientPortionCents = Math.round(totalCents * 0.2); reasonCodes.push('CO_PAYMENT'); result = authRequired ? 'needs_auth' : 'co_pay'; message = 'Covered with a 20 % co-payment.'; }
      else if (funder.rules.networkOptions?.includes(patient.schemeOption ?? '') && funder.rules.networkSiteIds?.length && !funder.rules.networkSiteIds.includes(siteId)) { patientPortionCents = Math.round((totalCents * (funder.rules.networkCoPayPct ?? 20)) / 100); reasonCodes.push('NETWORK_CO_PAYMENT'); result = authRequired ? 'needs_auth' : 'co_pay'; message = `Covered; network co-payment of ${funder.rules.networkCoPayPct} % applies outside the designated network.`; }
      else { reasonCodes.push('COVERED'); result = authRequired ? 'needs_auth' : 'covered'; if (authRequired) message = `Pre-authorisation required for ${proc.modality} on this option.`; }
      const benefitCheck: BenefitCheckResult = { result, checkedAt: createdAt, source: isScheme ? 'sim:funder' : 'manual', reasonCodes: [...reasonCodes], message };
      const caseId = newId('fnd');
      const quoteId = newId('qte');
      let authStatus: string = authRequired ? 'approved' : 'not_required';
      let authNumber: string | null = null;
      let status = opts.forceStatus ?? (isScheme ? (authRequired ? 'authorised' : 'quoted') : 'deposit_due');
      if (authRequired) {
        if (lastDigit === 8 || lastDigit === 9) { authStatus = 'declined'; status = 'auth_declined'; patientPortionCents = totalCents; }
        else if (r() < 0.12) { authStatus = 'requested'; status = 'auth_requested'; }
        else { authNumber = `AUTH-${String(Math.floor(r() * 899999) + 100000)}`; authStatus = 'approved'; status = 'authorised'; }
      }
      await db.insert(s.fundingCases).values({
        id: caseId, practiceId, orderId: order.id, patientId, siteId, funderType: funder.type, funderId: funder.code, schemeName: isScheme ? funder.name : null, schemeOption: patient.schemeOption, memberNo, dependantCode: patient.dependantCode,
        status, benefitCheck, totalCents, schemePortionCents: totalCents - patientPortionCents, patientPortionCents, reasonCodes: [...reasonCodes], authRequired, authStatus, authNumber, authValidTo: authNumber ? dayString(30) : null, quoteId, createdAt, updatedAt: createdAt,
      });
      counts.fundingCases++;
      const assumptions: string[] = [];
      if (authRequired && authStatus !== 'approved') assumptions.push('Assumes the scheme authorises the procedure; without authorisation the patient portion is the full amount.');
      if (reasonCodes.includes('CO_PAYMENT')) assumptions.push('Co-payment of 20 % applies on this option.');
      await db.insert(s.quotes).values({ id: quoteId, practiceId, fundingCaseId: caseId, orderId: order.id, patientId, version: 1, lines, subtotalCents, vatCents, totalCents, schemePortionCents: totalCents - patientPortionCents, patientPortionCents, reasonCodes: [...reasonCodes], assumptions, validUntil: new Date(new Date(createdAt).getTime() + 30 * 86400_000).toISOString(), binding: true, feeScheduleVersion: 'demo-2026.1', rulePackVersion: 'demo-2026.1', createdAt });
      counts.quotes++;
      if (authRequired) {
        await db.insert(s.authorisations).values({
          id: newId('aut'), practiceId, fundingCaseId: caseId, orderId: order.id, funderId: funder.code, status: authStatus === 'approved' ? 'approved' : authStatus === 'declined' ? 'declined' : 'requested',
          requestPayload: { funderCode: funder.code, memberNo: memberNo ? `····${memberNo.slice(-4)}` : null, procedureCode: proc.code, modality: proc.modality, estimatedCents: totalCents },
          responsePayload: { status: authStatus, authNumber, latencyMs: 900 }, funderReference: `REQ-${String(Math.floor(r() * 899999) + 100000)}`, authNumber, validFrom: authNumber ? dayString(0) : null, validTo: authNumber ? dayString(30) : null,
          approvedCents: authNumber ? totalCents : null, reason: authStatus === 'declined' ? 'Benefit exhausted; no further radiology benefit this year.' : null, attempts: 1, submittedBy: 'hand:authorisation', submittedAt: createdAt, respondedAt: createdAt, createdAt,
        });
        counts.authorisations++;
      }
      await db.update(s.orders).set({ fundingCaseId: caseId, funderType: funder.type }).where(eq(s.orders.id, order.id));
      return { caseId, totalCents, patientPortionCents, schemePortionCents: totalCents - patientPortionCents, reasonCodes, quoteId, authNumber, authStatus, authRequired };
    };

    const makeAppointment = async (order: { id: string; procedures: OrderProcedure[] }, patientId: string, practiceId: string, siteId: string, startsAt: string, status: string, source: string) => {
      const proc = byCode.get(order.procedures[0]!.code)!;
      const roomType = proc.modality;
      const candidates = (roomsBySite[siteId] ?? []).filter((x) => x.roomType === roomType);
      if (!candidates.length) return null;
      const room = candidates[Math.floor(r() * candidates.length)]!;
      const endsAt = new Date(new Date(startsAt).getTime() + proc.durationMin * 60_000).toISOString();
      const clash = await db.select({ id: s.appointments.id }).from(s.appointments).where(and(eq(s.appointments.roomId, room.id), eq(s.appointments.startsAt, startsAt)));
      if (clash.length) return null;
      const id = newId('apt');
      await db.insert(s.appointments).values({
        id, practiceId, orderId: order.id, patientId, siteId, roomId: room.id, modalityType: roomType, procedureCode: proc.code, procedureDescription: proc.description, startsAt, endsAt, status, source,
        bookedBy: source === 'hand' ? 'hand:booking' : ctx.users['BKG'] ?? 'seed', remindersSent: status === 'booked' || status === 'confirmed' ? [{ kind: 'confirmation', at: startsAt, channel: 'whatsapp' }] : [],
        noShowScore: Math.round((0.05 + r() * 0.35) * 100), noShowModel: 'noshow-heuristic@1.0', constraintsEvaluated: ['licence', 'modality_status', 'qa', 'load_shedding', 'template', 'overlap'], createdAt: startsAt, updatedAt: startsAt,
      });
      counts.appointments++;
      await db.update(s.orders).set({ appointmentId: id, siteId }).where(eq(s.orders.id, order.id));
      return { id, roomId: room.id, roomName: room.name, startsAt, endsAt, proc };
    };

    const makeEncounter = async (order: { id: string; procedures: OrderProcedure[] }, appt: { id: string; startsAt: string; roomName: string }, patientId: string, practiceId: string, siteId: string, mode: 'pre' | 'arrived' | 'in_room' | 'done', funding: { patientPortionCents: number; schemePortionCents: number; totalCents: number; reasonCodes: string[] }) => {
      const patient = patientMap.get(patientId)!;
      const proc = byCode.get(order.procedures[0]!.code)!;
      const id = newId('enc');
      const arrivedAt = mode === 'pre' ? null : new Date(new Date(appt.startsAt).getTime() - (5 + Math.floor(r() * 20)) * 60_000).toISOString();
      const complete = mode !== 'pre' || r() < 0.6;
      const collectNow = Math.max(0, funding.patientPortionCents);
      await db.insert(s.encounters).values({
        id, practiceId, siteId, appointmentId: appt.id, orderId: order.id, patientId,
        status: mode === 'pre' ? 'pre_checked_in' : mode === 'arrived' ? 'waiting' : mode === 'in_room' ? 'in_room' : 'done',
        channel: pick(r, ['patient_space', 'whatsapp', 'kiosk', 'desk']), arrivedAt, identityLevel: patient.idVerifiedAt ? 2 : 1, identityVerifiedAt: patient.idVerifiedAt, identityEvidence: patient.idVerifiedAt ? 'ID document seen at desk' : null,
        schemeCardCaptured: !!patient.schemeId && r() < 0.8, language: patient.language, interpreter: patient.language !== 'en' && r() < 0.2 ? patient.language : null, chaperone: r() < 0.06,
        queueTicket: mode === 'pre' ? null : `${proc.modality.slice(0, 1)}-${String(Math.floor(r() * 90) + 10).padStart(3, '0')}`, queueRoom: mode === 'in_room' || mode === 'done' ? appt.roomName : null,
        calledAt: mode === 'in_room' || mode === 'done' ? appt.startsAt : null, inRoomAt: mode === 'in_room' || mode === 'done' ? appt.startsAt : null, doneAt: mode === 'done' ? new Date(new Date(appt.startsAt).getTime() + proc.durationMin * 60_000).toISOString() : null,
        waitMinutes: mode === 'in_room' || mode === 'done' ? 5 + Math.floor(r() * 25) : null,
        collect: { totalCents: funding.totalCents, schemePortionCents: funding.schemePortionCents, patientPortionCents: funding.patientPortionCents, previousBalanceCents: 0, depositsPaidCents: mode === 'done' ? collectNow : 0, collectNowCents: mode === 'done' ? 0 : collectNow, reasonCodes: funding.reasonCodes, quoteVersion: 1 },
        collectedCents: mode === 'done' ? collectNow : 0,
        stillNeeded: mode === 'done' ? [] : [
          ...(complete ? [] : [...new Set(proc.safetySets)].map((set) => `${set === 'ionising' ? 'Radiation safety' : set === 'mri' ? 'MRI safety' : set === 'contrast' ? 'Contrast safety' : 'Sedation'} questions`)),
          ...(complete ? [] : ['imaging consent']),
          ...(patient.schemeId && r() < 0.25 ? ['Scheme card'] : []),
          ...(collectNow > 0 && mode === 'pre' ? [`Payment of R${Math.round(collectNow / 100)}`] : []),
        ],
        createdAt: arrivedAt ?? appt.startsAt, updatedAt: arrivedAt ?? appt.startsAt,
      });
      counts.encounters++;
      // questionnaires
      const sets = new Set<string>(proc.safetySets);
      for (const set of sets) {
        const answers: Record<string, string | number | null> = {};
        let status = 'not_started';
        let completeness = 0;
        const blockingItems: string[] = [];
        const conditions: string[] = [];
        if (complete) {
          completeness = 100;
          status = 'cleared';
          if (set === 'ionising') { answers['pregnancy_possible'] = patient.sex === 'F' ? 'no' : 'no'; answers['recent_same_region'] = 'no'; }
          if (set === 'mri') { answers['pacemaker'] = 'no'; answers['implant'] = r() < 0.12 ? 'yes' : 'no'; answers['metal_fragments'] = 'no'; answers['surgery_implants'] = 'no'; answers['patches'] = 'no'; answers['claustrophobia'] = r() < 0.15 ? 'yes' : 'no'; answers['pregnancy_possible'] = 'no';
            if (answers['implant'] === 'yes') { status = 'needs_review'; conditions.push('Any other implant: cochlear implant, neurostimulator, aneurysm clip, stent or valve?: yes'); }
            else if (answers['claustrophobia'] === 'yes') { status = 'needs_review'; conditions.push('Do enclosed spaces worry you?: yes'); } }
          if (set === 'contrast') {
            const reaction = (patient.flags ?? []).includes('contrast_reaction');
            answers['previous_reaction'] = reaction ? 'yes' : 'no'; answers['allergies'] = r() < 0.1 ? 'yes' : 'no'; answers['kidney_problems'] = r() < 0.12 ? 'yes' : 'no';
            answers['egfr_value'] = answers['kidney_problems'] === 'yes' ? 45 + Math.floor(r() * 30) : 88 + Math.floor(r() * 25); answers['egfr_date'] = dayString(-(5 + Math.floor(r() * 60)));
            answers['diabetes_metformin'] = r() < 0.15 ? 'yes' : 'no'; answers['asthma'] = r() < 0.1 ? 'yes' : 'no';
            if (reaction) { status = 'blocked'; blockingItems.push('Have you ever reacted to contrast dye?: yes'); }
            else if (answers['allergies'] === 'yes' || answers['kidney_problems'] === 'yes') { status = 'needs_review'; conditions.push('Declared allergy or kidney problem: nurse review before contrast'); }
            if (answers['diabetes_metformin'] === 'yes') conditions.push('Metformin: follow the practice holding protocol after contrast');
          }
        } else if (r() < 0.6) { completeness = 50; status = 'answered'; if (set === 'ionising') answers['pregnancy_possible'] = 'no'; }
        await db.insert(s.safetyQuestionnaires).values({ id: newId('sfq'), practiceId, encounterId: id, patientId, set, version: '2026.1', answers, completeness, status, blockingItems, conditions, answeredBy: 'patient', answeredVia: 'patient_space', clearedBy: status === 'cleared' && mode === 'done' ? ctx.users['NUR'] ?? null : null, clearedAt: status === 'cleared' && mode === 'done' ? appt.startsAt : null });
        counts.questionnaires++;
      }
      // consents
      const consentTypes = ['imaging', 'popia', ...(proc.contrast === 'required' ? ['contrast'] : [])];
      if (complete) for (const t of consentTypes) {
        await db.insert(s.consents).values({ id: newId('cns'), practiceId, encounterId: id, patientId, type: t, version: '2026.1', language: patient.language, granted: true, signedVia: mode === 'pre' ? 'patient_space' : pick(r, ['patient_space', 'kiosk', 'desk']), signerRelationship: 'self', evidence: 'signature', signedAt: arrivedAt ?? appt.startsAt });
        counts.consents++;
      }
      if (mode !== 'pre') {
        await db.insert(s.queueTickets).values({ id: newId('tkt'), practiceId, siteId, encounterId: id, ticket: `${proc.modality.slice(0, 1)}-${String(Math.floor(r() * 90) + 10).padStart(3, '0')}`, roomType: proc.modality, room: mode === 'in_room' || mode === 'done' ? appt.roomName : null, status: mode === 'arrived' ? 'waiting' : mode === 'in_room' ? 'in_room' : 'done', issuedAt: arrivedAt ?? appt.startsAt, calledAt: mode === 'arrived' ? null : appt.startsAt, estimatedWaitMinutes: 5 + Math.floor(r() * 25) });
        counts.tickets++;
      }
      return id;
    };

    /* --- past 30 days: completed activity -------------------------------- */
    const modalityWeights: Array<[ProcedureSeed['modality'], number]> = [['XR', 0.42], ['US', 0.2], ['CT', 0.18], ['MR', 0.12], ['MG', 0.05], ['DXA', 0.03]];
    const pickProcedure = (): ProcedureSeed => {
      const x = r();
      let acc = 0;
      let modality: ProcedureSeed['modality'] = 'XR';
      for (const [m, w] of modalityWeights) { acc += w; if (x <= acc) { modality = m; break; } }
      const list = PROCEDURES.filter((p) => p.modality === modality);
      return list[Math.floor(r() * list.length)]!;
    };

    const nowMins = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(now)) * 60 + now.getUTCMinutes();
    for (let d = -30; d <= 14; d++) {
      const date = dayString(d);
      const weekday = weekdayOf(date);
      if (weekday === 0) continue;
      // Enough volume per site per day that every console looks like a working practice.
      const perDay = weekday === 6 ? 3 : d === 0 ? 9 : d < 0 ? 7 : 6;
      for (const practiceId of [ctx.practiceA, ctx.practiceB]) for (let i = 0; i < perDay; i++) {
        const siteId = sitesOfPractice[practiceId]![i % 2 === 0 ? 0 : (i % 3 === 0 ? 1 : 0)]!;
        const patientId = pick(r, patientsByPractice[practiceId]!);
        const proc = pickProcedure();
        if (!(roomsBySite[siteId] ?? []).some((x) => x.roomType === proc.modality)) continue;
        const dayStartMins = weekday === 6 ? 8 * 60 : 7 * 60 + 30;
        const span = weekday === 6 ? 4 : 9;
        const startMins = dayStartMins + Math.floor((i / perDay) * span) * 60 + Math.floor(r() * 4) * 15;
        const startsAt = iso(date, hhmm(startMins));
        // An order is always placed before now, even when the appointment is in the future.
        const createdAt = new Date(Math.min(now.getTime() - 3600_000, new Date(startsAt).getTime() - (1 + Math.floor(r() * 10)) * 86400_000)).toISOString();
        const past = d < 0;
        const isToday = d === 0;
        const roll = r();
        const apptStatus = past ? (roll < 0.9 ? 'done' : roll < 0.96 ? 'no_show' : 'cancelled')
          : isToday ? (startMins + 30 < nowMins ? (roll < 0.9 ? 'done' : 'no_show') : startMins - 30 < nowMins ? (roll < 0.75 ? 'arrived' : 'booked') : roll < 0.5 ? 'confirmed' : 'booked')
            : roll < 0.4 ? 'confirmed' : 'booked';
        const orderStatus = apptStatus === 'done' ? 'completed' : apptStatus === 'cancelled' ? 'cancelled' : apptStatus === 'no_show' ? 'cancelled' : apptStatus === 'arrived' ? 'arrived' : 'scheduled';
        const order = await makeOrder({ practiceId, patientId, proc, siteId, createdAt, status: orderStatus });
        const funding = await makeFunding(order, patientId, practiceId, siteId, createdAt);
        const appt = await makeAppointment(order, patientId, practiceId, siteId, startsAt, apptStatus, pick(r, ['whatsapp', 'patient_space', 'desk', 'booking', 'referrer', 'hand']));
        if (!appt) continue;
        if (past && apptStatus === 'done') await makeEncounter(order, appt, patientId, practiceId, siteId, 'done', funding);
        else if (isToday && apptStatus === 'done') await makeEncounter(order, appt, patientId, practiceId, siteId, 'done', funding);
        else if (isToday && apptStatus === 'arrived') await makeEncounter(order, appt, patientId, practiceId, siteId, startMins < nowMins ? 'in_room' : 'arrived', funding);
        else if (d >= 0 && d <= 3) await makeEncounter(order, appt, patientId, practiceId, siteId, 'pre', funding);
        publishedOrders.push({ id: order.id, patientId, practiceId, siteId, procedureCode: proc.code, modality: proc.modality, appointmentId: appt.id, referrerId: order.referrerId, status: orderStatus });
        // reminders for future appointments
        if (d > 0 && (apptStatus === 'booked' || apptStatus === 'confirmed')) {
          for (const [kind, hours] of [['t48', 48], ['t24', 24], ['t3', 3]] as const) {
            const dueAt = new Date(new Date(startsAt).getTime() - hours * 3600_000).toISOString();
            if (dueAt > now.toISOString()) { await db.insert(s.reminders).values({ id: newId('rem'), practiceId, appointmentId: appt.id, patientId, kind, channel: 'whatsapp', dueAt, status: 'scheduled' }); counts.reminders++; }
          }
        }
      }
    }

    /* --- Nomvula Dlamini: the demo patient's own story -------------------- */
    const nomvula = patientMap.get('pat_nomvula');
    if (nomvula) {
      const proc = byCode.get('CT-BRAIN')!;
      const date = dayString(2);
      const startsAt = iso(date, '09:40');
      const order = await makeOrder({ practiceId: ctx.practiceB, patientId: 'pat_nomvula', proc, siteId: ctx.sites.UMH, createdAt: dayString(-1) + 'T11:12:00.000Z', status: 'scheduled', referrerId: 'ref_pillay', channel: 'whatsapp', priority: 'routine' });
      const funding = await makeFunding(order, 'pat_nomvula', ctx.practiceB, ctx.sites.UMH, dayString(-1) + 'T11:14:00.000Z');
      const appt = await makeAppointment(order, 'pat_nomvula', ctx.practiceB, ctx.sites.UMH, startsAt, 'booked', 'whatsapp');
      if (appt) {
        // Nomvula's option carries a co-payment, so the demo shows the money flow end to end.
        const coPay = Math.round(funding.totalCents * 0.2);
        await db.update(s.fundingCases).set({ patientPortionCents: coPay, schemePortionCents: funding.totalCents - coPay, reasonCodes: ['CO_PAYMENT'], benefitCheck: { result: 'co_pay', checkedAt: dayString(-1) + 'T11:14:00.000Z', source: 'sim:funder', reasonCodes: ['CO_PAYMENT'], message: 'Covered with a 20 % co-payment on this option.' } }).where(eq(s.fundingCases.id, funding.caseId));
        await db.update(s.quotes).set({ patientPortionCents: coPay, schemePortionCents: funding.totalCents - coPay, reasonCodes: ['CO_PAYMENT'], assumptions: ['Co-payment of 20 % applies on this option.'] }).where(eq(s.quotes.id, funding.quoteId));
        await makeEncounter(order, appt, 'pat_nomvula', ctx.practiceB, ctx.sites.UMH, 'pre', { ...funding, patientPortionCents: coPay, schemePortionCents: funding.totalCents - coPay, reasonCodes: ['CO_PAYMENT'] });
        publishedOrders.push({ id: order.id, patientId: 'pat_nomvula', practiceId: ctx.practiceB, siteId: ctx.sites.UMH, procedureCode: proc.code, modality: proc.modality, appointmentId: appt.id, referrerId: order.referrerId, status: 'scheduled' });
        const convId = newId('conv');
        const taskId = newId('task');
        await db.insert(s.agentTasks).values({
          id: taskId, practiceId: ctx.practiceB, handId: 'booking', trigger: 'whatsapp.inbound', status: 'done', title: `WhatsApp ${(nomvula.mobile ?? '').replace(/\D/g, '')}`,
          input: { conversationId: convId, text: '1', practiceId: ctx.practiceB },
          output: { state: 'booked', appointmentId: appt.id, orderId: order.id, replies: 1 },
          steps: [
            { at: dayString(-1) + 'T09:11:31.000Z', tool: 'document.extract', risk: 'R0', args: { chars: 96 }, result: { procedureCode: 'CT-BRAIN', confidence: 0.96 }, note: 'rules-based extraction' },
            { at: dayString(-1) + 'T09:11:33.000Z', tool: 'patient.search', risk: 'R0', args: { mobile: '[MOBILE]' }, result: { confidence: 0.95 } },
            { at: dayString(-1) + 'T09:11:40.000Z', tool: 'order.create', risk: 'R1', args: { procedure: 'CT-BRAIN', priority: 'routine' }, result: { id: order.id } },
            { at: dayString(-1) + 'T09:11:52.000Z', tool: 'funding.status_read', risk: 'R0', args: { orderId: order.id }, result: { status: 'quoted' } },
            { at: dayString(-1) + 'T09:12:05.000Z', tool: 'slot.search', risk: 'R0', args: { orderId: order.id }, result: { offers: 3 } },
            { at: dayString(-1) + 'T09:12:10.000Z', tool: 'slot.hold', risk: 'R1', args: { roomId: appt.roomId, startsAt: appt.startsAt }, result: { id: appt.id } },
            { at: dayString(-1) + 'T09:12:20.000Z', tool: 'message.send', risk: 'R2', args: { to: '[MOBILE]', chars: 168 }, result: { ok: true } },
            { at: dayString(-1) + 'T09:13:15.000Z', tool: 'appointment.book', risk: 'R1', args: { appointmentId: appt.id }, result: { status: 'booked' } },
          ],
          leashChecks: [
            { rule: 'maxHoldsPerPatient', limit: 3, actual: 3, ok: true },
            { rule: 'maxMessagesPerDay', limit: 5, actual: 4, ok: true },
          ],
          llmUsed: false, aggregateType: 'conversation', aggregateId: convId, startedAt: dayString(-1) + 'T09:11:30.000Z', finishedAt: dayString(-1) + 'T09:13:16.000Z',
        });
        await db.insert(s.conversations).values({
          id: convId, practiceId: ctx.practiceB, channel: 'whatsapp', mobile: (nomvula.mobile ?? '083 000 0000').replace(/\D/g, ''), patientId: 'pat_nomvula', orderId: order.id, appointmentId: appt.id, state: 'booked', offers: [], optIn: true, lastTaskId: taskId,
          messages: [
            { dir: 'in', text: 'Hi', at: dayString(-1) + 'T09:10:00.000Z', by: 'patient' },
            { dir: 'out', text: 'Sawubona Nomvula, I am the Bonakala booking assistant. May we message you on this number about your scans? Reply STOP at any time.', at: dayString(-1) + 'T09:10:20.000Z', buttons: ['Yes, book a scan', 'My appointments', 'Talk to a person'], by: 'hand:booking' },
            { dir: 'in', text: 'Yes, book a scan', at: dayString(-1) + 'T09:10:40.000Z', by: 'patient' },
            { dir: 'out', text: 'Consent recorded. Send a photo of your referral note, or type the words on it.', at: dayString(-1) + 'T09:10:55.000Z', by: 'hand:booking' },
            { dir: 'in', text: 'Dr R Pillay PR 0223345. CT of the head, no contrast. Headache and confusion after a fall.', at: dayString(-1) + 'T09:11:30.000Z', by: 'patient' },
            { dir: 'out', text: 'I read: CT of the head, no contrast, from Dr Pillay (practice 0223345). Is that right?', at: dayString(-1) + 'T09:11:45.000Z', buttons: ['Yes', 'No, fix it'], by: 'hand:booking' },
            { dir: 'in', text: 'Yebo, kunjalo', at: dayString(-1) + 'T09:11:58.000Z', by: 'patient' },
            { dir: 'out', text: 'Scheme A (demo) pays R2 870. You pay R310, guaranteed for this appointment. Earliest near you: 1) Thu 09:40 Umhlanga  2) Thu 14:10 Ballito  3) Wed 16:20 Umhlanga. Reply 1, 2 or 3.', at: dayString(-1) + 'T09:12:20.000Z', buttons: ['Thu 09:40 Umhlanga', 'Thu 14:10 Ballito', 'Wed 16:20 Umhlanga'], by: 'hand:booking' },
            { dir: 'in', text: '1', at: dayString(-1) + 'T09:13:02.000Z', by: 'patient' },
            { dir: 'out', text: 'Booked: CT brain without contrast, Thu 09:40 Umhlanga. Bring ID, scheme card and the referral. No food for 4 hours before. You pay R310 on the day, nothing more later.', at: dayString(-1) + 'T09:13:15.000Z', buttons: ['Pre-check-in', 'Directions', 'Reschedule'], by: 'hand:booking' },
          ],
        });
      }
    }

    /* --- Waitlist -------------------------------------------------------- */
    for (let i = 0; i < 12; i++) {
      const practiceId = r() < 0.5 ? ctx.practiceA : ctx.practiceB;
      const siteId = pick(r, sitesOfPractice[practiceId]!);
      const patientId = pick(r, patientsByPractice[practiceId]!);
      const proc = pickProcedure();
      const createdAt = new Date(now.getTime() - Math.floor(r() * 12) * 86400_000).toISOString();
      const order = await makeOrder({ practiceId, patientId, proc, siteId, createdAt, status: 'ordered' });
      await makeFunding(order, patientId, practiceId, siteId, createdAt);
      await db.insert(s.waitlist).values({ id: newId('wlt'), practiceId, orderId: order.id, patientId, procedureCode: proc.code, modalityType: proc.modality, siteId, radiusKm: 30, priority: r() < 0.25 ? 'urgent' : 'routine', flexibility: pick(r, ['any', 'mornings', 'afternoons', 'evenings']), status: 'open', createdAt, updatedAt: createdAt });
      counts.waitlist++;
      publishedOrders.push({ id: order.id, patientId, practiceId, siteId, procedureCode: proc.code, modality: proc.modality, appointmentId: null, referrerId: order.referrerId, status: 'ordered' });
    }

    /* --- Referral inbox --------------------------------------------------- */
    let refIdx = 0;
    for (const spec of REFERRAL_TEXTS) {
      const practiceId = refIdx % 2 === 0 ? ctx.practiceB : ctx.practiceA;
      const receivedAt = new Date(now.getTime() - Math.floor(r() * 3 * 86400_000)).toISOString();
      const needsInfo = spec.text.length < 60;
      const patientId = needsInfo ? null : pick(r, patientsByPractice[practiceId]!);
      await db.insert(s.referrals).values({
        id: newId('rfl'), practiceId, channel: spec.channel, sourceName: needsInfo ? 'Unknown sender' : 'Referring practice', sourceContact: spec.channel === 'whatsapp' ? `08${Math.floor(r() * 3) + 1}${String(Math.floor(r() * 9000000) + 1000000)}` : null,
        rawText: spec.channel === 'paper_photo' ? null : spec.text, photoText: spec.channel === 'paper_photo' ? spec.text : null, artefactHash: String(luhnCheckDigit(String(refIdx + 1000))).padStart(1, '0') + newId().slice(0, 12),
        patientId, referrerId: null, parsed: null, confidence: needsInfo ? 42 : 60 + Math.floor(r() * 35), status: needsInfo ? 'needs_info' : 'received', needsInfo: needsInfo ? ['patient', 'procedure'] : null, receivedAt, createdAt: receivedAt, updatedAt: receivedAt,
      });
      refIdx++;
    }

    /* --- Booking Hand conversations in the inbox -------------------------- */
    const convSpecs = [
      { mobile: '0821234567', state: 'handed_over', reason: 'clinical_question', messages: [['in', 'My doctor gave me this for my knee. Can I book after 4pm? I cannot take leave.'], ['out', 'I can look for evening times. Send a photo of the referral, or type the words on it.'], ['in', 'Is the pain in my knee serious?'], ['out', 'I cannot answer questions about your health. A person from our team will help you, and your doctor discusses findings with you.']] },
      { mobile: '0739876543', state: 'awaiting_slot_choice', reason: null, messages: [['in', 'MRI lumbar spine please, Dr Naidoo referred me'], ['out', 'Scheme B (demo) requires authorisation for MRI; we have asked. Earliest near you: 1) Thu 17:20 Umhlanga  2) Fri 16:40 Ballito  3) Mon 07:20 Umhlanga. Reply 1, 2 or 3.']] },
      { mobile: '0845550011', state: 'handed_over', reason: 'requested_person', messages: [['in', 'I need to change my appointment, can someone call me'], ['out', 'Of course. A person from our booking team will pick up this conversation shortly.']] },
      { mobile: '0798887766', state: 'awaiting_referral', reason: null, messages: [['in', 'Hi I need a scan'], ['out', 'Sawubona. Send a photo of your referral note, or type the words on it, and I will find you a time.']] },
    ] as const;
    for (const spec of convSpecs) {
      const at = new Date(now.getTime() - Math.floor(r() * 4 * 3600_000)).toISOString();
      await db.insert(s.conversations).values({
        id: newId('conv'), practiceId: ctx.practiceB, channel: 'whatsapp', mobile: spec.mobile, patientId: null, state: spec.state, handedOverReason: spec.reason, optIn: true, offers: [],
        messages: spec.messages.map(([dir, text], i) => ({ dir: dir as 'in' | 'out', text, at: new Date(new Date(at).getTime() + i * 60_000).toISOString(), by: dir === 'in' ? 'patient' : 'hand:booking' })),
        createdAt: at, updatedAt: at,
      });
    }

    return {
      procedures: PROCEDURES.length, funders: funderDefs.length, slotTemplates: (await db.select({ id: s.slotTemplates.id }).from(s.slotTemplates)).length,
      ...counts, referrals: REFERRAL_TEXTS.length, conversations: convSpecs.length + 1,
      ...(await publish(db, ctx, publishedOrders)),
    };
  }

  // Already seeded: republish handles for later clusters.
  const rows = await db.select().from(s.orders);
  return publish(db, ctx, rows.map((o) => ({ id: o.id, patientId: o.patientId, practiceId: o.practiceId, siteId: o.siteId, procedureCode: o.procedures[0]?.code ?? '', modality: o.procedures[0]?.modality ?? '', appointmentId: o.appointmentId, referrerId: o.referrerId, status: o.status })));
}

/**
 * Cross-cluster handles. Later clusters key off the shared M14 tariff codes, so every published order
 * carries both this module's catalogue code and the tariff code, under both `id` and `orderId`.
 */
async function publish(_db: Db, ctx: SeedContext, orders: Array<{ id: string; patientId: string; practiceId: string; siteId: string | null; procedureCode: string; modality: string; appointmentId: string | null; referrerId: string | null; status: string }>) {
  const byCode = new Map(PROCEDURES.map((p) => [p.code, p]));
  const dicom = (m: string) => (m === 'XR' ? 'DX' : m);
  ctx.extra['orders'] = orders.map((o) => {
    const proc = byCode.get(o.procedureCode);
    const tariffCode = proc && /^\d/.test(proc.tariffCode) ? proc.tariffCode : null;
    return {
      ...o, orderId: o.id, tariffCode, modality: dicom(o.modality),
      procedures: tariffCode ? [{ code: tariffCode, description: proc!.description, modality: dicom(proc!.modality), bodyPart: proc!.bodyPart, contrast: proc!.contrast === 'required' }] : [],
    };
  });
  // Only procedures with a shared tariff code are published: later clusters price and protocol from them.
  ctx.extra['procedures'] = PROCEDURES.filter((p) => /^\d/.test(p.tariffCode)).map((p) => ({ code: p.tariffCode, catalogueCode: p.code, description: p.description, modality: dicom(p.modality), bodyPart: p.bodyPart, durationMin: p.durationMin, contrast: p.contrast === 'required', ionising: p.ionising }));
  return { publishedOrders: orders.length };
}
