import { eq } from 'drizzle-orm';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { schema } from '@bonakala/db';
import { GROUP_PERSONAS, randomToken, verifyPassword, type Persona } from '@bonakala/domain';
import type { AppContext, AuthUser } from './context.js';

const COOKIE = 'bnk_session';
const SESSION_HOURS = 12;

export async function loadUserFromRequest(c: AppContext): Promise<{ user: AuthUser | null; practiceId: string | null }> {
  const token = getCookie(c, COOKIE) ?? c.req.header('authorization')?.replace(/^Bearer /i, '');
  if (!token) return { user: null, practiceId: null };
  const db = c.get('services').db;
  const rows = await db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.token, token))
    .limit(1);
  const row = rows[0];
  if (!row || row.s.expiresAt < new Date().toISOString() || row.u.status !== 'active') return { user: null, practiceId: null };
  const user: AuthUser = {
    id: row.u.id, persona: row.u.persona as Persona, name: row.u.name, email: row.u.email,
    practiceId: row.u.practiceId, siteIds: row.u.siteIds, patientId: row.u.patientId, referrerId: row.u.referrerId, hpcsaNo: row.u.hpcsaNo,
  };
  const header = c.req.header('x-practice-id');
  let practiceId = user.practiceId;
  if (!practiceId && (GROUP_PERSONAS.includes(user.persona) || user.persona === 'REF' || user.persona === 'PAY')) {
    practiceId = header ?? row.s.practiceId ?? null;
  }
  return { user, practiceId };
}

export async function login(c: AppContext, email: string, password: string): Promise<AuthUser | null> {
  const db = c.get('services').db;
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
  const u = rows[0];
  if (!u || u.status !== 'active') return null;
  if (!(await verifyPassword(password, u.passwordHash))) return null;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  await db.insert(schema.sessions).values({ token, userId: u.id, practiceId: u.practiceId, expiresAt });
  await db.update(schema.users).set({ lastLoginAt: new Date().toISOString() }).where(eq(schema.users.id, u.id));
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: c.req.url.startsWith('https'), maxAge: SESSION_HOURS * 3600 });
  return {
    id: u.id, persona: u.persona as Persona, name: u.name, email: u.email, practiceId: u.practiceId,
    siteIds: u.siteIds, patientId: u.patientId, referrerId: u.referrerId, hpcsaNo: u.hpcsaNo,
  };
}

export async function logout(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.get('services').db.delete(schema.sessions).where(eq(schema.sessions.token, token));
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function selectPractice(c: AppContext, practiceId: string | null): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.get('services').db.update(schema.sessions).set({ practiceId }).where(eq(schema.sessions.token, token));
}

/** Route guard: allowed personas. Group personas pass when listed. */
export function allow(...personas: Persona[]) {
  return async (c: AppContext, next: () => Promise<void>) => {
    const u = c.get('user');
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    if (personas.length && !personas.includes(u.persona)) return c.json({ error: 'forbidden', persona: u.persona }, 403);
    await next();
  };
}
