import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, forbidden } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { loadCatalogue } from './catalogue.js';
import { REFERRAL_MODEL } from './parser.js';
import { evaluateAppropriateness, ageFrom, GUIDELINE_PACK, RULES } from './appropriateness.js';
import { createOrder, intakeReferral, parseWithProvenance, registerReferralHand, transitionOrder, orderWithContext, recentStudyCheck, ORDER_STATUSES, type OrderStatus } from './service.js';
import { sendWhatsApp } from '../../sim/whatsapp.js';

const r = router();
const STAFF = ['FDK', 'BKG', 'PRM', 'RAD', 'RGT', 'NUR', 'BIL', 'DEB', 'EXE', 'SUP', 'CMP', 'AIO'] as const;
const INTAKE = ['FDK', 'BKG', 'PRM', 'SUP', 'EXE', 'REF', 'PAT'] as const;

/* ---------- Catalogue ---------- */
r.get('/catalogue', allow(), async (c) => c.json({ procedures: await loadCatalogue(c.get('services')) }));
r.get('/guidelines', allow(), (c) => c.json({ pack: GUIDELINE_PACK, rules: RULES.map((x) => ({ id: x.id, modality: x.modality, band: x.band, guidance: x.guidance, alternative: x.alternative })) }));

/* ---------- Parse (no side effects) ---------- */
r.post('/parse', allow(), async (c) => {
  const { text } = await body(c, z.object({ text: z.string().min(3).max(4000) }));
  const parsed = await parseWithProvenance(c.get('services'), c.get('practiceId'), text);
  return c.json({ parsed, provenance: { ...REFERRAL_MODEL, confidence: parsed.confidence, outputClass: 3, demo: c.get('services').demoMode } });
});

/* ---------- Referral intake and inbox ---------- */
const intakeInput = z.object({
  channel: z.enum(['portal', 'whatsapp', 'paper_photo', 'fax', 'email', 'phone', 'fhir', 'walk_in']).default('portal'),
  text: z.string().max(4000).optional(), photoText: z.string().max(4000).optional(),
  sourceName: z.string().optional(), sourceContact: z.string().optional(), patientId: z.string().optional(), referrerId: z.string().optional(), autoConvert: z.boolean().default(true),
});
r.post('/', allow(...INTAKE), async (c) => {
  const user = c.get('user')!;
  const practiceId = requirePractice(c);
  const data = await body(c, intakeInput);
  if (!data.text && !data.photoText) throw invalid('Provide referral text or the text read from the photo');
  const patientId = user.persona === 'PAT' ? user.patientId ?? undefined : data.patientId;
  const referrerId = user.persona === 'REF' ? user.referrerId ?? undefined : data.referrerId;
  const services = c.get('services');
  const result = await intakeReferral(services, { practiceId, channel: user.persona === 'PAT' && data.channel === 'portal' ? 'paper_photo' : data.channel, text: data.text, photoText: data.photoText, sourceName: data.sourceName ?? user.name, sourceContact: data.sourceContact, patientId, referrerId, autoConvert: data.autoConvert });
  await audit(c, 'referral.received', { type: 'referral', id: result.referral.id }, { channel: data.channel, status: result.referral.status, taskId: result.task.id });
  await emit(c, 'referral.received.v1', { referralId: result.referral.id, channel: data.channel, status: result.referral.status, orderId: result.referral.orderId }, { aggregateType: 'referral', aggregateId: result.referral.id });
  const order = result.referral.orderId ? await orderWithContext(services, result.referral.orderId) : null;
  return c.json({ referral: result.referral, task: { id: result.task.id, status: result.task.status, steps: result.task.steps.length, llmUsed: result.task.llmUsed }, order, provenance: { ...REFERRAL_MODEL, confidence: (result.referral.confidence ?? 0) / 100, outputClass: 3, demo: services.demoMode } }, 201);
});

r.get('/', allow('FDK', 'BKG', 'PRM', 'SUP', 'EXE', 'CMP'), async (c) => {
  const practiceId = requirePractice(c);
  const { status, limit } = query(c, z.object({ status: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(100) }));
  const db = c.get('services').db;
  const rows = await db.select().from(schema.referrals).where(and(eq(schema.referrals.practiceId, practiceId), status ? inArray(schema.referrals.status, status.split(',')) : undefined)).orderBy(desc(schema.referrals.receivedAt)).limit(limit);
  const patientIds = [...new Set(rows.map((x) => x.patientId).filter(Boolean))] as string[];
  const patients = patientIds.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(inArray(schema.patients.id, patientIds)) : [];
  const referrers = await db.select({ id: schema.referrers.id, name: schema.referrers.name }).from(schema.referrers);
  return c.json({ referrals: rows.map((x) => ({ ...x, patient: patients.find((p) => p.id === x.patientId) ?? null, referrer: referrers.find((p) => p.id === x.referrerId) ?? null })) });
});

r.get('/inbox/summary', allow('FDK', 'BKG', 'PRM', 'SUP', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const rows = await c.get('services').db.select({ status: schema.referrals.status, channel: schema.referrals.channel, n: sql<number>`count(*)` }).from(schema.referrals).where(eq(schema.referrals.practiceId, practiceId)).groupBy(schema.referrals.status, schema.referrals.channel);
  return c.json({ summary: rows });
});

r.post('/:id/convert', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ patientId: z.string().optional(), referrerId: z.string().optional(), procedureCode: z.string().optional(), laterality: z.enum(['left', 'right', 'bilateral', 'na']).optional(), contrast: z.boolean().optional(), priority: z.enum(['routine', 'priority', 'urgent', 'stat']).optional(), icd10: z.array(z.string()).optional(), clinicalInfo: z.string().optional(), siteId: z.string().optional(), overrideReason: z.string().optional() }));
  const [ref] = await services.db.select().from(schema.referrals).where(eq(schema.referrals.id, id)).limit(1);
  if (!ref) throw notFound('Referral');
  if (ref.status === 'converted') return c.json({ error: 'already_converted', orderId: ref.orderId }, 409);
  const patientId = data.patientId ?? ref.patientId;
  const code = data.procedureCode ?? ref.parsed?.procedureCode;
  if (!patientId) throw invalid('A patient must be matched before converting');
  if (!code) throw invalid('A procedure must be chosen before converting');
  const user = c.get('user')!;
  const order = await createOrder(services, {
    practiceId: ref.practiceId, patientId, referrerId: data.referrerId ?? ref.referrerId ?? ref.parsed?.referrerId ?? null, referralId: ref.id, channel: ref.channel, siteId: data.siteId ?? null,
    procedures: [{ code, laterality: data.laterality ?? ref.parsed?.laterality, contrast: data.contrast ?? ref.parsed?.contrast }], priority: data.priority ?? ref.parsed?.urgency ?? 'routine',
    icd10: data.icd10 ?? ref.parsed?.icd10 ?? [], clinicalInfo: data.clinicalInfo ?? ref.parsed?.clinicalInfo ?? null, createdBy: user.id,
    appropriatenessOverride: data.overrideReason ? { reason: data.overrideReason, by: user.id } : null,
  }, c);
  await services.db.update(schema.referrals).set({ status: 'converted', orderId: order.id, patientId, referrerId: order.referrerId, updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, id));
  await audit(c, 'referral.converted', { type: 'referral', id }, { orderId: order.id, fields: Object.keys(data) });
  return c.json({ order }, 201);
});

r.post('/:id/reject', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { reason } = await body(c, z.object({ reason: z.string().min(3) }));
  await c.get('services').db.update(schema.referrals).set({ status: 'rejected', rejectReason: reason, updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, id));
  await audit(c, 'referral.rejected', { type: 'referral', id }, { reason });
  await emit(c, 'referral.rejected.v1', { referralId: id, reason }, { aggregateType: 'referral', aggregateId: id });
  return c.json({ ok: true });
});

r.post('/:id/request-info', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { message } = await body(c, z.object({ message: z.string().min(3).max(300) }));
  const services = c.get('services');
  const [ref] = await services.db.select().from(schema.referrals).where(eq(schema.referrals.id, id)).limit(1);
  if (!ref) throw notFound('Referral');
  if (!ref.sourceContact) throw invalid('No contact number on this referral');
  await sendWhatsApp(services, { practiceId: ref.practiceId, to: ref.sourceContact, text: message, by: c.get('user')!.id, patientId: ref.patientId });
  await services.db.update(schema.referrals).set({ status: 'needs_info', needsInfo: [...(ref.needsInfo ?? []), 'clarification_sent'], updatedAt: new Date().toISOString() }).where(eq(schema.referrals.id, id));
  await audit(c, 'referral.info_requested', { type: 'referral', id });
  return c.json({ ok: true });
});

/* ---------- Appropriateness guidance ---------- */
r.post('/appropriateness', allow(), async (c) => {
  const { procedureCode, clinicalInfo, patientId } = await body(c, z.object({ procedureCode: z.string(), clinicalInfo: z.string().default(''), patientId: z.string().optional() }));
  const services = c.get('services');
  const proc = (await loadCatalogue(services)).find((p) => p.code === procedureCode);
  if (!proc) throw notFound('Procedure');
  const patient = patientId ? (await services.db.select({ dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(eq(schema.patients.id, patientId)).limit(1))[0] : undefined;
  const result = evaluateAppropriateness(proc, clinicalInfo, { age: ageFrom(patient?.dateOfBirth), sex: patient?.sex ?? undefined });
  const alternative = result.alternative ? (await loadCatalogue(services)).find((p) => p.code === result.alternative) : undefined;
  return c.json({ result, alternative: alternative ? { code: alternative.code, description: alternative.description } : null, provenance: { modelId: 'guideline-rules', modelVersion: '2026.1', outputClass: 4, demo: services.demoMode } });
});

/* ---------- Orders ---------- */
const orderInput = z.object({
  patientId: z.string(), referrerId: z.string().optional(), siteId: z.string().optional(), channel: z.string().optional(),
  procedures: z.array(z.object({ code: z.string(), laterality: z.enum(['left', 'right', 'bilateral', 'na']).optional(), contrast: z.boolean().optional() })).min(1),
  priority: z.enum(['routine', 'priority', 'urgent', 'stat']).default('routine'), icd10: z.array(z.string()).default([]), clinicalInfo: z.string().optional(),
  appropriatenessOverrideReason: z.string().optional(), funderType: z.enum(['scheme', 'cash', 'raf', 'coida', 'corporate']).optional(), justificationNote: z.string().optional(),
});
r.post('/orders', allow('REF', 'BKG', 'FDK', 'PRM', 'SUP', 'RGT'), async (c) => {
  const practiceId = requirePractice(c);
  const user = c.get('user')!;
  const data = await body(c, orderInput);
  const referrerId = user.persona === 'REF' ? user.referrerId ?? undefined : data.referrerId;
  const order = await createOrder(c.get('services'), { ...data, practiceId, referrerId, channel: data.channel ?? (user.persona === 'REF' ? 'portal' : 'desk'), createdBy: user.id, appropriatenessOverride: data.appropriatenessOverrideReason ? { reason: data.appropriatenessOverrideReason, by: user.id } : null }, c);
  await audit(c, 'order.created', { type: 'order', id: order.id }, { procedures: order.procedures.map((p) => p.code), priority: order.priority, appropriateness: order.appropriateness?.band });
  return c.json({ order }, 201);
});

r.get('/orders', allow(...STAFF), async (c) => {
  const practiceId = requirePractice(c);
  const { status, patientId, limit, since } = query(c, z.object({ status: z.string().optional(), patientId: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200), since: z.string().optional() }));
  const db = c.get('services').db;
  const rows = await db.select().from(schema.orders).where(and(eq(schema.orders.practiceId, practiceId), status ? inArray(schema.orders.status, status.split(',')) : undefined, patientId ? eq(schema.orders.patientId, patientId) : undefined, since ? gte(schema.orders.createdAt, since) : undefined)).orderBy(desc(schema.orders.createdAt)).limit(limit);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const patients = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const referrers = await db.select({ id: schema.referrers.id, name: schema.referrers.name }).from(schema.referrers);
  return c.json({ orders: rows.map((o) => ({ ...o, patient: patients.find((p) => p.id === o.patientId) ?? null, referrer: referrers.find((x) => x.id === o.referrerId) ?? null })) });
});

r.get('/orders/:id', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const ctx = await orderWithContext(c.get('services'), param(c, 'id'));
  if (!ctx) throw notFound('Order');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && ctx.order.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && ctx.order.referrerId !== user.referrerId) throw forbidden();
  return c.json(ctx);
});

r.get('/orders/:id/duplicates', allow(...STAFF, 'REF'), async (c) => {
  const services = c.get('services');
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, param(c, 'id'))).limit(1);
  if (!o) throw notFound('Order');
  const p = o.procedures[0]!;
  return c.json({ recentStudy: await recentStudyCheck(services, o.patientId, p.modality, p.bodyPart, o.id) });
});

r.post('/orders/:id/recent-study/resolve', allow('REF', 'RGT', 'BKG', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const { resolution } = await body(c, z.object({ resolution: z.enum(['repeat_justified', 'release_prior_images', 'cancel']) }));
  const services = c.get('services');
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  if (!o) throw notFound('Order');
  await services.db.update(schema.orders).set({ recentStudy: { ...(o.recentStudy ?? { found: false, matches: [], windowDays: 30 }), resolvedBy: c.get('user')!.id, resolution }, updatedAt: new Date().toISOString() }).where(eq(schema.orders.id, id));
  await audit(c, 'order.recent_study_resolved', { type: 'order', id }, { resolution });
  if (resolution === 'cancel') await transitionOrder(services, id, 'cancelled', { c, reason: 'recent study: release prior images', actor: c.get('user')!.id });
  return c.json({ ok: true });
});

r.post('/orders/:id/cancel', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const id = param(c, 'id');
  const { reason } = await body(c, z.object({ reason: z.string().min(2) }));
  const services = c.get('services');
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  if (!o) throw notFound('Order');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && o.referrerId !== user.referrerId) throw forbidden();
  await transitionOrder(services, id, 'cancelled', { c, reason, actor: user.id, patch: { cancelReason: reason } });
  if (o.appointmentId) await services.db.update(schema.appointments).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date().toISOString() }).where(and(eq(schema.appointments.id, o.appointmentId), inArray(schema.appointments.status, ['held', 'booked', 'confirmed'])));
  await audit(c, 'order.cancelled', { type: 'order', id }, { reason });
  return c.json({ ok: true });
});

r.patch('/orders/:id/status', allow('BKG', 'FDK', 'PRM', 'RAD', 'RGT', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { status, reason } = await body(c, z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().optional() }));
  const o = await transitionOrder(c.get('services'), id, status as OrderStatus, { c, reason, actor: c.get('user')!.id });
  await audit(c, 'order.status', { type: 'order', id }, { to: status, reason });
  return c.json({ order: o });
});

r.patch('/orders/:id', allow('BKG', 'FDK', 'PRM', 'RGT', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ siteId: z.string().optional(), priority: z.enum(['routine', 'priority', 'urgent', 'stat']).optional(), icd10: z.array(z.string()).optional(), clinicalInfo: z.string().optional(), justification: z.enum(['justified', 'justified_pending_confirmation', 'not_justified']).optional(), justificationNote: z.string().optional(), funderType: z.string().optional() }));
  const user = c.get('user')!;
  if (data.justification && !['RGT', 'PRM', 'SUP'].includes(user.persona)) throw forbidden('Only a radiologist may change justification');
  await c.get('services').db.update(schema.orders).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.orders.id, id));
  await audit(c, 'order.updated', { type: 'order', id }, { fields: Object.keys(data) });
  return c.json({ ok: true });
});

/* ---------- REF-facing ---------- */
r.get('/my-referrals', allow('REF'), async (c) => {
  const user = c.get('user')!;
  if (!user.referrerId) return c.json({ orders: [] });
  const db = c.get('services').db;
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.referrerId, user.referrerId)).orderBy(desc(schema.orders.createdAt)).limit(300);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const patients = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const aids = rows.map((x) => x.appointmentId).filter(Boolean) as string[];
  const appts = aids.length ? await db.select({ id: schema.appointments.id, startsAt: schema.appointments.startsAt, status: schema.appointments.status, siteId: schema.appointments.siteId }).from(schema.appointments).where(inArray(schema.appointments.id, aids)) : [];
  const sites = await db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites);
  return c.json({ orders: rows.map((o) => { const a = appts.find((x) => x.id === o.appointmentId); return { ...o, patient: patients.find((p) => p.id === o.patientId) ?? null, appointment: a ? { ...a, siteName: sites.find((s) => s.id === a.siteId)?.name } : null }; }) });
});

r.get('/my-analytics', allow('REF'), async (c) => {
  const user = c.get('user')!;
  if (!user.referrerId) return c.json({ weeks: [], byModality: [], totals: {} });
  const rows = await c.get('services').db.select({ createdAt: schema.orders.createdAt, status: schema.orders.status, procedures: schema.orders.procedures, appointmentId: schema.orders.appointmentId }).from(schema.orders).where(eq(schema.orders.referrerId, user.referrerId));
  const now = Date.now();
  const weeks = [3, 2, 1, 0].map((w) => ({ label: `w-${w}`, value: rows.filter((o) => { const age = (now - new Date(o.createdAt).getTime()) / 86400_000; return age >= w * 7 && age < (w + 1) * 7; }).length }));
  const byModality: Record<string, number> = {};
  for (const o of rows) for (const p of o.procedures) byModality[p.modality] = (byModality[p.modality] ?? 0) + 1;
  const completed = rows.filter((o) => o.status === 'completed').length;
  const scheduledOrLater = rows.filter((o) => ['scheduled', 'arrived', 'in_progress', 'completed'].includes(o.status)).length;
  return c.json({ weeks, byModality: Object.entries(byModality).map(([label, value]) => ({ label, value })), totals: { referrals: rows.length, completed, attendancePct: scheduledOrLater ? Math.round((completed / scheduledOrLater) * 100) : 0, open: rows.filter((o) => !['completed', 'cancelled'].includes(o.status)).length } });
});

/* ---------- PAT-facing ---------- */
r.get('/my-orders', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ orders: [] });
  const rows = await c.get('services').db.select().from(schema.orders).where(eq(schema.orders.patientId, user.patientId)).orderBy(desc(schema.orders.createdAt)).limit(50);
  return c.json({ orders: rows });
});

/* ---------- Referrer master ---------- */
r.get('/referrers', allow(...STAFF, 'REF'), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.referrers).where(practiceId ? or(isNull(schema.referrers.practiceId), eq(schema.referrers.practiceId, practiceId)) : undefined).orderBy(schema.referrers.name);
  const counts = await c.get('services').db.select({ referrerId: schema.orders.referrerId, n: sql<number>`count(*)` }).from(schema.orders).groupBy(schema.orders.referrerId);
  return c.json({ referrers: rows.map((x) => ({ ...x, orders: counts.find((k) => k.referrerId === x.id)?.n ?? 0, verificationStale: !x.hpcsaVerifiedAt || Date.now() - new Date(x.hpcsaVerifiedAt).getTime() > 90 * 86400_000 })) });
});
const referrerInput = z.object({ name: z.string().min(2), hpcsaNo: z.string().optional(), bhfPracticeNo: z.string().regex(/^\d{7}$/).optional(), discipline: z.string().optional(), practiceName: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional(), deliveryPrefs: z.object({ whatsapp: z.boolean().optional(), portal: z.boolean().optional(), fhir: z.boolean().optional(), phoneCritical: z.string().optional() }).optional() });
r.post('/referrers', allow('BKG', 'PRM', 'SUP', 'FDK'), async (c) => {
  const data = await body(c, referrerInput);
  const id = newId('ref');
  await c.get('services').db.insert(schema.referrers).values({ id, practiceId: null, status: data.hpcsaNo ? 'provisional' : 'unverified', ...data });
  await audit(c, 'referrer.created', { type: 'referrer', id }, { name: data.name });
  return c.json({ id }, 201);
});
r.patch('/referrers/:id', allow('BKG', 'PRM', 'SUP', 'REF'), async (c) => {
  const id = param(c, 'id');
  const user = c.get('user')!;
  if (user.persona === 'REF' && user.referrerId !== id) throw forbidden();
  const data = await body(c, referrerInput.partial());
  await c.get('services').db.update(schema.referrers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.referrers.id, id));
  await audit(c, 'referrer.updated', { type: 'referrer', id }, { fields: Object.keys(data) });
  return c.json({ ok: true });
});
/** HPCSA verification (demo: format check; a register lookup is an integration port). Never done by a Hand. */
r.post('/referrers/:id/verify', allow('BKG', 'PRM', 'SUP', 'CMP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const [x] = await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, id)).limit(1);
  if (!x) throw notFound('Referrer');
  const ok = !!x.hpcsaNo && /^(MP|DR|PS|CH)\s?\d{6,7}$/i.test(x.hpcsaNo);
  const at = new Date().toISOString();
  await services.db.update(schema.referrers).set(ok ? { hpcsaVerifiedAt: at, status: 'active', updatedAt: at } : { status: 'unverified', updatedAt: at }).where(eq(schema.referrers.id, id));
  await audit(c, 'referrer.verified', { type: 'referrer', id }, { ok, hpcsaNo: x.hpcsaNo, source: 'format-check (demo)' });
  return c.json({ ok, verifiedAt: ok ? at : null });
});

/* Registered last: a bare /:id must not shadow the static routes above. */
r.get('/:id', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const services = c.get('services');
  const [ref] = await services.db.select().from(schema.referrals).where(eq(schema.referrals.id, param(c, 'id'))).limit(1);
  if (!ref) throw notFound('Referral');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && ref.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && ref.referrerId !== user.referrerId) throw forbidden();
  const task = ref.taskId ? (await services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, ref.taskId)).limit(1))[0] : null;
  const order = ref.orderId ? await orderWithContext(services, ref.orderId) : null;
  return c.json({ referral: ref, task: task ?? null, order });
});

r.get('/status', (c) => c.json({ module: 'M04', status: 'ok' }));

export default defineModule({
  code: 'M04', name: 'Referral & Orders', basePath: 'referrals', routes: r,
  boot: async () => {
    registerReferralHand();
    // Order lifecycle follows downstream events by name (docs/processes/01 §7.8).
    on('appointment.booked.v1', async (evt, services) => {
      const orderId = evt.payload['orderId'] as string;
      const [o] = await services.db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
      if (o && ['ordered', 'draft', 'scheduled'].includes(o.status)) {
        await services.db.update(schema.orders).set({ appointmentId: evt.payload['appointmentId'] as string, siteId: evt.payload['siteId'] as string, updatedAt: new Date().toISOString() }).where(eq(schema.orders.id, orderId));
        if (o.status !== 'scheduled') await transitionOrder(services, orderId, 'scheduled', { actor: 'event:appointment.booked' }).catch(() => undefined);
      }
    });
    on('patient.arrived.v1', async (evt, services) => { await transitionOrder(services, evt.payload['orderId'] as string, 'arrived', { actor: 'event:patient.arrived' }).catch(() => undefined); });
    on('study.received.v1', async (evt, services) => { if (evt.payload['orderId']) await transitionOrder(services, evt.payload['orderId'] as string, 'in_progress', { actor: 'event:study.received' }).catch(() => undefined); });
    on('study.completed.v1', async (evt, services) => {
      const orderId = (evt.payload['orderId'] as string | undefined) ?? (await services.db.select({ orderId: schema.appointments.orderId }).from(schema.appointments).where(eq(schema.appointments.id, (evt.payload['appointmentId'] as string) ?? '')).limit(1))[0]?.orderId;
      if (orderId) await transitionOrder(services, orderId, 'completed', { actor: 'event:study.completed' }).catch(() => undefined);
    });
  },
});
