import type { z } from 'zod';
import type { AppContext } from './context.js';

/** Parse the JSON body against a zod schema; throws a 400 DomainError-like on failure. */
export async function body<T extends z.ZodTypeAny>(c: AppContext, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => ({}));
  const r = schema.safeParse(json);
  if (!r.success) throw Object.assign(new Error('Invalid request body'), { status: 400, code: 'invalid', details: r.error.flatten() });
  return r.data;
}
export function query<T extends z.ZodTypeAny>(c: AppContext, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw Object.assign(new Error('Invalid query'), { status: 400, code: 'invalid', details: r.error.flatten() });
  return r.data;
}

/** Route parameter that must exist. */
export function param(c: AppContext, name: string): string {
  const v = c.req.param(name as never) as string | undefined;
  if (!v) throw Object.assign(new Error(`Missing route parameter ${name}`), { status: 400, code: 'invalid' });
  return v;
}
