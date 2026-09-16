import { z } from 'zod';
import { and, desc, eq, gte, inArray, like, lt, ne, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, conflict, defineHand, randomToken, forbidden } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, registerHand, runHand, on } from '../../kernel/index.js';
import { getInstanceObject, studyBundle } from './service.js';
import { maskPhone } from '../../sim/telephony.js';

const r = router();
const CLINICAL = ['RAD', 'RGT', 'NUR', 'FDK', 'BKG', 'PRM', 'BIO', 'CMP', 'AIO', 'EXE', 'SUP'] as const;
const WITH_REF = [...CLINICAL, 'REF'] as const;

const priorsHand = defineHand({
  id: 'priors', name: 'Priors Hand', module: 'M09', level: 'A3',
  mandate: 'For every scheduled or acquired study, find prior studies a radiologist would want for comparison, fetch them into hot storage and record what was fetched and why; surface consent gaps to FDK.',
  defaultLeash: { maxFetchMb: 2048, crossPracticeRequiresConsent: true, speculativeFetch: false },
  approvalPersona: 'RGT', approvalPolicy: 'Same-Practice and consented fetches are A3; external fetches under a new agreement are A2 until validated by BIO',
  tools: { search_priors_index: 'R0', read_consent: 'R0', fetch_study: 'R1', warm_tier: 'R1', annotate_worklist_entry: 'R1', request_consent_capture: 'R1', notify_fdk: 'R1' },
});

/* ---------- QIDO-like search ---------- */
r.get('/studies', allow(...WITH_REF, 'PAT'), async (c) => {
  const user = c.get('user')!;
  const q = query(c, z.object({ patientId: z.string().optional(), accession: z.string().optional(), modality: z.string().optional(), siteId: z.string().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(100) }));
  const db = c.get('services').db;
  let scope;
  if (user.persona === 'PAT') scope = eq(schema.studies.patientId, user.patientId ?? '-');
  else if (user.persona === 'REF') scope = eq(schema.studies.referrerId, user.referrerId ?? '-');
  else scope = eq(schema.studies.practiceId, requirePractice(c));
  const rows = await db.select().from(schema.studies).where(and(scope, q.patientId ? eq(schema.studies.patientId, q.patientId) : undefined, q.accession ? eq(schema.studies.accession, q.accession) : undefined, q.modality ? eq(schema.studies.modality, q.modality) : undefined, q.siteId ? eq(schema.studies.siteId, q.siteId) : undefined, q.status ? eq(schema.studies.status, q.status) : undefined, q.from ? gte(schema.studies.receivedAt, q.from) : undefined, q.to ? lt(schema.studies.receivedAt, q.to) : undefined, q.q ? or(like(schema.studies.accession, `%${q.q}%`), like(schema.studies.procedureDescription, `%${q.q}%`)) : undefined)).orderBy(desc(schema.studies.receivedAt)).limit(q.limit);
  const pids = [...new Set(rows.map((s) => s.patientId))];
  const pats = pids.length ? await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  return c.json({ studies: rows.map((s) => ({ ...s, patient: pmap.get(s.patientId) ?? null })) });
});

r.get('/unmatched', allow('RAD', 'FDK', 'BIO', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const rows = await c.get('services').db.select().from(schema.studies).where(and(eq(schema.studies.practiceId, practiceId), eq(schema.studies.unmatched, true))).orderBy(desc(schema.studies.receivedAt));
  return c.json({ studies: rows });
});

r.get('/studies/:id', allow(...WITH_REF, 'PAT'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const b = await studyBundle(services, param(c, 'id'));
  if (!b) throw notFound('Study');
  if (user.persona === 'PAT' && b.study.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && b.study.referrerId !== user.referrerId) throw forbidden();
  await audit(c, 'study.viewed', { type: 'study', id: b.study.id }, { persona: user.persona });
  const [patient] = await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth, idNumber: schema.patients.idNumber }).from(schema.patients).where(eq(schema.patients.id, b.study.patientId)).limit(1);
  return c.json({ ...b, patient: patient ? { ...patient, idNumber: undefined, idNumberMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : null } : null });
});

/* ---------- WADO-like instance fetch ---------- */
r.get('/studies/:id/instances/:instanceId', allow(...WITH_REF, 'PAT'), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, param(c, 'id'))).limit(1);
  if (!study) throw notFound('Study');
  if (user.persona === 'PAT' && study.patientId !== user.patientId) throw forbidden();
  const [inst] = await services.db.select().from(schema.instances).where(and(eq(schema.instances.id, param(c, 'instanceId')), eq(schema.instances.studyId, study.id))).limit(1);
  if (!inst) throw notFound('Instance');
  if (inst.rejected && !['RAD', 'BIO', 'CMP', 'PRM', 'SUP'].includes(user.persona)) throw forbidden('Rejected images are available to QA review only');
  const obj = await getInstanceObject(services, inst, study);
  return new Response(obj.body, { headers: { 'content-type': obj.contentType ?? 'image/svg+xml', 'cache-control': 'private, max-age=3600' } });
});

/* ---------- Priors (Priors Hand) ---------- */
r.get('/patients/:patientId/priors', allow(...CLINICAL), async (c) => {
  const patientId = param(c, 'patientId');
  const { studyId } = query(c, z.object({ studyId: z.string().optional() }));
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const task = await runHand(services, 'priors', { patientId, practiceId, studyId: studyId ?? null }, { practiceId, trigger: 'manual', title: `Priors for patient ${patientId.slice(-6)}`, aggregateType: 'patient', aggregateId: patientId });
  return c.json({ task, priors: (task.output as any)?.priors ?? [], consentGaps: (task.output as any)?.consentGaps ?? [] });
});

/* ---------- Key images and reconciliation ---------- */
r.post('/studies/:id/key-images', allow('RAD', 'RGT', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { instanceIds } = await body(c, z.object({ instanceIds: z.array(z.string()) }));
  await c.get('services').db.update(schema.studies).set({ keyImageIds: instanceIds }).where(eq(schema.studies.id, id));
  await audit(c, 'study.key_images', { type: 'study', id }, { count: instanceIds.length });
  return c.json({ ok: true });
});

/** Study reconciliation for unmatched studies (process 06 §7.1): bind to a worklist item or a patient; original values kept in the audit record. */
r.post('/studies/:id/reconcile', allow('RAD', 'FDK', 'BIO', 'CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { worklistItemId, patientId, reason } = await body(c, z.object({ worklistItemId: z.string().optional(), patientId: z.string().optional(), reason: z.string().min(3) }));
  const services = c.get('services');
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, id)).limit(1);
  if (!study) throw notFound('Study');
  let target = patientId ?? null;
  let item: typeof schema.worklistItems.$inferSelect | undefined;
  if (worklistItemId) {
    [item] = await services.db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, worklistItemId)).limit(1);
    if (!item) throw notFound('Worklist item');
    target = item.patientId;
  }
  if (!target) throw invalid('Provide worklistItemId or patientId');
  const at = services.clock.now().toISOString();
  await services.db.update(schema.studies).set({ patientId: target, unmatched: false, worklistItemId: item?.id ?? study.worklistItemId, orderId: item?.orderId ?? study.orderId, appointmentId: item?.appointmentId ?? study.appointmentId, referrerId: item?.referrerId ?? study.referrerId, updatedAt: at }).where(eq(schema.studies.id, id));
  if (item) await services.db.update(schema.worklistItems).set({ studyId: id, accession: study.accession, status: 'completed', completedAt: at }).where(eq(schema.worklistItems.id, item.id));
  await audit(c, 'study.reconciled', { type: 'study', id }, { from: { patientId: study.patientId, unmatched: study.unmatched }, to: { patientId: target, worklistItemId: item?.id ?? null }, reason });
  await emit(c, 'study.reconciled.v1', { studyId: id, patientId: target, worklistItemId: item?.id ?? null, previousPatientId: study.patientId }, { aggregateType: 'study', aggregateId: id });
  return c.json({ ok: true });
});

r.post('/studies/:id/wrong-patient', allow('BIO', 'CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { patientId, reason } = await body(c, z.object({ patientId: z.string(), reason: z.string().min(5) }));
  const services = c.get('services');
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, id)).limit(1);
  if (!study) throw notFound('Study');
  if (study.patientId === patientId) throw conflict('Study already belongs to this patient');
  await services.db.update(schema.studies).set({ patientId, updatedAt: services.clock.now().toISOString() }).where(eq(schema.studies.id, id));
  await services.db.update(schema.shareLinks).set({ revokedAt: services.clock.now().toISOString() }).where(eq(schema.shareLinks.studyId, id));
  const incidentId = newId('inc');
  await audit(c, 'study.wrong_patient_corrected', { type: 'study', id }, { from: study.patientId, to: patientId, reason, incidentId });
  await emit(c, 'incident.opened.v1', { incidentId, practiceId: study.practiceId, siteId: study.siteId, category: 'wrong_patient_images', severity: 'high', source: 'M09', relatedType: 'study', relatedId: id, description: reason }, { aggregateType: 'incident', aggregateId: incidentId });
  return c.json({ ok: true, incidentId });
});

/* ---------- Sharing links (audited, time-bound, revocable) ---------- */
r.post('/studies/:id/share', allow('FDK', 'RGT', 'REF', 'PAT', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ recipientName: z.string().min(2), recipientMobile: z.string().optional(), scope: z.enum(['study', 'key_images', 'report']).default('study'), consentBasis: z.enum(['patient_initiated', 'referrer_under_referral', 'third_party_with_consent']), days: z.number().min(1).max(90).default(30), reportId: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, id)).limit(1);
  if (!study) throw notFound('Study');
  if (user.persona === 'PAT' && study.patientId !== user.patientId) throw forbidden();
  if (user.persona === 'REF' && study.referrerId !== user.referrerId) throw forbidden();
  const token = randomToken(16);
  const linkId = newId('shr');
  const expiresAt = new Date(services.clock.now().getTime() + data.days * 86400_000).toISOString();
  await services.db.insert(schema.shareLinks).values({ id: linkId, practiceId: study.practiceId, studyId: id, reportId: data.reportId ?? null, token, scope: data.scope, createdBy: user.id, createdByPersona: user.persona, recipientName: data.recipientName, recipientMobileMasked: maskPhone(data.recipientMobile), consentBasis: data.consentBasis, expiresAt, opens: [] });
  await audit(c, 'share_link.created', { type: 'share_link', id: linkId }, { studyId: id, scope: data.scope, consentBasis: data.consentBasis, recipient: data.recipientName });
  await emit(c, 'share_link.created.v1', { shareLinkId: linkId, studyId: id, scope: data.scope }, { aggregateType: 'share_link', aggregateId: linkId });
  return c.json({ id: linkId, token, url: `/api/imaging/share/${token}`, expiresAt }, 201);
});
r.get('/studies/:id/shares', allow('FDK', 'RGT', 'PRM', 'CMP', 'SUP'), async (c) => {
  const rows = await c.get('services').db.select().from(schema.shareLinks).where(eq(schema.shareLinks.studyId, param(c, 'id'))).orderBy(desc(schema.shareLinks.createdAt));
  return c.json({ links: rows.map((l) => ({ ...l, token: undefined })) });
});
r.post('/share/:linkId/revoke', allow('FDK', 'RGT', 'PRM', 'CMP', 'PAT', 'REF', 'SUP'), async (c) => {
  const linkId = param(c, 'linkId');
  const services = c.get('services');
  await services.db.update(schema.shareLinks).set({ revokedAt: services.clock.now().toISOString() }).where(eq(schema.shareLinks.id, linkId));
  await audit(c, 'share_link.revoked', { type: 'share_link', id: linkId });
  return c.json({ ok: true });
});
/** Open a share link (OTP simulated by the `otp` query in demo mode). Every open is logged. */
r.get('/share/:token', async (c) => {
  const services = c.get('services');
  const token = param(c, 'token');
  const [link] = await services.db.select().from(schema.shareLinks).where(eq(schema.shareLinks.token, token)).limit(1);
  const now = services.clock.now().toISOString();
  if (!link || link.revokedAt || link.expiresAt < now) return c.json({ error: 'link_unavailable', message: 'This link has expired or was revoked' }, 410);
  const otpVerified = c.req.query('otp') === '000000' || !!c.get('user');
  await services.db.update(schema.shareLinks).set({ opens: [...link.opens, { at: now, otpVerified }] }).where(eq(schema.shareLinks.id, link.id));
  await audit(c, 'share_link.opened', { type: 'share_link', id: link.id }, { otpVerified });
  if (!otpVerified) return c.json({ otpRequired: true, recipientName: link.recipientName, message: 'Enter the one-time code sent to your mobile' }, 401);
  const b = await studyBundle(services, link.studyId);
  if (!b) throw notFound('Study');
  const inst = link.scope === 'key_images' ? b.instances.filter((i) => (b.study.keyImageIds ?? []).includes(i.id)) : b.instances;
  return c.json({ recipientName: link.recipientName, scope: link.scope, watermark: `${link.recipientName} · ${now.slice(0, 10)} · not for diagnostic use`, study: { accession: b.study.accession, modality: b.study.modality, procedureDescription: b.study.procedureDescription, receivedAt: b.study.receivedAt }, instances: inst.filter((i) => !i.rejected).map((i) => ({ id: i.id, url: `/api/imaging/share/${token}/instances/${i.id}` })) });
});
r.get('/share/:token/instances/:instanceId', async (c) => {
  const services = c.get('services');
  const [link] = await services.db.select().from(schema.shareLinks).where(eq(schema.shareLinks.token, param(c, 'token'))).limit(1);
  if (!link || link.revokedAt || link.expiresAt < services.clock.now().toISOString()) return c.json({ error: 'link_unavailable' }, 410);
  const [inst] = await services.db.select().from(schema.instances).where(and(eq(schema.instances.id, param(c, 'instanceId')), eq(schema.instances.studyId, link.studyId))).limit(1);
  if (!inst || inst.rejected) throw notFound('Instance');
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, link.studyId)).limit(1);
  const obj = await getInstanceObject(services, inst, study!);
  return new Response(obj.body, { headers: { 'content-type': obj.contentType ?? 'image/svg+xml' } });
});

r.get('/status', (c) => c.json({ module: 'M09', status: 'ok' }));

export default defineModule({
  code: 'M09', name: 'Image Management', basePath: 'imaging', routes: r,
  boot(services) {
    registerHand<{ patientId: string; practiceId: string; studyId: string | null }, { priors: unknown[]; consentGaps: unknown[] }>(priorsHand, async (input, ctx) => {
      const [pat] = await ctx.step('read_consent', { patientId: input.patientId }, async () => services.db.select({ consents: schema.patients.consents, idNumber: schema.patients.idNumber, practiceId: schema.patients.practiceId }).from(schema.patients).where(eq(schema.patients.id, input.patientId)).limit(1));
      const consented = !!pat?.consents?.imaging_sharing?.granted || !!pat?.consents?.continuity_of_care?.granted;
      // Same practice: automatic. Cross-practice: only with consent (leash). The network index links patients across practices by verified ID number.
      const same = await ctx.step('search_priors_index', { practiceId: input.practiceId }, async () => services.db.select().from(schema.studies).where(and(eq(schema.studies.patientId, input.patientId), input.studyId ? ne(schema.studies.id, input.studyId) : undefined)).orderBy(desc(schema.studies.receivedAt)).limit(10));
      const consentGaps: Array<{ practiceId: string; count: number }> = [];
      let cross: (typeof schema.studies.$inferSelect)[] = [];
      if (pat?.idNumber) {
        const linked = await services.db.select({ id: schema.patients.id, practiceId: schema.patients.practiceId }).from(schema.patients).where(and(eq(schema.patients.idNumber, pat.idNumber), ne(schema.patients.practiceId, input.practiceId)));
        for (const l of linked) {
          const rows = await services.db.select().from(schema.studies).where(eq(schema.studies.patientId, l.id)).orderBy(desc(schema.studies.receivedAt)).limit(10);
          if (!rows.length) continue;
          if (consented) cross = cross.concat(rows);
          else consentGaps.push({ practiceId: l.practiceId, count: rows.length });
        }
      }
      ctx.leashCheck([{ rule: 'crossPracticeRequiresConsent', actual: consented || consentGaps.length === 0 || cross.length === 0, compare: 'eq' }]);
      const priors = [...same, ...cross].map((s) => ({ id: s.id, accession: s.accession, modality: s.modality, procedureDescription: s.procedureDescription, bodyPart: s.bodyPart, receivedAt: s.receivedAt, siteId: s.siteId, practiceId: s.practiceId, status: s.status, external: s.practiceId !== input.practiceId }));
      if (priors.length) await ctx.step('warm_tier', { count: priors.length }, async () => priors.length);
      if (input.studyId && priors.length) await ctx.step('annotate_worklist_entry', { studyId: input.studyId }, async () => services.db.update(schema.studies).set({ priorIds: priors.slice(0, 5).map((p) => p.id) }).where(eq(schema.studies.id, input.studyId!)));
      if (consentGaps.length) await ctx.step('request_consent_capture', { consentGaps }, async () => consentGaps.length);
      return { priors, consentGaps };
    });
    on('study.received.v1', async (evt) => {
      const p = evt.payload as { studyId: string; patientId: string; practiceId: string; unmatched?: boolean };
      if (p.unmatched) return;
      await runHand(services, 'priors', { patientId: p.patientId, practiceId: p.practiceId, studyId: p.studyId }, { practiceId: p.practiceId, trigger: 'study.received.v1', title: 'Priors fetch', aggregateType: 'study', aggregateId: p.studyId });
    });
  },
});
