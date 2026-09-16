/**
 * M14 Revenue Cycle (Billing): charge capture, coding exceptions, claims, remittances, patient
 * accounts, payments, plans, disputes, collections, write-offs, handover and month-end.
 * Emits claim.submitted.v1, claim.responded.v1, patient.liability.v1, payment.received.v1 and the
 * charge/coding/remittance/collections families (docs/processes/09 §17).
 */
import { z } from 'zod';
import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, conflict } from '@bonakala/domain';
import {
  buildPlan, buildSchedule, classifyFunderCode, daysBetween, handoverChecklist, propensityToPay, rulePackInForce, writeOffApprover, BASE_RATE_CENTS, DEFAULT_DUNNING_POLICY, PROCEDURE_CODES, REJECTION_TAXONOMY, RULE_PACKS, TARIFF_CODES, TARIFF_BY_CODE,
} from '@bonakala/domain/billing';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { runHand } from '../../kernel/hands.js';
import { registerSim } from '../../sim/index.js';
import { registerBillingHands, onReportSigned } from './hands.js';
import {
  ageingForPractice, assembleClaim, chargeContext, claimsInFlight, createPaymentLink, ensureAccount, FUNDER_NAMES, matchRemittance, nowIso, openWaves, postTransaction, priceForCharge, recordPayment,
  repriceCharge, scoreAccount, scrubCharge, shortPaymentReasonText, timelineFor, today, transferPatientLiability, unbilledRegister, loadSchedules, applyClaimResponse,
} from './service.js';
import { switchRoutes, switchState, submitToSwitch } from '../../sim/switch.js';
import { pspRoutes } from '../../sim/psp.js';
import { bankRoutes } from '../../sim/bank.js';

const r = router();
const BILLING = ['BIL', 'PRM', 'EXE', 'SUP'] as const;
const MONEY = ['BIL', 'DEB', 'PRM', 'EXE', 'SUP'] as const;
const DESK = ['FDK', 'BIL', 'DEB', 'PRM', 'EXE', 'SUP'] as const;

/* ============================ Reference data ============================ */

r.get('/tariffs', allow(...MONEY, 'FDK'), (c) => c.json({ tariffs: TARIFF_CODES, baseRates: BASE_RATE_CENTS, procedureCodes: PROCEDURE_CODES }));
r.get('/rule-packs', allow(...MONEY, 'CMP', 'AIO', 'PAY'), (c) => c.json({ rulePacks: RULE_PACKS, taxonomy: REJECTION_TAXONOMY }));

/* ============================ Tiles and console ============================ */

r.get('/tiles', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const charges = await db.select().from(schema.charges).where(eq(schema.charges.practiceId, practiceId));
  const claims = await db.select().from(schema.claims).where(eq(schema.claims.practiceId, practiceId));
  const unbilled = charges.filter((x) => ['unbilled', 'coded'].includes(x.status));
  const ready = claims.filter((x) => x.status === 'scrubbed');
  const flight = claims.filter((x) => ['submitted', 'accepted', 'pended'].includes(x.status));
  const rejected = claims.filter((x) => x.status === 'rejected');
  const held = claims.filter((x) => x.status === 'held');
  const responded = claims.filter((x) => x.respondedAt);
  const firstPass = responded.length ? responded.filter((x) => ['accepted', 'paid', 'remitted'].includes(x.status)).length / responded.length : 1;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const recent = responded.filter((x) => (x.respondedAt ?? '') >= since);
  const firstPass7 = recent.length >= 10 ? recent.filter((x) => ['accepted', 'paid', 'remitted'].includes(x.status)).length / recent.length : firstPass;
  const t = today();
  const oldest = unbilled.reduce((m, x) => Math.max(m, daysBetween(x.serviceDate, t)), 0);
  const signedYesterday = charges.filter((x) => daysBetween(x.serviceDate, t) <= 1).length;
  const byFunderRejections: Record<string, number> = {};
  for (const x of rejected) byFunderRejections[x.funderId] = (byFunderRejections[x.funderId] ?? 0) + 1;
  const topFunder = Object.entries(byFunderRejections).sort((a, b) => b[1] - a[1])[0];
  const waves = await openWaves(db, practiceId);
  const remittances = await db.select().from(schema.remittances).where(and(eq(schema.remittances.practiceId, practiceId), inArray(schema.remittances.status, ['received', 'partially_matched'])));
  return c.json({
    tiles: {
      unbilled: { count: unbilled.length, valueCents: unbilled.reduce((a, x) => a + x.totalCents, 0), oldestDays: oldest },
      ready: { count: ready.length, valueCents: ready.reduce((a, x) => a + x.totalCents, 0) },
      inFlight: { count: flight.length, valueCents: flight.reduce((a, x) => a + x.expectedFunderCents - x.paidCents, 0), realtimeFunders: [...new Set(flight.filter((x) => x.channel === 'realtime').map((x) => x.funderId))].length },
      rejected: { count: rejected.length, valueCents: rejected.reduce((a, x) => a + x.totalCents, 0), topFunder: topFunder ? { funderId: topFunder[0], name: FUNDER_NAMES[topFunder[0]] ?? topFunder[0], sharePct: Math.round((topFunder[1] / Math.max(1, rejected.length)) * 100) } : null },
      held: { count: held.length, valueCents: held.reduce((a, x) => a + x.totalCents, 0) },
      firstPass: { pct: Math.round(firstPass * 1000) / 10, pct7d: Math.round(firstPass7 * 1000) / 10 },
      remittancesOpen: remittances.length,
      signedYesterday,
    },
    waves,
  });
});

/** Exception queue: charges in coding exception + claims in rejection/held exception. */
r.get('/exceptions', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const { family, limit } = query(c, z.object({ family: z.string().optional(), limit: z.coerce.number().min(1).max(200).default(60) }));
  const db = c.get('services').db;
  const charges = await db.select().from(schema.charges).where(and(eq(schema.charges.practiceId, practiceId), eq(schema.charges.status, 'coded')));
  const claims = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), inArray(schema.claims.status, ['rejected', 'held', 'pended'])));
  const patients = await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, schemeName: schema.patients.schemeName }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId));
  const byId = new Map(patients.map((p) => [p.id, p]));
  const now = Date.now();
  const rows = [
    ...claims.filter((x) => x.exception).map((x) => ({
      id: x.id, kind: 'claim' as const, ref: x.claimRef, patientId: x.patientId, patient: nameOf(byId.get(x.patientId)), funderId: x.funderId, funder: FUNDER_NAMES[x.funderId] ?? x.funderId,
      procedure: procedureText(x.lines), family: x.exception!.family, reason: x.exception!.reason, code: x.exception!.code, suggestion: x.exception!.suggestion, provenance: x.exception!.provenance ?? null,
      level: x.exception!.level, path: x.exception!.path, ageHours: Math.round((now - new Date(x.exception!.openedAt).getTime()) / 3600_000), totalCents: x.totalCents, status: x.status, staleDate: x.staleDate, escalatedTo: x.exception!.escalatedTo ?? null,
    })),
    ...charges.filter((x) => x.exception).map((x) => ({
      id: x.id, kind: 'charge' as const, ref: x.accession ?? `CHG-${x.id.slice(-6)}`, patientId: x.patientId, patient: nameOf(byId.get(x.patientId)), funderId: x.funderId, funder: FUNDER_NAMES[x.funderId] ?? x.funderId,
      procedure: procedureText(x.lines), family: x.exception!.family, reason: x.exception!.reason, code: x.exception!.code, suggestion: x.exception!.suggestion, provenance: x.coding ?? null,
      level: 'A1', path: 'recode', ageHours: Math.round((now - new Date(x.exception!.openedAt).getTime()) / 3600_000), totalCents: x.totalCents, status: x.status, staleDate: null, escalatedTo: x.exception!.escalatedTo ?? null,
    })),
  ];
  const filtered = family ? rows.filter((x) => x.family === family) : rows;
  const families: Record<string, number> = {};
  for (const x of rows) families[x.family] = (families[x.family] ?? 0) + 1;
  return c.json({ exceptions: filtered.sort((a, b) => b.ageHours - a.ageHours).slice(0, limit), total: rows.length, families });
});
function nameOf(p?: { firstName: string; lastName: string }) { return p ? `${p.lastName}, ${p.firstName}` : 'Unknown'; }
function procedureText(lines: unknown) {
  const codes = (lines as Array<{ code: string }>).map((l) => l.code).filter((cd) => TARIFF_BY_CODE[cd]?.kind === 'procedure');
  return codes.map((cd) => TARIFF_BY_CODE[cd]?.description ?? cd).join(' + ') || '—';
}

/** Rejections by reason for the last 14 days (console chart). */
r.get('/rejections', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const rows = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), eq(schema.claims.status, 'rejected'), gte(schema.claims.respondedAt, since)));
  const byReason: Record<string, { count: number; label: string; funders: Record<string, number> }> = {};
  for (const x of rows) {
    const code = x.rejectionCode ?? 'TECHNICAL';
    const e = (byReason[code] ??= { count: 0, label: REJECTION_TAXONOMY[code as keyof typeof REJECTION_TAXONOMY]?.label ?? code, funders: {} });
    e.count++; e.funders[x.funderId] = (e.funders[x.funderId] ?? 0) + 1;
  }
  const stale = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), inArray(schema.claims.status, ['rejected', 'held', 'scrubbed'])));
  const t = today();
  const deadlines = stale.filter((x) => x.staleDate).map((x) => ({ claimRef: x.claimRef, id: x.id, staleDate: x.staleDate!, daysLeft: daysBetween(t, x.staleDate!), totalCents: x.totalCents })).sort((a, b) => a.daysLeft - b.daysLeft);
  return c.json({ byReason, total: rows.length, deadlines: deadlines.slice(0, 20), soonest: deadlines[0] ?? null, within30: deadlines.filter((d) => d.daysLeft <= 30).length });
});

/* ============================ Coding ============================ */

r.get('/coding', allow(...BILLING), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.charges).where(and(eq(schema.charges.practiceId, practiceId), inArray(schema.charges.status, ['unbilled', 'coded'])));
  const patients = await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId));
  const byId = new Map(patients.map((p) => [p.id, p]));
  return c.json({ charges: rows.map((x) => ({ ...x, patient: nameOf(byId.get(x.patientId)), funder: FUNDER_NAMES[x.funderId] ?? x.funderId, ageDays: daysBetween(x.serviceDate, today()) })).sort((a, b) => b.ageDays - a.ageDays) });
});

r.get('/charges/:id', allow(...MONEY), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, id)).limit(1);
  if (!charge) throw notFound('Charge');
  const ctx = await chargeContext(db, charge);
  const scrubbed = ctx ? await scrubCharge(db, charge, ctx) : null;
  const [claim] = charge.claimId ? await db.select().from(schema.claims).where(eq(schema.claims.id, charge.claimId)).limit(1) : [];
  const timeline = await timelineFor(db, [charge.id, ...(claim ? [claim.id] : [])]);
  return c.json({
    charge, claim: claim ?? null, patient: ctx ? { id: ctx.patient.id, name: `${ctx.patient.lastName}, ${ctx.patient.firstName}`, sex: ctx.patient.sex, dateOfBirth: ctx.patient.dateOfBirth, schemeName: ctx.patient.schemeName, schemeOption: ctx.patient.schemeOption, memberNo: ctx.patient.memberNo } : null,
    referrer: ctx?.referrer ?? null, site: ctx?.site ?? null, radiologist: ctx?.radiologist ? { name: ctx.radiologist.name, hpcsaNo: ctx.radiologist.hpcsaNo } : null,
    scrub: scrubbed?.scrub ?? null, rulePack: scrubbed?.pack ? { id: scrubbed.pack.id, version: scrubbed.pack.version, notes: scrubbed.pack.notes } : null, timeline,
  });
});

/** Accept the Coding Hand's proposal (or an edited version) and assemble the claim. */
r.post('/charges/:id/accept', allow(...BILLING), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const id = param(c, 'id');
  const data = await body(c, z.object({ procedureCodes: z.array(z.string()).optional(), icd10: z.array(z.string()).optional(), authRef: z.string().nullable().optional(), memberNo: z.string().nullable().optional(), referrerId: z.string().nullable().optional(), note: z.string().optional() }));
  let [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, id)).limit(1);
  if (!charge) throw notFound('Charge');
  if (charge.status === 'claimed' || charge.status === 'paid') throw conflict('Charge is already claimed');
  const edited = !!(data.procedureCodes || data.icd10 || data.authRef !== undefined || data.memberNo !== undefined || data.referrerId !== undefined);
  if (edited) charge = await repriceCharge(db, charge, data);
  const ctx = await chargeContext(db, charge);
  if (!ctx) throw notFound('Patient');
  const { scrub, fields } = await scrubCharge(db, charge, ctx);
  const user = c.get('user')!;
  const coding = charge.coding ? { ...charge.coding, status: (edited ? 'edited' : 'accepted') as 'edited' | 'accepted', acceptedBy: user.id, acceptedAt: nowIso() } : null;
  await db.update(schema.charges).set({ coding, exception: null, blockingReason: null, owner: null, updatedAt: nowIso() }).where(eq(schema.charges.id, charge.id));
  const [fresh] = await db.select().from(schema.charges).where(eq(schema.charges.id, charge.id)).limit(1);
  await audit(c, edited ? 'billing.coding_edited' : 'billing.coding_accepted', { type: 'charge', id: charge.id }, { procedureCodes: fresh!.procedureCodes, icd10: fresh!.icd10, note: data.note, scrubPass: scrub.pass });
  await emit(c, edited ? 'coding.edited.v1' : 'coding.accepted.v1', { chargeId: charge.id, practiceId: charge.practiceId, acceptedBy: user.id, auto: false }, { aggregateType: 'charge', aggregateId: charge.id, practiceId: charge.practiceId });
  if (!scrub.pass) {
    await db.update(schema.charges).set({ status: 'coded', exception: { family: 'Funder rule', reason: scrub.findings.find((f) => f.severity === 'error')!.message, code: scrub.findings.find((f) => f.severity === 'error')!.code, suggestion: 'Fix the blocking rule before the claim can be assembled', openedAt: nowIso() }, blockingReason: 'scrub_error', owner: 'BIL' }).where(eq(schema.charges.id, charge.id));
    return c.json({ ok: false, scrub }, 200);
  }
  const claim = await assembleClaim(services, fresh!, ctx, scrub, fields, user.id);
  return c.json({ ok: true, claimId: claim.id, claimRef: claim.claimRef, scrub });
});

r.post('/charges/:id/escalate', allow(...MONEY), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { to, reason } = await body(c, z.object({ to: z.string().default('PRM'), reason: z.string().min(3) }));
  const [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, id)).limit(1);
  if (!charge) throw notFound('Charge');
  await db.update(schema.charges).set({ exception: { ...(charge.exception ?? { family: 'Other', reason, code: 'ESCALATED', suggestion: '', openedAt: nowIso() }), escalatedTo: to }, owner: to, updatedAt: nowIso() }).where(eq(schema.charges.id, id));
  await audit(c, 'billing.exception_escalated', { type: 'charge', id }, { to, reason });
  return c.json({ ok: true });
});

/* ============================ Claims ============================ */

r.get('/claims', allow(...MONEY, 'PAY'), async (c) => {
  const user = c.get('user')!;
  // A funder is not a tenant: PAY sees its own claims across every practice it contracts with.
  const practiceId = user.persona === 'PAY' ? c.get('practiceId') : requirePractice(c);
  const { status, funderId, q, limit } = query(c, z.object({ status: z.string().optional(), funderId: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200) }));
  const db = c.get('services').db;
  const where = [];
  if (practiceId) where.push(eq(schema.claims.practiceId, practiceId));
  if (status) where.push(inArray(schema.claims.status, status.split(',')));
  if (funderId && user.persona !== 'PAY') where.push(eq(schema.claims.funderId, funderId));
  if (user.persona === 'PAY') where.push(eq(schema.claims.funderId, funderForPayUser(user.email)));
  if (q) where.push(or(like(schema.claims.claimRef, `%${q}%`), like(schema.claims.memberNo, `%${q}%`))!);
  const rows = await db.select().from(schema.claims).where(and(...where)).orderBy(desc(schema.claims.createdAt)).limit(limit);
  const patients = practiceId
    ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId))
    : [];
  const byId = new Map(patients.map((p) => [p.id, p]));
  const t = today();
  return c.json({
    claims: rows.map((x) => ({
      id: x.id, claimRef: x.claimRef, patientId: x.patientId, patient: user.persona === 'PAY' ? `Member ${x.memberNo ?? '—'}` : nameOf(byId.get(x.patientId)), funderId: x.funderId, funder: FUNDER_NAMES[x.funderId] ?? x.funderId,
      procedure: procedureText(x.lines), icd10: x.icd10, totalCents: x.totalCents, expectedFunderCents: x.expectedFunderCents, paidCents: x.paidCents, status: x.status, channel: x.channel, switchRef: x.switchRef,
      submittedAt: x.submittedAt, respondedAt: x.respondedAt, serviceDate: x.serviceDate, staleDate: x.staleDate, daysToStale: x.staleDate ? daysBetween(t, x.staleDate) : null, rejectionCode: x.rejectionCode, rejectionReason: x.rejectionReason,
      exception: x.exception, resubmitCount: x.resubmitCount, pmb: x.pmb,
    })),
    total: rows.length,
  });
});
function funderForPayUser(email: string) {
  return email.startsWith('pay') ? 'scheme-a' : 'scheme-a';
}

r.get('/claims/:id', allow(...MONEY, 'PAY'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  if (!claim) throw notFound('Claim');
  const user = c.get('user')!;
  if (user.persona === 'PAY' && claim.funderId !== funderForPayUser(user.email)) return c.json({ error: 'forbidden' }, 403);
  const [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, claim.chargeId)).limit(1);
  const responses = await db.select().from(schema.claimResponses).where(eq(schema.claimResponses.claimId, id)).orderBy(schema.claimResponses.receivedAt);
  const ctx = charge ? await chargeContext(db, charge) : null;
  const timeline = await timelineFor(db, [claim.id, claim.chargeId]);
  const pack = rulePackInForce(claim.funderId, claim.serviceDate);
  const account = await db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.patientId, claim.patientId), eq(schema.patientAccounts.practiceId, claim.practiceId))).limit(1);
  return c.json({
    claim, charge: charge ?? null, responses, timeline, rulePack: { id: pack.id, version: pack.version, notes: pack.notes, staleClaimDays: pack.staleClaimDays },
    patient: ctx && user.persona !== 'PAY' ? { id: ctx.patient.id, name: `${ctx.patient.lastName}, ${ctx.patient.firstName}`, sex: ctx.patient.sex, dateOfBirth: ctx.patient.dateOfBirth, schemeName: ctx.patient.schemeName, schemeOption: ctx.patient.schemeOption, memberNo: ctx.patient.memberNo, idMasked: ctx.patient.idNumber ? `····${ctx.patient.idNumber.slice(-4)}` : null } : null,
    site: ctx?.site ?? null, radiologist: ctx?.radiologist ? { name: ctx.radiologist.name, hpcsaNo: ctx.radiologist.hpcsaNo } : null, accountBalanceCents: account[0]?.balanceCents ?? 0,
  });
});

/** Submit a batch (Claims Hand) or specific claims. */
r.post('/claims/submit', allow(...BILLING), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const { claimIds } = await body(c, z.object({ claimIds: z.array(z.string()).optional() }));
  const task = await runHand(services, 'claims', { claimIds, practiceId }, { practiceId, trigger: 'manual', title: claimIds?.length ? `Submit ${claimIds.length} claims` : 'Submit batch' });
  await audit(c, 'billing.claims_submitted', { type: 'agent_task', id: task.id }, { claimIds: claimIds?.length ?? 'batch', status: task.status });
  return c.json({ task });
});

/** Resubmit one claim after a fix (attach auth, recode, correct referrer). */
r.post('/claims/:id/resubmit', allow(...BILLING), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const id = param(c, 'id');
  const data = await body(c, z.object({ authRef: z.string().optional(), icd10: z.array(z.string()).optional(), procedureCodes: z.array(z.string()).optional(), memberNo: z.string().optional(), note: z.string().optional() }));
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  if (!claim) throw notFound('Claim');
  if (!['rejected', 'held', 'pended'].includes(claim.status)) throw conflict(`A ${claim.status} claim cannot be resubmitted`);
  let [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, claim.chargeId)).limit(1);
  if (!charge) throw notFound('Charge');
  charge = await repriceCharge(db, charge, { procedureCodes: data.procedureCodes, icd10: data.icd10, authRef: data.authRef ?? charge.authRef, memberNo: data.memberNo ?? charge.memberNo });
  const ctx = await chargeContext(db, charge);
  if (!ctx) throw notFound('Patient');
  const { scrub, fields } = await scrubCharge(db, charge, ctx);
  if (!scrub.pass) return c.json({ ok: false, scrub, message: 'The claim still fails the scrubber' }, 200);
  const user = c.get('user')!;
  await db.update(schema.claims).set({ fields, memberNo: fields.memberNo ?? claim.memberNo, dependantCode: fields.dependantCode ?? claim.dependantCode, icd10: charge.icd10, lines: charge.lines, totalCents: charge.totalCents, expectedFunderCents: charge.expectedFunderCents, expectedPatientCents: charge.expectedPatientCents, status: 'scrubbed', scrub: scrub as unknown as Record<string, unknown>, rulePackVersion: scrub.rulePackVersion, resubmitCount: claim.resubmitCount + 1, exception: null, updatedAt: nowIso() }).where(eq(schema.claims.id, id));
  await audit(c, 'billing.claim_resubmitted', { type: 'claim', id }, { authRef: data.authRef, icd10: data.icd10, note: data.note, attempt: claim.resubmitCount + 1 });
  await emit(c, 'claim.resubmitted.v1', { claimId: id, claimRef: claim.claimRef, practiceId: claim.practiceId, attempt: claim.resubmitCount + 1 }, { aggregateType: 'claim', aggregateId: id, practiceId: claim.practiceId });
  const [fresh] = await db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  try {
    const { ack, adjudication } = submitToSwitch(fresh!);
    const { markSubmitted } = await import('./service.js');
    await markSubmitted(services, fresh!, ack, user.id);
    if (adjudication) {
      const after = await applyClaimResponse(services, id, adjudication);
      return c.json({ ok: true, status: after.status, claim: after });
    }
    return c.json({ ok: true, status: 'submitted' });
  } catch (e) {
    return c.json({ ok: false, message: (e as Error).message }, 200);
  }
});

/** Reverse a claim (withdrawal while unpaid) — the reversibility leg of the Class 2 gate. */
r.post('/claims/:id/reverse', allow(...BILLING), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { reason } = await body(c, z.object({ reason: z.string().min(3) }));
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
  if (!claim) throw notFound('Claim');
  if (claim.paidCents > 0) throw conflict('A paid claim is corrected with a credit note, not a reversal');
  await db.update(schema.claims).set({ status: 'reversed', updatedAt: nowIso() }).where(eq(schema.claims.id, id));
  await db.update(schema.charges).set({ status: 'coded', claimId: null, blockingReason: 'reversed', owner: 'BIL', updatedAt: nowIso() }).where(eq(schema.charges.id, claim.chargeId));
  await audit(c, 'billing.claim_reversed', { type: 'claim', id }, { reason });
  await emit(c, 'claim.reversed.v1', { claimId: id, practiceId: claim.practiceId, reason }, { aggregateType: 'claim', aggregateId: id, practiceId: claim.practiceId });
  return c.json({ ok: true });
});

/* ============================ Rejection waves ============================ */

r.get('/waves', allow(...MONEY), async (c) => c.json({ waves: await openWaves(c.get('services').db, requirePractice(c)) }));

r.post('/waves/:id/resolve', allow(...BILLING), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { rulePackVersion, note } = await body(c, z.object({ rulePackVersion: z.string().optional(), note: z.string().min(3) }));
  await db.update(schema.rejectionWaves).set({ status: 'resolved', resolvedAt: nowIso(), rulePackVersion: rulePackVersion ?? undefined }).where(eq(schema.rejectionWaves.id, id));
  await audit(c, 'billing.wave_resolved', { type: 'rejection_wave', id }, { rulePackVersion, note });
  await emit(c, 'rules.pack.changed.v1', { waveId: id, rulePackVersion, note }, { aggregateType: 'rejection_wave', aggregateId: id });
  return c.json({ ok: true });
});

/* ============================ Remittances ============================ */

r.get('/remittances', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.remittances).where(eq(schema.remittances.practiceId, practiceId)).orderBy(desc(schema.remittances.receivedAt)).limit(100);
  const unallocated = rows.flatMap((x) => x.lines.filter((l) => l.status === 'unmatched').map((l) => ({ remittanceId: x.id, reference: x.reference, funderId: x.funderId, ...l })));
  const shortPaid = rows.flatMap((x) => x.lines.filter((l) => l.status === 'short_paid' || l.status === 'paid_to_member').map((l) => ({ remittanceId: x.id, reference: x.reference, funderId: x.funderId, ...l })));
  return c.json({
    remittances: rows.map((x) => ({ ...x, lineCount: x.lines.length, matchedLines: x.lines.filter((l) => l.status === 'matched').length })),
    unallocated, shortPaid, unallocatedCents: unallocated.reduce((a, l) => a + l.paidCents, 0),
    autoMatchPct: rows.length ? Math.round((rows.flatMap((x) => x.lines).filter((l) => l.status === 'matched' || l.status === 'short_paid').length / Math.max(1, rows.flatMap((x) => x.lines).length)) * 1000) / 10 : 100,
  });
});

r.post('/remittances/:id/match', allow(...MONEY), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const task = await runHand(services, 'remittance', { remittanceId: id }, { practiceId: requirePractice(c), trigger: 'manual', title: `Match remittance ${id}`, aggregateType: 'remittance', aggregateId: id });
  await audit(c, 'billing.remittance_matched', { type: 'remittance', id }, { status: task.status });
  return c.json({ task });
});

/** Manual match of one unallocated line to a claim. */
r.post('/remittances/:id/allocate', allow(...MONEY), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const id = param(c, 'id');
  const { claimRef, claimId, paidToMember } = await body(c, z.object({ claimRef: z.string(), claimId: z.string().optional(), paidToMember: z.boolean().default(false) }));
  const [rem] = await db.select().from(schema.remittances).where(eq(schema.remittances.id, id)).limit(1);
  if (!rem) throw notFound('Remittance');
  const line = rem.lines.find((l) => l.claimRef === claimRef && l.status === 'unmatched');
  if (!line) throw invalid('No unmatched line with that reference');
  if (claimId) line.claimId = claimId;
  if (paidToMember) line.status = 'paid_to_member';
  await db.update(schema.remittances).set({ lines: rem.lines }).where(eq(schema.remittances.id, id));
  const task = await runHand(services, 'remittance', { remittanceId: id }, { practiceId: rem.practiceId, trigger: 'manual.allocate', title: `Allocate ${claimRef}`, aggregateType: 'remittance', aggregateId: id });
  await audit(c, 'billing.remittance_allocated', { type: 'remittance', id }, { claimRef, paidToMember });
  return c.json({ task });
});

/* ============================ Fee schedules (versioned CRUD) ============================ */

r.get('/fee-schedules', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const schedules = await loadSchedules(c.get('services').db, practiceId);
  return c.json({ schedules: schedules.sort((a, b) => a.funderId.localeCompare(b.funderId) || b.version - a.version) });
});

r.post('/fee-schedules', allow('BIL', 'PRM', 'EXE', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const data = await body(c, z.object({ funderId: z.string(), name: z.string().min(2), kind: z.enum(['scheme_rate', 'negotiated', 'cash', 'raf', 'coida', 'corporate']), upliftPct: z.number().int().min(-50).max(300), effectiveFrom: z.string(), overrides: z.record(z.number().int()).optional(), reason: z.string().min(3) }));
  const existing = await db.select().from(schema.feeSchedules).where(and(eq(schema.feeSchedules.practiceId, practiceId), eq(schema.feeSchedules.funderId, data.funderId)));
  const version = Math.max(0, ...existing.map((x) => x.version)) + 1;
  const id = newId('fs');
  const user = c.get('user')!;
  await db.insert(schema.feeSchedules).values({ id, practiceId, funderId: data.funderId, funderType: data.funderId.startsWith('scheme') ? 'scheme' : data.funderId === 'cash' ? 'cash' : data.funderId as 'raf', name: data.name, kind: data.kind, version, effectiveFrom: data.effectiveFrom, upliftPct: data.upliftPct, status: 'active', approvedBy: user.id, approvedAt: nowIso(), notes: data.reason });
  const built = buildSchedule({ id, practiceId, funderId: data.funderId, funderType: 'scheme', name: data.name, kind: data.kind, version, effectiveFrom: data.effectiveFrom, upliftPct: data.upliftPct, overrides: data.overrides });
  for (const l of built.lines) await db.insert(schema.feeScheduleLines).values({ id: newId('fsl'), practiceId, scheduleId: id, code: l.code, description: TARIFF_BY_CODE[l.code]?.description ?? null, priceExclCents: l.priceExclCents, unit: l.unit });
  // supersede the previous active version for the same funder
  for (const x of existing.filter((e) => e.status === 'active')) await db.update(schema.feeSchedules).set({ status: 'superseded', effectiveTo: data.effectiveFrom, updatedAt: nowIso() }).where(eq(schema.feeSchedules.id, x.id));
  await audit(c, 'billing.fee_schedule_created', { type: 'fee_schedule', id }, { funderId: data.funderId, version, upliftPct: data.upliftPct, reason: data.reason });
  await emit(c, 'feeschedule.version.created.v1', { scheduleId: id, practiceId, funderId: data.funderId, version }, { aggregateType: 'fee_schedule', aggregateId: id, practiceId });
  return c.json({ id, version }, 201);
});

/* ============================ Month-end ============================ */

r.get('/month-end', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const { period } = query(c, z.object({ period: z.string().optional() }));
  const p = period ?? today().slice(0, 7);
  const db = c.get('services').db;
  const register = await unbilledRegister(db, practiceId, undefined);
  const flight = await claimsInFlight(db, practiceId);
  const { matrix, provision } = await ageingForPractice(db, practiceId);
  const [existing] = await db.select().from(schema.billingPeriods).where(and(eq(schema.billingPeriods.practiceId, practiceId), eq(schema.billingPeriods.period, p))).limit(1);
  const charges = await db.select().from(schema.charges).where(eq(schema.charges.practiceId, practiceId));
  const inPeriod = charges.filter((x) => x.serviceDate.startsWith(p));
  const reports = inPeriod.filter((x) => x.reportId).length;
  const checklist = existing?.checklist ?? [
    { id: 'unbilled', label: 'Unbilled register reviewed and owners assigned', done: register.olderThan30 === 0, owner: 'BIL' },
    { id: 'inflight', label: 'Claims-in-flight accrual agreed by funder', done: flight.count > 0, owner: 'BIL' },
    { id: 'remittances', label: 'Remittances matched and banked', done: false, owner: 'DEB' },
    { id: 'provision', label: 'ECL provision computed from the matrix', done: provision.totalProvisionCents >= 0, owner: 'DEB' },
    { id: 'readingfees', label: 'Reading-fee statements approved', done: false, owner: 'PRM' },
    { id: 'journals', label: 'Revenue journals reconciled to the debtor sub-ledgers', done: false, owner: 'BIL' },
  ];
  return c.json({
    period: p, register, inFlight: flight, ageing: matrix, provision, checklist, status: existing?.status ?? 'open', signedBy: existing?.signedBy ?? null, signedAt: existing?.signedAt ?? null,
    performed: inPeriod.length, claimed: inPeriod.filter((x) => ['claimed', 'paid', 'partially_paid'].includes(x.status)).length, signedReports: reports,
    revenueCents: inPeriod.reduce((a, x) => a + x.subtotalExclCents, 0), vatCents: inPeriod.reduce((a, x) => a + x.vatCents, 0),
  });
});

r.post('/month-end/sign', allow('BIL', 'PRM', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const { period, confirm: typedConfirm, checklist } = await body(c, z.object({ period: z.string(), confirm: z.literal('Confirm'), checklist: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean(), owner: z.string(), note: z.string().optional() })).optional() }));
  const register = await unbilledRegister(db, practiceId, undefined);
  const flight = await claimsInFlight(db, practiceId);
  const { matrix, provision } = await ageingForPractice(db, practiceId);
  const user = c.get('user')!;
  const [existing] = await db.select().from(schema.billingPeriods).where(and(eq(schema.billingPeriods.practiceId, practiceId), eq(schema.billingPeriods.period, period))).limit(1);
  const values = { practiceId, period, unbilled: register as unknown as Record<string, unknown>, inFlight: flight as unknown as Record<string, unknown>, provision: { matrix, ...provision } as unknown as Record<string, unknown>, checklist: checklist ?? existing?.checklist ?? [], status: 'signed', signedBy: user.id, signedAt: nowIso(), updatedAt: nowIso() };
  if (existing) await db.update(schema.billingPeriods).set(values).where(eq(schema.billingPeriods.id, existing.id));
  else await db.insert(schema.billingPeriods).values({ id: newId('bp'), ...values });
  await audit(c, 'billing.period_signed', { type: 'billing_period', id: `${practiceId}:${period}` }, { period, unbilledCents: register.valueCents, confirm: typedConfirm });
  await emit(c, 'billing.period.checklist.completed.v1', { practiceId, period, unbilledCents: register.valueCents, unbilledCount: register.count, inFlightCents: flight.valueCents, provisionCents: provision.totalProvisionCents }, { aggregateType: 'billing_period', aggregateId: `${practiceId}:${period}`, practiceId });
  return c.json({ ok: true });
});

/* ============================ Debtors ============================ */

r.get('/debtors/tiles', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const { matrix, provision } = await ageingForPractice(db, practiceId);
  const accounts = await db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, practiceId), eq(schema.patientAccounts.status, 'open')));
  const plans = await db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.practiceId, practiceId));
  const disputes = await db.select().from(schema.disputes).where(and(eq(schema.disputes.practiceId, practiceId), eq(schema.disputes.status, 'open')));
  const writeOffs = await db.select().from(schema.writeOffs).where(eq(schema.writeOffs.practiceId, practiceId));
  const handovers = await db.select().from(schema.handovers).where(and(eq(schema.handovers.practiceId, practiceId), eq(schema.handovers.status, 'proposed')));
  const [run] = await db.select().from(schema.dunningRuns).where(eq(schema.dunningRuns.practiceId, practiceId)).orderBy(desc(schema.dunningRuns.startedAt)).limit(1);
  const t = today();
  const mtd = t.slice(0, 7);
  const writeOffsMtd = writeOffs.filter((x) => x.status === 'approved' && x.createdAt.startsWith(mtd));
  const charges = await db.select({ totalCents: schema.charges.totalCents }).from(schema.charges).where(eq(schema.charges.practiceId, practiceId));
  const gross = charges.reduce((a, x) => a + x.totalCents, 0);
  const patientTotal = matrix.patient.total;
  const activePlans = plans.filter((x) => x.status === 'active');
  const arrears = activePlans.filter((x) => x.schedule.some((s) => s.status !== 'paid' && s.dueDate < t));
  const planBook = activePlans.reduce((a, x) => a + x.schedule.filter((s) => s.status !== 'paid').reduce((b, s) => b + s.amountCents, 0), 0);
  const dso = gross ? Math.round((matrix.scheme.total + patientTotal) / Math.max(1, gross / 90)) : 0;
  const collected = matrix.scheme.total + matrix.patient.total;
  return c.json({
    tiles: {
      openPatientCents: patientTotal, dsoDays: dso,
      collection: { d30: pctOf(matrix, 'current'), d60: pctOf(matrix, '30'), d90: pctOf(matrix, '60') },
      writeOffsMtdCents: writeOffsMtd.reduce((a, x) => a + x.amountCents, 0), writeOffPct: gross ? Math.round((writeOffsMtd.reduce((a, x) => a + x.amountCents, 0) / gross) * 1000) / 10 : 0,
      plansInArrearsPct: planBook ? Math.round((arrears.reduce((a, x) => a + x.totalCents, 0) / planBook) * 1000) / 10 : 0, planBookCents: planBook, activePlans: activePlans.length,
      disputesOpen: disputes.length, disputesPastSla: disputes.filter((x) => x.slaDueAt < nowIso()).length,
      handoversPending: handovers.length, handoverCents: handovers.reduce((a, x) => a + x.amountCents, 0),
      accounts: accounts.length, provisionCents: provision.totalProvisionCents, collectedCents: collected,
    },
    ageing: matrix, provision, lastRun: run ?? null,
  });
});
function pctOf(m: Awaited<ReturnType<typeof ageingForPractice>>['matrix'], bucket: 'current' | '30' | '60') {
  const total = m.patient.total || 1;
  const buckets = { current: m.patient.current, '30': m.patient.current + m.patient['30'], '60': m.patient.current + m.patient['30'] + m.patient['60'] };
  return Math.round((buckets[bucket] / total) * 100);
}

r.get('/debtors/accounts', allow(...MONEY, 'FDK'), async (c) => {
  const practiceId = requirePractice(c);
  const { debtorClass, bucket, q, limit } = query(c, z.object({ debtorClass: z.string().optional(), bucket: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().min(1).max(300).default(100) }));
  const db = c.get('services').db;
  const where = [eq(schema.patientAccounts.practiceId, practiceId)];
  if (debtorClass) where.push(eq(schema.patientAccounts.debtorClass, debtorClass));
  if (q) where.push(or(like(schema.patientAccounts.debtorName, `%${q}%`), like(schema.patientAccounts.accountNo, `%${q}%`))!);
  const rows = await db.select().from(schema.patientAccounts).where(and(...where)).orderBy(desc(schema.patientAccounts.balanceCents)).limit(limit);
  const t = today();
  const enriched = rows.map((x) => ({ ...x, ageDays: x.ageingStartAt ? daysBetween(x.ageingStartAt, t) : 0, propensityBand: (x.propensity as { band?: string } | null)?.band ?? null }));
  const filtered = bucket ? enriched.filter((x) => bucketOf(x.ageDays) === bucket) : enriched;
  return c.json({ accounts: filtered });
});
function bucketOf(d: number) { return d < 30 ? 'current' : d < 60 ? '30' : d < 90 ? '60' : d < 120 ? '90' : '120+'; }

r.get('/debtors/accounts/:id', allow(...MONEY, 'FDK'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, id)).limit(1);
  if (!account) throw notFound('Account');
  const ledger = await db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, id)).orderBy(schema.accountTransactions.at);
  const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, account.patientId)).limit(1);
  const plans = await db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.accountId, id));
  const disputes = await db.select().from(schema.disputes).where(eq(schema.disputes.accountId, id));
  const actions = await db.select().from(schema.dunningActions).where(eq(schema.dunningActions.accountId, id)).orderBy(desc(schema.dunningActions.scheduledFor)).limit(20);
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.accountId, id)).orderBy(desc(schema.payments.at)).limit(20);
  const score = await scoreAccount(db, account);
  const exclusions = (await import('@bonakala/domain/billing')).collectionsExclusions({ balanceCents: account.balanceCents, ageingStartAt: account.ageingStartAt ?? account.createdAt, flags: account.flags, debtorClass: account.debtorClass as 'patient', contactsLast7d: account.contactsLast7d, planStatus: account.planId ? 'active' : 'none', dueDate: account.dueDate ?? undefined }, today());
  return c.json({
    account, ledger, plans, disputes, actions, payments, score, exclusions,
    patient: patient ? { id: patient.id, name: `${patient.lastName}, ${patient.firstName}`, language: patient.language, schemeName: patient.schemeName, schemeOption: patient.schemeOption, idMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : null, mobile: patient.mobile } : null,
  });
});

/* ---- Collections runs ---- */
r.get('/debtors/runs', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const runs = await db.select().from(schema.dunningRuns).where(eq(schema.dunningRuns.practiceId, practiceId)).orderBy(desc(schema.dunningRuns.startedAt)).limit(30);
  return c.json({ runs, policy: DEFAULT_DUNNING_POLICY });
});

r.get('/debtors/runs/:id', allow(...MONEY), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [run] = await db.select().from(schema.dunningRuns).where(eq(schema.dunningRuns.id, id)).limit(1);
  if (!run) throw notFound('Run');
  const actions = await db.select().from(schema.dunningActions).where(eq(schema.dunningActions.runId, id)).limit(300);
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.practiceId, run.practiceId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return c.json({ run, actions: actions.map((a) => ({ ...a, account: byId.get(a.accountId)?.accountNo ?? a.accountId, debtorName: byId.get(a.accountId)?.debtorName ?? null })) });
});

r.post('/debtors/run', allow('DEB', 'PRM', 'EXE', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const { dryRun } = await body(c, z.object({ dryRun: z.boolean().default(false) }));
  const task = await runHand(services, 'collections', { practiceId, dryRun }, { practiceId, trigger: 'manual', title: 'Collections run' });
  await audit(c, 'debtors.run', { type: 'agent_task', id: task.id }, { dryRun, status: task.status });
  return c.json({ task });
});

r.post('/debtors/runs/:id/review', allow('DEB', 'PRM'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const user = c.get('user')!;
  await db.update(schema.dunningRuns).set({ sampleReviewedBy: user.id, sampleReviewedAt: nowIso() }).where(eq(schema.dunningRuns.id, id));
  await audit(c, 'debtors.run_sample_reviewed', { type: 'dunning_run', id });
  return c.json({ ok: true });
});

/* ---- Plans ---- */
r.get('/debtors/plans', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const plans = await db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.practiceId, practiceId)).orderBy(desc(schema.paymentPlans.createdAt));
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.practiceId, practiceId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const t = today();
  return c.json({ plans: plans.map((p) => ({ ...p, debtorName: byId.get(p.accountId)?.debtorName ?? null, accountNo: byId.get(p.accountId)?.accountNo ?? null, nextDue: p.schedule.find((s) => s.status !== 'paid') ?? null, inArrears: p.schedule.some((s) => s.status !== 'paid' && s.dueDate < t) })), policy: { maxInstalments: DEFAULT_DUNNING_POLICY.maxPlanInstalments, maxPlanCents: DEFAULT_DUNNING_POLICY.maxPlanCents, interestPct: 0 } });
});

r.post('/debtors/plans', allow('DEB', 'PRM', 'FDK', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const db = services.db;
  const data = await body(c, z.object({ accountId: z.string(), instalments: z.number().int().min(1).max(12), firstDue: z.string().optional(), method: z.enum(['paylink', 'debit_order']).default('paylink'), approve: z.boolean().default(false) }));
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, data.accountId)).limit(1);
  if (!account) throw notFound('Account');
  if (account.balanceCents <= 0) throw invalid('This account has no balance to spread');
  const plan = buildPlan(account.balanceCents, data.instalments, data.firstDue ?? today());
  const user = c.get('user')!;
  const needsApproval = !plan.withinPolicy || account.balanceCents > DEFAULT_DUNNING_POLICY.maxPlanCents;
  const approved = data.approve && ['DEB', 'PRM', 'EXE'].includes(user.persona);
  const id = newId('pln');
  await db.insert(schema.paymentPlans).values({
    id, practiceId, accountId: account.id, patientId: account.patientId, totalCents: account.balanceCents, instalmentCount: data.instalments, instalmentCents: plan.instalmentCents, interestPct: 0,
    schedule: plan.instalments, method: data.method, status: needsApproval && !approved ? 'proposed' : 'active', approvedBy: approved ? user.id : null, approvedAt: approved ? nowIso() : null,
  });
  if (!needsApproval || approved) await db.update(schema.patientAccounts).set({ planId: id, updatedAt: nowIso() }).where(eq(schema.patientAccounts.id, account.id));
  await audit(c, 'debtors.plan_created', { type: 'payment_plan', id }, { accountId: account.id, instalments: data.instalments, totalCents: account.balanceCents, needsApproval, approved });
  await emit(c, 'payment.plan.created.v1', { planId: id, practiceId, accountId: account.id, patientId: account.patientId, totalCents: account.balanceCents, instalments: data.instalments, interestPct: 0 }, { aggregateType: 'payment_plan', aggregateId: id, practiceId });
  return c.json({ id, status: needsApproval && !approved ? 'proposed' : 'active', schedule: plan.instalments, reasons: plan.reasons }, 201);
});

r.post('/debtors/plans/:id/approve', allow('DEB', 'PRM', 'EXE'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const user = c.get('user')!;
  const [plan] = await db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.id, id)).limit(1);
  if (!plan) throw notFound('Plan');
  if (plan.status !== 'proposed') throw conflict('Plan is not awaiting approval');
  await db.update(schema.paymentPlans).set({ status: 'active', approvedBy: user.id, approvedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.paymentPlans.id, id));
  await db.update(schema.patientAccounts).set({ planId: id, updatedAt: nowIso() }).where(eq(schema.patientAccounts.id, plan.accountId));
  await audit(c, 'debtors.plan_approved', { type: 'payment_plan', id }, { totalCents: plan.totalCents });
  return c.json({ ok: true });
});

/* ---- Disputes ---- */
r.get('/debtors/disputes', allow(...MONEY, 'FDK'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.disputes).where(eq(schema.disputes.practiceId, practiceId)).orderBy(desc(schema.disputes.createdAt));
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.practiceId, practiceId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return c.json({ disputes: rows.map((d) => ({ ...d, debtorName: byId.get(d.accountId)?.debtorName ?? null, accountNo: byId.get(d.accountId)?.accountNo ?? null, overdue: d.status === 'open' && d.slaDueAt < nowIso() })) });
});

r.post('/debtors/disputes', allow(...MONEY, 'FDK', 'PAT'), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const data = await body(c, z.object({ accountId: z.string(), reason: z.string().min(3), message: z.string().optional(), claimId: z.string().optional(), amountCents: z.number().int().optional(), raisedVia: z.string().default('console') }));
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, data.accountId)).limit(1);
  if (!account) throw notFound('Account');
  const id = newId('dsp');
  const slaDueAt = new Date(Date.now() + 5 * 86400_000).toISOString();
  const [claim] = data.claimId ? await db.select().from(schema.claims).where(eq(schema.claims.id, data.claimId)).limit(1) : [];
  await db.insert(schema.disputes).values({
    id, practiceId: account.practiceId, accountId: account.id, patientId: account.patientId, claimId: data.claimId ?? null, chargeId: claim?.chargeId ?? null, raisedVia: data.raisedVia, reason: data.reason, message: data.message ?? null,
    amountCents: data.amountCents ?? account.balanceCents, status: 'open', slaDueAt,
    evidence: claim ? { claimRef: claim.claimRef, totalCents: claim.totalCents, paidCents: claim.paidCents, expectedPatientCents: claim.expectedPatientCents, funder: FUNDER_NAMES[claim.funderId] ?? claim.funderId, reason: claim.rejectionReason } : null,
  });
  // A dispute pauses dunning on the account (M14-R-153).
  await db.update(schema.patientAccounts).set({ flags: [...new Set([...account.flags, 'disputed'])], updatedAt: nowIso() }).where(eq(schema.patientAccounts.id, account.id));
  await audit(c, 'debtors.dispute_opened', { type: 'dispute', id }, { accountId: account.id, reason: data.reason });
  await emit(c, 'dispute.opened.v1', { disputeId: id, practiceId: account.practiceId, accountId: account.id, patientId: account.patientId, amountCents: data.amountCents ?? account.balanceCents }, { aggregateType: 'dispute', aggregateId: id, practiceId: account.practiceId });
  return c.json({ id, slaDueAt }, 201);
});

r.post('/debtors/disputes/:id/resolve', allow('DEB', 'PRM', 'EXE'), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const id = param(c, 'id');
  const { outcome, note, writeOffCents, reason } = await body(c, z.object({ outcome: z.enum(['upheld', 'partly_upheld', 'not_upheld', 'referred_to_funder']), note: z.string().min(3), writeOffCents: z.number().int().min(0).default(0), reason: z.string().optional() }));
  const [dispute] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, id)).limit(1);
  if (!dispute) throw notFound('Dispute');
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, dispute.accountId)).limit(1);
  const user = c.get('user')!;
  if (writeOffCents > 0 && account) {
    const approver = writeOffApprover(writeOffCents);
    const woId = newId('wo');
    const canApprove = approver === user.persona || ['PRM', 'EXE'].includes(user.persona);
    await db.insert(schema.writeOffs).values({
      id: woId, practiceId: account.practiceId, accountId: account.id, patientId: account.patientId, amountCents: writeOffCents, reason: reason ?? 'quote_honoured_practice_error',
      rootCause: outcome === 'upheld' ? 'quote accuracy: out-of-network flag not set at booking' : 'dispute settlement', proposedBy: user.id, approverPersona: approver, approvedBy: canApprove ? user.id : null, approvedAt: canApprove ? nowIso() : null, status: canApprove ? 'approved' : 'proposed', period: today().slice(0, 7),
    });
    if (canApprove) {
      await postTransaction(services, account, { type: 'write_off', amountCents: -writeOffCents, description: `Write-off: ${reason ?? 'quote honoured, Practice error'}`, reason: reason ?? 'quote_honoured_practice_error', refType: 'dispute', refId: id });
      await emit(c, 'writeoff.approved.v1', { writeOffId: woId, practiceId: account.practiceId, accountId: account.id, amountCents: writeOffCents, reason: reason ?? 'quote_honoured_practice_error' }, { aggregateType: 'write_off', aggregateId: woId, practiceId: account.practiceId });
    }
  }
  await db.update(schema.disputes).set({ status: outcome, outcome: note, resolvedAt: nowIso(), resolvedBy: user.id, updatedAt: nowIso() }).where(eq(schema.disputes.id, id));
  if (account) await db.update(schema.patientAccounts).set({ flags: account.flags.filter((f) => f !== 'disputed'), updatedAt: nowIso() }).where(eq(schema.patientAccounts.id, account.id));
  await audit(c, 'debtors.dispute_resolved', { type: 'dispute', id }, { outcome, writeOffCents, note });
  await emit(c, 'dispute.resolved.v1', { disputeId: id, practiceId: dispute.practiceId, outcome, writeOffCents }, { aggregateType: 'dispute', aggregateId: id, practiceId: dispute.practiceId });
  return c.json({ ok: true });
});

/* ---- Write-offs ---- */
r.get('/debtors/write-offs', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.writeOffs).where(eq(schema.writeOffs.practiceId, practiceId)).orderBy(desc(schema.writeOffs.createdAt));
  const byReason: Record<string, { count: number; cents: number }> = {};
  for (const x of rows.filter((w) => w.status === 'approved')) { const e = (byReason[x.reason] ??= { count: 0, cents: 0 }); e.count++; e.cents += x.amountCents; }
  return c.json({ writeOffs: rows, byReason, limits: { DEB: 50000, PRM: 500000, EXE: null } });
});

r.post('/debtors/write-offs', allow('DEB', 'PRM', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const data = await body(c, z.object({ accountId: z.string(), amountCents: z.number().int().positive(), reason: z.string().min(3), rootCause: z.string().optional() }));
  const user = c.get('user')!;
  const approver = writeOffApprover(data.amountCents);
  const canApprove = approver === user.persona || (approver === 'DEB' && ['PRM', 'EXE'].includes(user.persona)) || (approver === 'PRM' && user.persona === 'EXE');
  const id = newId('wo');
  await db.insert(schema.writeOffs).values({ id, practiceId, accountId: data.accountId, amountCents: data.amountCents, reason: data.reason, rootCause: data.rootCause ?? null, proposedBy: user.id, approverPersona: approver, status: canApprove ? 'approved' : 'proposed', approvedBy: canApprove ? user.id : null, approvedAt: canApprove ? nowIso() : null, period: today().slice(0, 7) });
  await audit(c, 'debtors.write_off', { type: 'write_off', id }, { ...data, approver, approved: canApprove });
  if (canApprove) {
    const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, data.accountId)).limit(1);
    if (account) await postTransaction(c.get('services'), account, { type: 'write_off', amountCents: -data.amountCents, description: `Write-off: ${data.reason}`, reason: data.reason, refType: 'write_off', refId: id });
    await emit(c, 'writeoff.approved.v1', { writeOffId: id, practiceId, accountId: data.accountId, amountCents: data.amountCents, reason: data.reason }, { aggregateType: 'write_off', aggregateId: id, practiceId });
  } else await emit(c, 'writeoff.proposed.v1', { writeOffId: id, practiceId, amountCents: data.amountCents, approverPersona: approver }, { aggregateType: 'write_off', aggregateId: id, practiceId });
  return c.json({ id, status: canApprove ? 'approved' : 'proposed', approverPersona: approver }, 201);
});

r.post('/debtors/write-offs/:id/approve', allow('PRM', 'EXE', 'DEB'), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const id = param(c, 'id');
  const user = c.get('user')!;
  const [wo] = await db.select().from(schema.writeOffs).where(eq(schema.writeOffs.id, id)).limit(1);
  if (!wo) throw notFound('Write-off');
  if (wo.status !== 'proposed') throw conflict('Not awaiting approval');
  if (wo.approverPersona !== user.persona && !['PRM', 'EXE'].includes(user.persona)) return c.json({ error: 'forbidden', needs: wo.approverPersona }, 403);
  await db.update(schema.writeOffs).set({ status: 'approved', approvedBy: user.id, approvedAt: nowIso() }).where(eq(schema.writeOffs.id, id));
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, wo.accountId)).limit(1);
  if (account) await postTransaction(services, account, { type: 'write_off', amountCents: -wo.amountCents, description: `Write-off: ${wo.reason}`, reason: wo.reason, refType: 'write_off', refId: id });
  await audit(c, 'debtors.write_off_approved', { type: 'write_off', id }, { amountCents: wo.amountCents });
  await emit(c, 'writeoff.approved.v1', { writeOffId: id, practiceId: wo.practiceId, accountId: wo.accountId, amountCents: wo.amountCents, reason: wo.reason }, { aggregateType: 'write_off', aggregateId: id, practiceId: wo.practiceId });
  return c.json({ ok: true });
});

/* ---- Handover ---- */
r.get('/debtors/handover', allow(...MONEY), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.handovers).where(eq(schema.handovers.practiceId, practiceId)).orderBy(desc(schema.handovers.createdAt));
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.practiceId, practiceId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const t = today();
  return c.json({
    handovers: rows.map((h) => ({ ...h, debtorName: byId.get(h.accountId)?.debtorName ?? null, accountNo: byId.get(h.accountId)?.accountNo ?? null, ageDays: byId.get(h.accountId)?.ageingStartAt ? daysBetween(byId.get(h.accountId)!.ageingStartAt!, t) : null })),
    minimumCents: DEFAULT_DUNNING_POLICY.minHandoverCents, prescriptionYears: DEFAULT_DUNNING_POLICY.prescriptionYears,
  });
});

/** Approval is a reserved action: DEB submits, PRM confirms with a typed Confirm. */
r.post('/debtors/handover/:id/approve', allow('PRM', 'EXE', 'DEB'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { confirm } = await body(c, z.object({ confirm: z.literal('Confirm') }));
  const user = c.get('user')!;
  const [h] = await db.select().from(schema.handovers).where(eq(schema.handovers.id, id)).limit(1);
  if (!h) throw notFound('Handover');
  if (!h.clean) throw conflict(`The checklist is not clean: ${h.failing.join(', ')}`);
  if (!['PRM', 'EXE'].includes(user.persona)) return c.json({ error: 'forbidden', needs: 'PRM', message: 'Handover is a reserved action; PRM approves after DEB' }, 403);
  await db.update(schema.handovers).set({ status: 'approved', approvedBy: user.id, approvedAt: nowIso() }).where(eq(schema.handovers.id, id));
  await audit(c, 'debtors.handover_approved', { type: 'handover', id }, { amountCents: h.amountCents, confirm });
  await emit(c, 'collections.handover.approved.v1', { handoverId: id, practiceId: h.practiceId, accountId: h.accountId, amountCents: h.amountCents }, { aggregateType: 'handover', aggregateId: id, practiceId: h.practiceId });
  return c.json({ ok: true });
});

r.post('/debtors/handover/:id/release', allow('PRM', 'EXE'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [h] = await db.select().from(schema.handovers).where(eq(schema.handovers.id, id)).limit(1);
  if (!h) throw notFound('Handover');
  if (h.status !== 'approved') throw conflict('Approve the handover before releasing the file');
  await db.update(schema.handovers).set({ status: 'released', releasedAt: nowIso() }).where(eq(schema.handovers.id, id));
  await db.update(schema.patientAccounts).set({ status: 'handed_over', updatedAt: nowIso() }).where(eq(schema.patientAccounts.id, h.accountId));
  await audit(c, 'debtors.handover_released', { type: 'handover', id }, { collector: h.collector });
  await emit(c, 'collections.handover.released.v1', { handoverId: id, practiceId: h.practiceId, accountId: h.accountId }, { aggregateType: 'handover', aggregateId: id, practiceId: h.practiceId });
  return c.json({ ok: true });
});

r.post('/debtors/handover/:id/remove', allow('DEB', 'PRM', 'EXE'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { reason } = await body(c, z.object({ reason: z.string().min(3) }));
  await db.update(schema.handovers).set({ status: 'rejected' }).where(eq(schema.handovers.id, id));
  await audit(c, 'debtors.handover_removed', { type: 'handover', id }, { reason });
  return c.json({ ok: true });
});

/* ============================ Patient billing (Collect card, payments) ============================ */

/** Used by the front desk Collect card and the Patient Space (cluster A calls this). */
r.get('/patients/:id/account', allow(...DESK, 'PAT', 'BKG', 'NUR', 'RAD'), async (c) => {
  const db = c.get('services').db;
  const patientId = param(c, 'id');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && user.patientId !== patientId) return c.json({ error: 'forbidden' }, 403);
  const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, patientId)).limit(1);
  if (!patient) throw notFound('Patient');
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.patientId, patientId));
  const account = accounts[0] ?? null;
  const charges = await db.select().from(schema.charges).where(eq(schema.charges.patientId, patientId)).orderBy(desc(schema.charges.serviceDate)).limit(20);
  const latest = charges[0] ?? null;
  const ledger = account ? await db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, account.id)).orderBy(desc(schema.accountTransactions.at)).limit(40) : [];
  const plans = account ? await db.select().from(schema.paymentPlans).where(and(eq(schema.paymentPlans.accountId, account.id), inArray(schema.paymentPlans.status, ['active', 'proposed']))) : [];
  const payments = account ? await db.select().from(schema.payments).where(eq(schema.payments.accountId, account.id)).orderBy(desc(schema.payments.at)).limit(20) : [];
  const priorBalance = account ? account.balanceCents - (latest?.expectedPatientCents ?? 0) : 0;
  // Collect card: scheme portion, patient portion, reason, previous balance
  const collect = latest ? {
    chargeId: latest.id, serviceDate: latest.serviceDate, procedure: procedureText(latest.lines), totalCents: latest.totalCents, schemePortionCents: latest.expectedFunderCents, patientPortionCents: latest.expectedPatientCents,
    reason: latest.patientPortionReason === 'cash' ? 'Cash patient: the full amount is payable' : latest.patientPortionReason === 'network_co_pay' ? 'Network co-payment per the scheme option' : latest.patientPortionReason === 'pmb_zero' ? 'Prescribed Minimum Benefit at a designated provider: nothing payable' : 'No patient portion expected',
    funder: FUNDER_NAMES[latest.funderId] ?? latest.funderId, lines: latest.lines, vatCents: latest.vatCents, subtotalExclCents: latest.subtotalExclCents,
  } : null;
  return c.json({
    patient: { id: patient.id, name: `${patient.lastName}, ${patient.firstName}`, schemeName: patient.schemeName, schemeOption: patient.schemeOption, memberNo: patient.memberNo, language: patient.language, mobile: patient.mobile },
    account, collect, priorBalanceCents: Math.max(0, priorBalance), balanceCents: account?.balanceCents ?? 0, ledger, plans, payments,
    methods: ['card', 'payshap', 'eft', 'qr', 'cash'],
  });
});

/** Statement with the arithmetic per line (M14-R-151). */
r.get('/patients/:id/statement', allow(...DESK, 'PAT'), async (c) => {
  const db = c.get('services').db;
  const patientId = param(c, 'id');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && user.patientId !== patientId) return c.json({ error: 'forbidden' }, 403);
  const [account] = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.patientId, patientId)).limit(1);
  if (!account) return c.json({ statement: null, balanceCents: 0, lines: [] });
  const ledger = await db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, account.id)).orderBy(schema.accountTransactions.at);
  const lines = ledger.map((t) => ({ at: t.at, description: t.description, type: t.type, amountCents: t.amountCents, reason: t.reason, arithmetic: t.arithmetic }));
  let running = 0;
  const withBalance = lines.map((l) => ({ ...l, balanceCents: (running += l.amountCents) }));
  return c.json({ statement: { accountNo: account.accountNo, generatedAt: nowIso(), balanceCents: account.balanceCents, ageingStartAt: account.ageingStartAt, whatHappensNext: account.balanceCents > 0 ? 'Pay with the link we sent, ask for a payment plan, or tell us if the amount is wrong.' : 'Nothing is owed.' }, lines: withBalance, balanceCents: account.balanceCents });
});

/** Take a payment at the desk (card, PayShap, EFT, QR, cash) and issue a receipt. */
r.post('/payments', allow(...DESK, 'NUR'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const data = await body(c, z.object({ patientId: z.string().optional(), accountId: z.string().optional(), method: z.enum(['card', 'payshap', 'eft', 'qr', 'cash']), amountCents: z.number().int().positive(), reference: z.string().optional(), siteId: z.string().optional() }));
  if (!data.patientId && !data.accountId) throw invalid('A patient or account is required');
  const user = c.get('user')!;
  const { payment, account } = await recordPayment(services, { practiceId, ...data, takenBy: user.id });
  await audit(c, 'billing.payment_taken', { type: 'payment', id: payment.id }, { method: data.method, amountCents: data.amountCents, accountId: account?.id });
  return c.json({ payment, receiptNo: payment.receiptNo, balanceCents: account?.balanceCents ?? 0 }, 201);
});

/** Create a single-use, expiring payment link (PSP hosted page). */
r.post('/payments/link', allow(...DESK, 'PAT', 'NUR'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const data = await body(c, z.object({ patientId: z.string().optional(), accountId: z.string().optional(), amountCents: z.number().int().positive(), channel: z.string().default('whatsapp') }));
  const user = c.get('user')!;
  if (user.persona === 'PAT' && data.patientId && user.patientId !== data.patientId) return c.json({ error: 'forbidden' }, 403);
  const link = await createPaymentLink(services, { practiceId, ...data, createdBy: user.id });
  await audit(c, 'billing.payment_link_created', { type: 'payment', id: link.id }, { amountCents: data.amountCents, channel: data.channel });
  return c.json(link, 201);
});

r.get('/payments', allow(...DESK), async (c) => {
  const practiceId = requirePractice(c);
  const { day } = query(c, z.object({ day: z.string().optional() }));
  const db = c.get('services').db;
  const rows = await db.select().from(schema.payments).where(eq(schema.payments.practiceId, practiceId)).orderBy(desc(schema.payments.at)).limit(200);
  const d = day ?? today();
  const todays = rows.filter((x) => x.at.startsWith(d) && x.status === 'settled');
  const byMethod: Record<string, { count: number; cents: number }> = {};
  for (const x of todays) { const e = (byMethod[x.method] ??= { count: 0, cents: 0 }); e.count++; e.cents += x.amountCents; }
  return c.json({ payments: rows, today: { date: d, count: todays.length, totalCents: todays.reduce((a, x) => a + x.amountCents, 0), byMethod, cashCents: byMethod.cash?.cents ?? 0 } });
});

/** Day cash-up for the front desk (methods, variances, receipts). */
r.get('/cash-up', allow(...DESK), async (c) => {
  const practiceId = requirePractice(c);
  const { day } = query(c, z.object({ day: z.string().optional() }));
  const d = day ?? today();
  const db = c.get('services').db;
  const rows = await db.select().from(schema.payments).where(and(eq(schema.payments.practiceId, practiceId), eq(schema.payments.status, 'settled')));
  const todays = rows.filter((x) => x.at.startsWith(d));
  const byMethod: Record<string, { count: number; cents: number }> = {};
  for (const x of todays) { const e = (byMethod[x.method] ??= { count: 0, cents: 0 }); e.count++; e.cents += x.amountCents; }
  const bySite: Record<string, number> = {};
  for (const x of todays) bySite[x.siteId ?? 'unassigned'] = (bySite[x.siteId ?? 'unassigned'] ?? 0) + x.amountCents;
  return c.json({
    day: d, totalCents: todays.reduce((a, x) => a + x.amountCents, 0), count: todays.length, byMethod, bySite,
    cash: { countedCents: byMethod.cash?.cents ?? 0, expectedCents: byMethod.cash?.cents ?? 0, varianceCents: 0, floatCents: 50000 },
    receipts: todays.slice(0, 50).map((x) => ({ id: x.id, receiptNo: x.receiptNo, method: x.method, amountCents: x.amountCents, status: x.status, at: x.at, reference: x.reference, patientId: x.patientId, takenBy: x.takenBy })),
  });
});

/** The patient's own money view (Patient Space Pay section). */
r.get('/mine', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ error: 'no_patient' }, 404);
  const db = c.get('services').db;
  const accounts = await db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.patientId, user.patientId));
  const account = accounts[0] ?? null;
  const ledger = account ? await db.select().from(schema.accountTransactions).where(eq(schema.accountTransactions.accountId, account.id)).orderBy(desc(schema.accountTransactions.at)).limit(40) : [];
  const payments = account ? await db.select().from(schema.payments).where(eq(schema.payments.accountId, account.id)).orderBy(desc(schema.payments.at)).limit(20) : [];
  const plans = account ? await db.select().from(schema.paymentPlans).where(and(eq(schema.paymentPlans.accountId, account.id), inArray(schema.paymentPlans.status, ['active', 'proposed']))) : [];
  const charges = await db.select().from(schema.charges).where(eq(schema.charges.patientId, user.patientId)).orderBy(desc(schema.charges.serviceDate)).limit(10);
  return c.json({
    balanceCents: account?.balanceCents ?? 0, account, ledger, payments, plans,
    lines: charges.map((x) => ({ chargeId: x.id, serviceDate: x.serviceDate, description: procedureText(x.lines), totalCents: x.totalCents, schemePortionCents: x.expectedFunderCents, patientPortionCents: x.expectedPatientCents, reason: x.patientPortionReason })),
    canPlan: (account?.balanceCents ?? 0) > 200000, planTerms: { maxInstalments: DEFAULT_DUNNING_POLICY.maxPlanInstalments, interestPct: 0 },
  });
});

/* ============================ Funder (PAY) portal ============================ */

r.get('/funder/summary', allow('PAY', 'EXE', 'SUP'), async (c) => {
  const db = c.get('services').db;
  const user = c.get('user')!;
  const funderId = user.persona === 'PAY' ? funderForPayUser(user.email) : (c.req.query('funderId') ?? 'scheme-a');
  const rows = await db.select().from(schema.claims).where(eq(schema.claims.funderId, funderId));
  const byStatus: Record<string, { count: number; cents: number }> = {};
  for (const x of rows) { const e = (byStatus[x.status] ??= { count: 0, cents: 0 }); e.count++; e.cents += x.totalCents; }
  const byPractice: Record<string, { count: number; cents: number }> = {};
  for (const x of rows) { const e = (byPractice[x.practiceId] ??= { count: 0, cents: 0 }); e.count++; e.cents += x.totalCents; }
  const responded = rows.filter((x) => x.respondedAt);
  const byReason: Record<string, number> = {};
  for (const x of rows.filter((y) => y.status === 'rejected')) byReason[x.rejectionCode ?? 'TECHNICAL'] = (byReason[x.rejectionCode ?? 'TECHNICAL'] ?? 0) + 1;
  const byCode: Record<string, { count: number; cents: number }> = {};
  for (const x of rows) for (const l of x.lines as Array<{ code: string; inclCents: number }>) { if (TARIFF_BY_CODE[l.code]?.kind !== 'procedure') continue; const e = (byCode[l.code] ??= { count: 0, cents: 0 }); e.count++; e.cents += l.inclCents; }
  return c.json({
    funderId, funder: FUNDER_NAMES[funderId] ?? funderId, total: rows.length, totalCents: rows.reduce((a, x) => a + x.totalCents, 0), byStatus, byPractice, byReason,
    topCodes: Object.entries(byCode).map(([code, v]) => ({ code, description: TARIFF_BY_CODE[code]?.description ?? code, ...v })).sort((a, b) => b.cents - a.cents).slice(0, 10),
    firstPassPct: responded.length ? Math.round((responded.filter((x) => ['accepted', 'paid', 'remitted'].includes(x.status)).length / responded.length) * 1000) / 10 : 100,
    rulePack: RULE_PACKS.filter((p) => p.funderId === funderId).sort((a, b) => (a.version < b.version ? 1 : -1))[0] ?? null,
  });
});

/** A funder asks for an audit pack; CMP releases it (this records the request). */
r.post('/funder/audit-request', allow('PAY'), async (c) => {
  const db = c.get('services').db;
  const { claimIds, reason } = await body(c, z.object({ claimIds: z.array(z.string()).min(1).max(50), reason: z.string().min(5) }));
  const user = c.get('user')!;
  const rows = await db.select().from(schema.claims).where(inArray(schema.claims.id, claimIds));
  const id = newId('far');
  await audit(c, 'billing.funder_audit_requested', { type: 'funder_audit', id }, { claimIds, reason, funder: funderForPayUser(user.email) });
  await emit(c, 'funder.audit.requested.v1', { requestId: id, claimIds, reason, funderId: funderForPayUser(user.email), practiceIds: [...new Set(rows.map((x) => x.practiceId))] }, { aggregateType: 'funder_audit', aggregateId: id });
  return c.json({ id, status: 'received', claims: rows.length, message: 'The request is recorded. Compliance releases the pack with a lawful-basis record.' }, 201);
});

/* ============================ Boot ============================ */

export default defineModule({
  code: 'M14', name: 'Revenue Cycle', basePath: 'billing', routes: r,
  boot() {
    registerBillingHands();
    registerSim('switch', switchRoutes);
    registerSim('psp', pspRoutes);
    registerSim('bank', bankRoutes);

    // Charge capture on report.signed.v1 → Coding Hand (Class 2 gate in the domain, not the prompt).
    on('report.signed.v1', async (evt, s) => {
      await onReportSigned(s, evt.payload as never);
    });

    // Real-time adjudication result updates the Collect card: nothing to do beyond the claim status,
    // but a funding quote lets us pre-create the account so the desk sees the expected portion.
    on('funding.quoted.v1', async (evt, s) => {
      const p = evt.payload as { patientId: string; practiceId: string; patientPortionCents?: number };
      if (!p.patientId || !p.practiceId) return;
      await ensureAccount(s, p.practiceId, p.patientId);
    });
  },
  async tick(services) {
    // Deadline watch: escalate claims within 30/14/7 days of their stale date.
    const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const rows = await services.db.select().from(schema.claims).where(and(inArray(schema.claims.status, ['rejected', 'held', 'scrubbed']), sql`${schema.claims.staleDate} <= ${soon}`));
    for (const x of rows) {
      await services.db.update(schema.claims).set({ exception: { ...(x.exception ?? { family: 'Deadline', reason: '', code: 'STALE', suggestion: '', path: 'manual', level: 'A1', openedAt: nowIso() }), family: 'Deadline', reason: `Stale-claim deadline ${x.staleDate}`, code: 'STALE' } }).where(eq(schema.claims.id, x.id));
    }
    return { deadlineEscalations: rows.length };
  },
});

export { switchState, classifyFunderCode, propensityToPay, handoverChecklist, matchRemittance, transferPatientLiability, shortPaymentReasonText, priceForCharge };
