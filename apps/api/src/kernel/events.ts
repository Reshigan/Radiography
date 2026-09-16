import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, sha256Hex } from '@bonakala/domain';
import type { AppContext } from './context.js';
import type { Services } from './ports.js';

export type EventHandler = (evt: { id: string; name: string; practiceId: string | null; payload: Record<string, unknown>; aggregateId: string | null }, services: Services) => Promise<void>;

const handlers = new Map<string, EventHandler[]>();

/** Subscribe a handler to an event name; '*' receives everything. Modules and Hands register at boot. */
export function on(name: string, handler: EventHandler) {
  const list = handlers.get(name) ?? [];
  list.push(handler);
  handlers.set(name, list);
}

/** Write a domain event to the outbox and schedule dispatch after the response. */
export async function emit(c: AppContext, name: string, payload: Record<string, unknown>, opts: { aggregateType?: string; aggregateId?: string; practiceId?: string | null } = {}) {
  const services = c.get('services');
  const user = c.get('user');
  const id = newId('evt');
  await services.db.insert(schema.events).values({
    id, name, payload, practiceId: opts.practiceId ?? c.get('practiceId') ?? null,
    aggregateType: opts.aggregateType ?? null, aggregateId: opts.aggregateId ?? null, actorUserId: user?.id ?? null,
  });
  services.defer(dispatchPending(services));
  return id;
}

/** Emit outside a request (jobs, simulators). */
export async function emitDirect(services: Services, name: string, payload: Record<string, unknown>, opts: { aggregateType?: string; aggregateId?: string; practiceId?: string | null } = {}) {
  const id = newId('evt');
  await services.db.insert(schema.events).values({ id, name, payload, practiceId: opts.practiceId ?? null, aggregateType: opts.aggregateType ?? null, aggregateId: opts.aggregateId ?? null });
  services.defer(dispatchPending(services));
  return id;
}

let dispatching = false;
export async function dispatchPending(services: Services, max = 100): Promise<number> {
  if (dispatching) return 0;
  dispatching = true;
  let n = 0;
  try {
    const rows = await services.db
      .select()
      .from(schema.events)
      .where(and(isNull(schema.events.processedAt), lt(schema.events.attempts, 5)))
      .orderBy(schema.events.createdAt)
      .limit(max);
    for (const row of rows) {
      const list = [...(handlers.get(row.name) ?? []), ...(handlers.get('*') ?? [])];
      let error: string | null = null;
      for (const h of list) {
        try {
          await h({ id: row.id, name: row.name, practiceId: row.practiceId, payload: row.payload, aggregateId: row.aggregateId }, services);
        } catch (e) {
          error = (e as Error).message;
          console.error('event handler failed', row.name, e);
        }
      }
      await services.db
        .update(schema.events)
        .set(error ? { attempts: sql`${schema.events.attempts} + 1`, error } : { processedAt: new Date().toISOString(), error: null })
        .where(eq(schema.events.id, row.id));
      n++;
    }
  } finally {
    dispatching = false;
  }
  return n;
}

let lastHash = '';
/** Append-only, hash-chained audit log. */
export async function audit(c: AppContext, action: string, object?: { type: string; id: string }, details?: Record<string, unknown>) {
  const services = c.get('services');
  const user = c.get('user');
  const createdAt = new Date().toISOString();
  const id = newId('aud');
  const hash = await sha256Hex(`${lastHash}|${id}|${action}|${object?.type ?? ''}|${object?.id ?? ''}|${createdAt}|${JSON.stringify(details ?? {})}`);
  await services.db.insert(schema.auditLog).values({
    id, practiceId: c.get('practiceId') ?? null, userId: user?.id ?? null, persona: user?.persona ?? null, action,
    objectType: object?.type ?? null, objectId: object?.id ?? null, details: details ?? null, prevHash: lastHash || null, hash, createdAt,
  });
  lastHash = hash;
}

export async function nextSequence(services: Services, key: string): Promise<number> {
  const rows = await services.db.select().from(schema.sequences).where(eq(schema.sequences.key, key)).limit(1);
  if (rows.length === 0) {
    await services.db.insert(schema.sequences).values({ key, value: 1 });
    return 1;
  }
  const value = rows[0]!.value + 1;
  await services.db.update(schema.sequences).set({ value }).where(eq(schema.sequences.key, key));
  return value;
}
