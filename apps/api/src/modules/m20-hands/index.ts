import { z } from 'zod';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineModule, router, allow, body, audit, param, listHands, runHand, effectiveLeash, getHand } from '../../kernel/index.js';

const r = router();
const GOV = ['PRM', 'EXE', 'CMP', 'AIO', 'SUP', 'BIL', 'DEB', 'FDK', 'BKG', 'RGT', 'RAD', 'NUR', 'BIO'] as const;

/** Registry with effective leash for the current practice. */
r.get('/', allow(...GOV), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const out = [];
  for (const def of listHands()) {
    const eff = await effectiveLeash(services, def.id, practiceId);
    out.push({ ...def, leash: eff.leash, status: eff.status });
  }
  return c.json({ hands: out });
});

r.patch('/:handId', allow('PRM', 'CMP', 'AIO', 'SUP', 'EXE'), async (c) => {
  const handId = param(c, 'handId');
  const def = getHand(handId)?.def;
  if (!def) return c.json({ error: 'not_found' }, 404);
  const { leash, status, reason } = await body(c, z.object({ leash: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(), status: z.enum(['active', 'shadow', 'paused']).optional(), reason: z.string().min(3) }));
  const practiceId = c.get('practiceId');
  const services = c.get('services');
  const id = practiceId ? `${handId}:${practiceId}` : handId;
  const [existing] = await services.db.select().from(schema.hands).where(eq(schema.hands.id, id)).limit(1);
  if (existing) {
    await services.db.update(schema.hands).set({ leash: { ...existing.leash, ...(leash ?? {}) }, status: status ?? existing.status, version: existing.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.hands.id, id));
  } else {
    await services.db.insert(schema.hands).values({ id, handId, practiceId, name: def.name, module: def.module, mandate: def.mandate, level: def.level, leash: leash ?? {}, approvalPolicy: def.approvalPolicy, status: status ?? 'active' });
  }
  await audit(c, 'hand.updated', { type: 'hand', id }, { leash, status, reason });
  return c.json({ ok: true });
});

/** Task queue: needs_approval first, then recent. */
r.get('/tasks', allow(...GOV), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const status = c.req.query('status');
  const where = and(practiceId ? or(eq(schema.agentTasks.practiceId, practiceId), isNull(schema.agentTasks.practiceId)) : undefined, status ? eq(schema.agentTasks.status, status) : undefined);
  const rows = await services.db.select().from(schema.agentTasks).where(where).orderBy(desc(schema.agentTasks.startedAt)).limit(200);
  rows.sort((a, b) => (a.status === 'needs_approval' ? -1 : 0) - (b.status === 'needs_approval' ? -1 : 0));
  return c.json({ tasks: rows });
});

r.get('/tasks/:id', allow(...GOV), async (c) => {
  const [row] = await c.get('services').db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, param(c, 'id'))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ task: row });
});

r.post('/tasks/:id/approve', allow(...GOV), async (c) => {
  const services = c.get('services');
  const user = c.get('user')!;
  const id = param(c, 'id');
  const [row] = await services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'needs_approval') return c.json({ error: 'not_awaiting_approval' }, 409);
  if (row.approvalPersona && row.approvalPersona !== user.persona && !['EXE', 'SUP', 'PRM'].includes(user.persona)) return c.json({ error: 'forbidden', needs: row.approvalPersona }, 403);
  await services.db.update(schema.agentTasks).set({ approvedBy: user.id, approvedAt: new Date().toISOString(), status: 'approved' }).where(eq(schema.agentTasks.id, id));
  await audit(c, 'hand.task_approved', { type: 'agent_task', id }, { handId: row.handId });
  const result = await runHand(services, row.handId, row.input, { practiceId: row.practiceId, trigger: row.trigger, title: row.title, approved: true, taskId: id, aggregateType: row.aggregateType ?? undefined, aggregateId: row.aggregateId ?? undefined });
  return c.json({ task: result });
});

r.post('/tasks/:id/reject', allow(...GOV), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const { reason } = await body(c, z.object({ reason: z.string().min(2) }));
  await services.db.update(schema.agentTasks).set({ status: 'rejected', error: reason, finishedAt: new Date().toISOString() }).where(eq(schema.agentTasks.id, id));
  await audit(c, 'hand.task_rejected', { type: 'agent_task', id }, { reason });
  return c.json({ ok: true });
});

/** Manual trigger (demo and operators). */
r.post('/:handId/run', allow(...GOV), async (c) => {
  const handId = param(c, 'handId');
  if (!getHand(handId)) return c.json({ error: 'not_found' }, 404);
  const input = await body(c, z.record(z.unknown()));
  const task = await runHand(c.get('services'), handId, input, { practiceId: c.get('practiceId'), trigger: 'manual', title: `${handId} (manual)` });
  return c.json({ task });
});

export default defineModule({ code: 'M20', name: 'Agent Runtime', basePath: 'hands', routes: r });
