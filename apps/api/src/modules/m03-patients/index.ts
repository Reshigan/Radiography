import { z } from 'zod';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { luhnCheckDigit, maskId, newId, parseSaId, invalid, notFound } from '@bonakala/domain';
import { defineModule, router, allow, body, query, audit, emit, requirePractice, nextSequence, param } from '../../kernel/index.js';

const r = router();
const CLINICAL = ['FDK', 'BKG', 'RAD', 'RGT', 'NUR', 'BIL', 'DEB', 'PRM', 'EXE', 'SUP', 'CMP'] as const;

function present(p: typeof schema.patients.$inferSelect, full = false) {
  return { ...p, idNumberMasked: maskId(p.idNumber), idNumber: full ? p.idNumber : undefined };
}

r.get('/', allow(...CLINICAL), async (c) => {
  const practiceId = requirePractice(c);
  const { q, limit } = query(c, z.object({ q: z.string().optional(), limit: z.coerce.number().min(1).max(200).default(50) }));
  const db = c.get('services').db;
  const where = q
    ? and(eq(schema.patients.practiceId, practiceId), or(like(schema.patients.lastName, `%${q}%`), like(schema.patients.firstName, `%${q}%`), like(schema.patients.idNumber, `%${q}%`), like(schema.patients.mobile, `%${q}%`), like(schema.patients.epid, `%${q}%`)))
    : eq(schema.patients.practiceId, practiceId);
  const rows = await db.select().from(schema.patients).where(where).orderBy(schema.patients.lastName).limit(limit);
  return c.json({ patients: rows.map((p) => present(p)) });
});

r.get('/me', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ error: 'no_patient' }, 404);
  const [p] = await c.get('services').db.select().from(schema.patients).where(eq(schema.patients.id, user.patientId)).limit(1);
  if (!p) throw notFound('Patient');
  return c.json({ patient: present(p, true) });
});

r.get('/:id', allow(...CLINICAL, 'REF'), async (c) => {
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, param(c, 'id'))).limit(1);
  if (!p) throw notFound('Patient');
  const full = ['FDK', 'BKG', 'PRM'].includes(c.get('user')!.persona);
  await audit(c, 'patient.viewed', { type: 'patient', id: p.id });
  return c.json({ patient: present(p, full) });
});

const patientInput = z.object({
  firstName: z.string().min(1), lastName: z.string().min(1), dateOfBirth: z.string().optional(), sex: z.enum(['F', 'M', 'X']).optional(),
  language: z.string().default('en'), mobile: z.string().optional(), email: z.string().email().optional(),
  idType: z.enum(['sa_id', 'passport', 'none', 'temp']).default('none'), idNumber: z.string().optional(), idCountry: z.string().optional(),
  schemeId: z.string().optional(), schemeName: z.string().optional(), schemeOption: z.string().optional(), memberNo: z.string().optional(), dependantCode: z.string().optional(),
  address: z.string().optional(), guardianPatientId: z.string().optional(),
});

r.post('/', allow('FDK', 'BKG', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, patientInput);
  const db = c.get('services').db;
  if (data.idType === 'sa_id') {
    const info = parseSaId(data.idNumber ?? '');
    if (!info.valid) throw invalid('SA ID number fails the check digit or date');
    data.dateOfBirth ??= info.dateOfBirth;
    data.sex ??= info.sex;
    const dup = await db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName }).from(schema.patients).where(and(eq(schema.patients.practiceId, practiceId), eq(schema.patients.idNumber, data.idNumber!))).limit(1);
    if (dup.length) return c.json({ error: 'duplicate', message: 'A patient with this ID number already exists', existing: dup[0] }, 409);
  }
  const seq = await nextSequence(c.get('services'), 'epid');
  const base = String(100000000000 + seq * 7919).slice(0, 11);
  const epid = base + luhnCheckDigit(base);
  const id = newId('pat');
  await db.insert(schema.patients).values({ id, practiceId, epid, ...data, consents: {}, flags: [] });
  await audit(c, 'patient.created', { type: 'patient', id });
  await emit(c, 'patient.created.v1', { patientId: id, epid }, { aggregateType: 'patient', aggregateId: id });
  return c.json({ id, epid }, 201);
});

r.patch('/:id', allow('FDK', 'BKG', 'PRM', 'SUP', 'PAT'), async (c) => {
  const id = param(c, 'id');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && user.patientId !== id) return c.json({ error: 'forbidden' }, 403);
  const data = await body(c, patientInput.partial());
  const db = c.get('services').db;
  await db.update(schema.patients).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.patients.id, id));
  await audit(c, 'patient.updated', { type: 'patient', id }, { fields: Object.keys(data) });
  return c.json({ ok: true });
});

r.post('/:id/verify-id', allow('FDK', 'BKG', 'PRM'), async (c) => {
  const id = param(c, 'id');
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, id)).limit(1);
  if (!p) throw notFound('Patient');
  const info = p.idType === 'sa_id' ? parseSaId(p.idNumber ?? '') : { valid: !!p.idNumber };
  if (!info.valid) return c.json({ ok: false, reason: 'invalid_id' }, 400);
  const at = new Date().toISOString();
  await db.update(schema.patients).set({ idVerifiedAt: at }).where(eq(schema.patients.id, id));
  await audit(c, 'patient.id_verified', { type: 'patient', id });
  return c.json({ ok: true, verifiedAt: at, info });
});

r.post('/:id/consents', allow('FDK', 'PAT', 'BKG', 'NUR', 'RAD'), async (c) => {
  const id = param(c, 'id');
  const { consents, channel } = await body(c, z.object({ consents: z.record(z.boolean()), channel: z.string().default('desk') }));
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, id)).limit(1);
  if (!p) throw notFound('Patient');
  const at = new Date().toISOString();
  const merged = { ...(p.consents ?? {}) };
  for (const [k, v] of Object.entries(consents)) merged[k] = { granted: v, at, channel };
  await db.update(schema.patients).set({ consents: merged, updatedAt: at }).where(eq(schema.patients.id, id));
  await audit(c, 'patient.consent', { type: 'patient', id }, { consents, channel });
  return c.json({ consents: merged });
});

/** Duplicate candidates for the PMI (same surname + DOB, or same mobile). */
r.get('/:id/duplicates', allow('FDK', 'BKG', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, id)).limit(1);
  if (!p) throw notFound('Patient');
  const rows = await db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, p.practiceId), sql`${schema.patients.id} != ${id}`, or(and(eq(schema.patients.lastName, p.lastName), eq(schema.patients.dateOfBirth, p.dateOfBirth ?? '')), p.mobile ? eq(schema.patients.mobile, p.mobile) : sql`0`)));
  return c.json({ candidates: rows.map((x) => ({ ...present(x), score: x.idNumber && x.idNumber === p.idNumber ? 0.99 : 0.7 })) });
});

r.post('/:id/merge', allow('PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { intoId } = await body(c, z.object({ intoId: z.string() }));
  const db = c.get('services').db;
  await db.update(schema.patients).set({ status: 'merged', mergedIntoId: intoId }).where(eq(schema.patients.id, id));
  await audit(c, 'patient.merged', { type: 'patient', id }, { intoId });
  await emit(c, 'patient.merged.v1', { patientId: id, intoId }, { aggregateType: 'patient', aggregateId: id });
  return c.json({ ok: true });
});

export default defineModule({ code: 'M03', name: 'Patient Master Index', basePath: 'patients', routes: r });
