import { z } from 'zod';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, forbidden, invalid } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { registerFunderSim } from '../../sim/funder.js';
import { collectCard, ensureFundingCase, fundingForOrder, registerAuthorisationHand, runAuthorisationHand } from './service.js';

const r = router();
const STAFF = ['FDK', 'BKG', 'PRM', 'BIL', 'DEB', 'EXE', 'SUP', 'CMP', 'RAD', 'NUR', 'RGT'] as const;

/* ---------- Funder master ---------- */
r.get('/funders', allow(...STAFF, 'REF', 'PAT', 'PAY'), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.funders).where(practiceId ? or(isNull(schema.funders.practiceId), eq(schema.funders.practiceId, practiceId)) : undefined).orderBy(schema.funders.type, schema.funders.name);
  return c.json({ funders: rows });
});
const funderInput = z.object({ type: z.enum(['scheme', 'raf', 'coida', 'corporate', 'cash', 'state']), code: z.string().min(2), name: z.string().min(2), administrator: z.string().optional(), options: z.array(z.string()).default([]), dsp: z.boolean().default(false), rules: z.object({ authRequiredModalities: z.array(z.string()).default([]), authByOption: z.record(z.array(z.string())).optional(), networkCoPayPct: z.number().optional(), networkOptions: z.array(z.string()).optional(), networkSiteIds: z.array(z.string()).optional(), ratePct: z.number().optional(), turnaroundHours: z.number().optional(), cashDiscountPct: z.number().optional() }).default({ authRequiredModalities: [] }), contact: z.object({ auth: z.string().optional(), queries: z.string().optional(), claims: z.string().optional() }).optional() });
r.post('/funders', allow('BIL', 'PRM', 'EXE', 'SUP'), async (c) => {
  const data = await body(c, funderInput);
  const id = newId('fdr');
  await c.get('services').db.insert(schema.funders).values({ id, practiceId: c.get('practiceId'), ...data });
  await audit(c, 'funder.created', { type: 'funder', id }, { code: data.code });
  return c.json({ id }, 201);
});
r.patch('/funders/:id', allow('BIL', 'PRM', 'EXE', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, funderInput.partial());
  await c.get('services').db.update(schema.funders).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.funders.id, id));
  await audit(c, 'funder.updated', { type: 'funder', id }, { fields: Object.keys(data) });
  return c.json({ ok: true });
});

/* ---------- Cases ---------- */
r.get('/cases', allow(...STAFF), async (c) => {
  const practiceId = requirePractice(c);
  const { status, limit } = query(c, z.object({ status: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200) }));
  const db = c.get('services').db;
  const rows = await db.select().from(schema.fundingCases).where(and(eq(schema.fundingCases.practiceId, practiceId), status ? inArray(schema.fundingCases.status, status.split(',')) : undefined)).orderBy(desc(schema.fundingCases.updatedAt)).limit(limit);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const patients = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const oids = [...new Set(rows.map((x) => x.orderId))];
  const orders = oids.length ? await db.select({ id: schema.orders.id, orderNo: schema.orders.orderNo, procedures: schema.orders.procedures, priority: schema.orders.priority, status: schema.orders.status }).from(schema.orders).where(inArray(schema.orders.id, oids)) : [];
  return c.json({ cases: rows.map((x) => ({ ...x, memberNo: x.memberNo ? `····${x.memberNo.slice(-4)}` : null, patient: patients.find((p) => p.id === x.patientId) ?? null, order: orders.find((o) => o.id === x.orderId) ?? null })) });
});

r.post('/cases', allow(...STAFF, 'PAT', 'REF'), async (c) => {
  const { orderId, funderType, funderCode, memberNo, schemeOption, thirdPartyRef, siteId } = await body(c, z.object({ orderId: z.string(), funderType: z.enum(['scheme', 'cash', 'raf', 'coida', 'corporate']).optional(), funderCode: z.string().optional(), memberNo: z.string().optional(), schemeOption: z.string().optional(), thirdPartyRef: z.string().optional(), siteId: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [o] = await services.db.select({ patientId: schema.orders.patientId, referrerId: schema.orders.referrerId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && o.referrerId !== user.referrerId) throw forbidden();
  const res = await ensureFundingCase(services, orderId, { c, funderType, funderCode, memberNo, schemeOption, thirdPartyRef, siteId, actor: user.id });
  await audit(c, 'funding.checked', { type: 'funding_case', id: res.fundingCase.id }, { result: res.fundingCase.benefitCheck?.result, patientPortionCents: res.fundingCase.patientPortionCents });
  return c.json(res, 201);
});

r.get('/cases/:id', allow(...STAFF, 'PAT'), async (c) => {
  const services = c.get('services');
  const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, param(c, 'id'))).limit(1);
  if (!fc) throw notFound('Funding case');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && fc.patientId !== user.patientId) throw forbidden();
  return c.json(await fundingForOrder(services, fc.orderId));
});

r.post('/cases/:id/benefit-check', allow(...STAFF), async (c) => {
  const services = c.get('services');
  const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, param(c, 'id'))).limit(1);
  if (!fc) throw notFound('Funding case');
  const res = await ensureFundingCase(services, fc.orderId, { c, actor: c.get('user')!.id });
  await audit(c, 'funding.rechecked', { type: 'funding_case', id: fc.id }, { result: res.fundingCase.benefitCheck?.result });
  return c.json(res);
});

r.post('/cases/:id/authorise', allow('BIL', 'BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, id)).limit(1);
  if (!fc) throw notFound('Funding case');
  const task = await runAuthorisationHand(services, id, fc.practiceId, 'manual');
  await audit(c, 'funding.auth_requested', { type: 'funding_case', id }, { taskId: task.id, status: task.status });
  return c.json({ task, funding: await fundingForOrder(services, fc.orderId) });
});

r.post('/cases/:id/proceed-at-risk', allow('PAT', 'FDK', 'BKG'), async (c) => {
  const id = param(c, 'id');
  const { acknowledged, evidence } = await body(c, z.object({ acknowledged: z.literal(true), evidence: z.string().default('tap') }));
  const services = c.get('services');
  const [fc] = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.id, id)).limit(1);
  if (!fc) throw notFound('Funding case');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && fc.patientId !== user.patientId) throw forbidden();
  if (user.persona !== 'PAT' && !acknowledged) throw invalid('Patient acknowledgement is required');
  const at = new Date().toISOString();
  await services.db.update(schema.fundingCases).set({ status: 'proceed_at_risk', proceedAtRiskAt: at, patientPortionCents: fc.totalCents, schemePortionCents: 0, reasonCodes: [...fc.reasonCodes, 'PROCEED_AT_RISK'], updatedAt: at }).where(eq(schema.fundingCases.id, id));
  await audit(c, 'funding.proceed_at_risk', { type: 'funding_case', id }, { evidence, by: user.persona });
  await emit(c, 'funding.proceed_at_risk.v1', { fundingCaseId: id, orderId: fc.orderId, patientId: fc.patientId }, { aggregateType: 'funding_case', aggregateId: id });
  return c.json({ ok: true });
});

r.post('/cases/:id/status', allow('BIL', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { status, note } = await body(c, z.object({ status: z.enum(['unknown', 'checking', 'quoted', 'auth_requested', 'auth_more_info', 'authorised', 'auth_declined', 'proceed_at_risk', 'deposit_due', 'ready_to_bill', 'expired', 'contract']), note: z.string().optional() }));
  await c.get('services').db.update(schema.fundingCases).set({ status, notes: note, updatedAt: new Date().toISOString() }).where(eq(schema.fundingCases.id, id));
  await audit(c, 'funding.status', { type: 'funding_case', id }, { status, note });
  await emit(c, `funding.${status}.v1`, { fundingCaseId: id, status, note }, { aggregateType: 'funding_case', aggregateId: id });
  return c.json({ ok: true });
});

/* ---------- Per-order views ---------- */
r.get('/orders/:orderId', allow(...STAFF, 'PAT', 'REF'), async (c) => {
  const services = c.get('services');
  const orderId = param(c, 'orderId');
  const [o] = await services.db.select({ patientId: schema.orders.patientId, referrerId: schema.orders.referrerId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && o.referrerId !== user.referrerId) throw forbidden();
  const f = await fundingForOrder(services, orderId);
  return c.json(f ?? { fundingCase: null, quote: null, authorisations: [] });
});

r.get('/collect/:orderId', allow(...STAFF, 'PAT'), async (c) => {
  const services = c.get('services');
  const orderId = param(c, 'orderId');
  const [o] = await services.db.select({ patientId: schema.orders.patientId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  if (c.get('user')!.persona === 'PAT' && o.patientId !== c.get('user')!.patientId) throw forbidden();
  return c.json({ collect: await collectCard(services, orderId) });
});

r.get('/quotes/:id', allow(...STAFF, 'PAT', 'REF'), async (c) => {
  const [q] = await c.get('services').db.select().from(schema.quotes).where(eq(schema.quotes.id, param(c, 'id'))).limit(1);
  if (!q) throw notFound('Quote');
  if (c.get('user')!.persona === 'PAT' && q.patientId !== c.get('user')!.patientId) throw forbidden();
  return c.json({ quote: q });
});

r.post('/quotes/:id/accept', allow('PAT', 'FDK', 'BKG'), async (c) => {
  const id = param(c, 'id');
  const { via } = await body(c, z.object({ via: z.enum(['patient_space', 'whatsapp', 'desk', 'phone']).default('patient_space') }));
  const services = c.get('services');
  const [q] = await services.db.select().from(schema.quotes).where(eq(schema.quotes.id, id)).limit(1);
  if (!q) throw notFound('Quote');
  if (c.get('user')!.persona === 'PAT' && q.patientId !== c.get('user')!.patientId) throw forbidden();
  await services.db.update(schema.quotes).set({ acceptedAt: new Date().toISOString(), acceptedVia: via }).where(eq(schema.quotes.id, id));
  await audit(c, 'quote.accepted', { type: 'quote', id }, { via, version: q.version });
  return c.json({ ok: true });
});

r.get('/mine', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ cases: [] });
  const services = c.get('services');
  const rows = await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.patientId, user.patientId)).orderBy(desc(schema.fundingCases.updatedAt)).limit(20);
  const out = [];
  for (const fc of rows) {
    const [order] = await services.db.select({ id: schema.orders.id, procedures: schema.orders.procedures, status: schema.orders.status, appointmentId: schema.orders.appointmentId }).from(schema.orders).where(eq(schema.orders.id, fc.orderId)).limit(1);
    out.push({ ...fc, memberNo: fc.memberNo ? `····${fc.memberNo.slice(-4)}` : null, order: order ?? null, collect: await collectCard(services, fc.orderId) });
  }
  return c.json({ cases: out });
});

r.get('/analytics', allow('BIL', 'PRM', 'EXE', 'SUP', 'BKG', 'DEB'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const byStatus = await db.select({ status: schema.fundingCases.status, n: sql<number>`count(*)`, patient: sql<number>`coalesce(sum(patient_portion_cents),0)`, scheme: sql<number>`coalesce(sum(scheme_portion_cents),0)` }).from(schema.fundingCases).where(eq(schema.fundingCases.practiceId, practiceId)).groupBy(schema.fundingCases.status);
  const auths = await db.select({ status: schema.authorisations.status, n: sql<number>`count(*)` }).from(schema.authorisations).where(eq(schema.authorisations.practiceId, practiceId)).groupBy(schema.authorisations.status);
  return c.json({ byStatus, authorisations: auths });
});

r.get('/status', (c) => c.json({ module: 'M06', status: 'ok' }));

export default defineModule({
  code: 'M06', name: 'Funding & Authorisation', basePath: 'funding', routes: r,
  boot: async () => {
    registerAuthorisationHand();
    registerFunderSim();
    // Every new order gets a funding position (benefit check + binding quote) without a human touch (A3).
    on('order.created.v1', async (evt, services) => {
      const orderId = evt.payload['orderId'] as string;
      const [existing] = await services.db.select({ id: schema.fundingCases.id }).from(schema.fundingCases).where(eq(schema.fundingCases.orderId, orderId)).limit(1);
      if (!existing) await ensureFundingCase(services, orderId, { actor: 'event:order.created' });
    });
    on('funding.quoted.v1', async (evt, services) => {
      if (evt.payload['authRequired'] && evt.payload['authStatus'] === 'pending') {
        const id = evt.payload['fundingCaseId'] as string;
        await services.db.update(schema.fundingCases).set({ status: 'auth_requested', authStatus: 'requested' }).where(and(eq(schema.fundingCases.id, id), eq(schema.fundingCases.authStatus, 'pending')));
        await runAuthorisationHand(services, id, evt.practiceId ?? (evt.payload['practiceId'] as string));
      }
    });
  },
});
