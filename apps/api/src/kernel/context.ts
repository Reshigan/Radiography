import type { Context } from 'hono';
import type { Persona } from '@bonakala/domain';
import type { Services } from './ports.js';

export interface AuthUser {
  id: string;
  persona: Persona;
  name: string;
  email: string;
  practiceId: string | null; // null = Group scope
  siteIds: string[] | null;
  patientId: string | null;
  referrerId: string | null;
  hpcsaNo: string | null;
}

export type AppEnv = {
  Bindings: Record<string, unknown>;
  Variables: {
    services: Services;
    user: AuthUser | null;
    /** Effective tenant for this request (user's practice or the selected practice for Group users). */
    practiceId: string | null;
    requestId: string;
  };
};

export type AppContext = Context<AppEnv>;

export function svc(c: AppContext): Services {
  return c.get('services');
}
export function db(c: AppContext) {
  return c.get('services').db;
}
export function requireUser(c: AppContext): AuthUser {
  const u = c.get('user');
  if (!u) throw Object.assign(new Error('Unauthenticated'), { status: 401, code: 'unauthenticated' });
  return u;
}
/** The tenant this request operates on; throws when a Group user has not selected a practice. */
export function requirePractice(c: AppContext): string {
  const p = c.get('practiceId');
  if (!p) throw Object.assign(new Error('Select a practice (x-practice-id)'), { status: 400, code: 'practice_required' });
  return p;
}
