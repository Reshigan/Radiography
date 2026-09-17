import { z } from 'zod';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { PERSONA_HOME, PERSONA_LENS, PERSONAS, newId, notFound, invalid, hashPassword, randomToken } from '@bonakala/domain';
import { defineModule, router, login, logout, selectPractice, requireUser, body, audit, allow, param } from '../../kernel/index.js';

const r = router();
const GOV = ['PRM', 'EXE', 'CMP', 'AIO', 'SUP', 'BIL', 'DEB', 'FDK', 'BKG', 'RGT', 'RAD', 'NUR', 'BIO'] as const;
const USER_ADMIN = ['EXE', 'SUP'] as const;
/** Readable temp password: 4 groups of 4, e.g. K7QF-3ZDR-P2XM-9CLA. Shown once; the user changes it on first sign-in in a real deployment. */
function genTempPassword(): string {
  return randomToken(8).toUpperCase().match(/.{1,4}/g)!.join('-');
}

r.post('/login', async (c) => {
  const { email, password } = await body(c, z.object({ email: z.string().email(), password: z.string().min(1) }));
  const user = await login(c, email, password);
  if (!user) return c.json({ error: 'invalid_credentials' }, 401);
  c.set('user', user);
  await audit(c, 'auth.login', { type: 'user', id: user.id });
  return c.json({ user, home: PERSONA_HOME[user.persona], lens: PERSONA_LENS[user.persona] });
});

r.post('/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

r.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null }, 200);
  const db = c.get('services').db;
  const practices = user.practiceId
    ? await db.select({ id: schema.legalEntities.id, name: schema.legalEntities.tradingName }).from(schema.legalEntities).where(eq(schema.legalEntities.id, user.practiceId))
    : await db.select({ id: schema.legalEntities.id, name: schema.legalEntities.tradingName }).from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  return c.json({ user, practiceId: c.get('practiceId'), practices, home: PERSONA_HOME[user.persona], lens: PERSONA_LENS[user.persona], demo: c.get('services').demoMode });
});

r.post('/select-practice', async (c) => {
  requireUser(c);
  const { practiceId } = await body(c, z.object({ practiceId: z.string().nullable() }));
  await selectPractice(c, practiceId);
  return c.json({ ok: true, practiceId });
});

r.get('/users', allow('EXE', 'SUP', 'PRM', 'CMP'), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, persona: schema.users.persona, practiceId: schema.users.practiceId, hpcsaNo: schema.users.hpcsaNo, status: schema.users.status, lastLoginAt: schema.users.lastLoginAt }).from(schema.users);
  return c.json({ users: practiceId && c.get('user')!.persona === 'PRM' ? rows.filter((u) => u.practiceId === practiceId || u.practiceId === null) : rows });
});

/** Provision a new account. Group personas (EXE/SUP/AIO/BIO/CMP) may be scoped to a practice or left Group-wide. */
r.post('/users', allow(...USER_ADMIN), async (c) => {
  const data = await body(c, z.object({
    name: z.string().min(1), email: z.string().email(), persona: z.enum(PERSONAS),
    practiceId: z.string().nullable().optional(), hpcsaNo: z.string().optional(),
  }));
  const db = c.get('services').db;
  const email = data.email.toLowerCase();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) throw invalid('A user with this email already exists');
  const tempPassword = genTempPassword();
  const id = newId('user');
  await db.insert(schema.users).values({
    id, persona: data.persona, email, name: data.name, practiceId: data.practiceId ?? null,
    hpcsaNo: data.hpcsaNo ?? null, passwordHash: await hashPassword(tempPassword), status: 'active',
  });
  await audit(c, 'user.created', { type: 'user', id }, { persona: data.persona, email, practiceId: data.practiceId ?? null });
  return c.json({ id, tempPassword }, 201);
});

/** Update role, scope, credential number or status. Never touches the password. */
r.patch('/users/:id', allow(...USER_ADMIN), async (c) => {
  const id = param(c, 'id');
  const db = c.get('services').db;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!u) throw notFound('User');
  const data = await body(c, z.object({
    name: z.string().min(1).optional(), persona: z.enum(PERSONAS).optional(), practiceId: z.string().nullable().optional(),
    hpcsaNo: z.string().nullable().optional(), status: z.enum(['active', 'inactive', 'suspended']).optional(),
  }));
  if (id === c.get('user')!.id && data.status && data.status !== 'active') throw invalid('You cannot deactivate your own account');
  await db.update(schema.users).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.users.id, id));
  if (data.status && data.status !== 'active') await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  await audit(c, 'user.updated', { type: 'user', id }, { from: { persona: u.persona, practiceId: u.practiceId, status: u.status }, to: data });
  return c.json({ ok: true });
});

/** Issue a new temporary password (lost credential / compromised account). Shown once in the response. */
r.post('/users/:id/reset-password', allow(...USER_ADMIN), async (c) => {
  const id = param(c, 'id');
  const db = c.get('services').db;
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!u) throw notFound('User');
  const tempPassword = genTempPassword();
  await db.update(schema.users).set({ passwordHash: await hashPassword(tempPassword), updatedAt: new Date().toISOString() }).where(eq(schema.users.id, id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  await audit(c, 'user.password_reset', { type: 'user', id }, {});
  return c.json({ tempPassword });
});

/** Demo helper: list persona sign-ins (only in demo mode). */
r.get('/demo-accounts', async (c) => {
  if (!c.get('services').demoMode) return c.json({ error: 'not_found' }, 404);
  const db = c.get('services').db;
  const rows = await db.select({ email: schema.users.email, persona: schema.users.persona, name: schema.users.name }).from(schema.users);
  return c.json({ password: 'bonakala-demo', accounts: rows });
});

/** Hash-chained audit log, read-side. Governance and platform personas only; filterable by action and object. */
r.get('/audit', allow(...GOV), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const action = c.req.query('action');
  const objectType = c.req.query('objectType');
  const objectId = c.req.query('objectId');
  const where = and(
    practiceId ? or(eq(schema.auditLog.practiceId, practiceId), isNull(schema.auditLog.practiceId)) : undefined,
    action ? eq(schema.auditLog.action, action) : undefined,
    objectType ? eq(schema.auditLog.objectType, objectType) : undefined,
    objectId ? eq(schema.auditLog.objectId, objectId) : undefined,
  );
  const rows = await db.select().from(schema.auditLog).where(where).orderBy(desc(schema.auditLog.createdAt)).limit(100);
  return c.json({ entries: rows });
});

export default defineModule({ code: 'M01', name: 'Identity & Access', basePath: 'auth', routes: r });
