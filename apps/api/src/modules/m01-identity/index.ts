import { z } from 'zod';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { PERSONA_HOME, PERSONA_LENS } from '@bonakala/domain';
import { defineModule, router, login, logout, selectPractice, requireUser, body, audit, allow } from '../../kernel/index.js';

const r = router();
const GOV = ['PRM', 'EXE', 'CMP', 'AIO', 'SUP', 'BIL', 'DEB', 'FDK', 'BKG', 'RGT', 'RAD', 'NUR', 'BIO'] as const;

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
