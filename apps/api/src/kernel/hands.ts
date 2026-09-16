import { and, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, NeedsApproval, Refused, checkLeash, type HandDefinition, type LeashSpec, type RiskClass, type LeashCheck } from '@bonakala/domain';
import type { Services } from './ports.js';

export interface HandRunContext {
  services: Services;
  practiceId: string | null;
  leash: LeashSpec;
  approved: boolean; // true when re-running after human approval
  /** Record a tool call. Throws when the tool is not in the Hand's allow-list. */
  step<T>(tool: string, args: unknown, fn: () => Promise<T>, note?: string): Promise<T>;
  /** Check leash rules; throws NeedsApproval when any fails and the run is not approved. */
  leashCheck(checks: Array<{ rule: string; actual: number | boolean | string; compare?: 'lte' | 'gte' | 'eq' }>): LeashCheck[];
  log(note: string): void;
}

export type HandExecutor<I extends Record<string, unknown>, O extends Record<string, unknown>> = (input: I, ctx: HandRunContext) => Promise<O>;

const registry = new Map<string, { def: HandDefinition; exec: HandExecutor<any, any> }>();

export function registerHand<I extends Record<string, unknown>, O extends Record<string, unknown>>(def: HandDefinition, exec: HandExecutor<I, O>) {
  registry.set(def.id, { def, exec });
}
export function listHands() {
  return [...registry.values()].map((h) => h.def);
}
export function getHand(id: string) {
  return registry.get(id);
}

async function ensureRegistryRows(services: Services) {
  const rows = await services.db.select({ handId: schema.hands.handId }).from(schema.hands).where(isNull(schema.hands.practiceId));
  const have = new Set(rows.map((r) => r.handId));
  for (const { def } of registry.values()) {
    if (!have.has(def.id)) {
      await services.db.insert(schema.hands).values({ id: def.id, handId: def.id, practiceId: null, name: def.name, module: def.module, mandate: def.mandate, level: def.level, leash: def.defaultLeash, approvalPolicy: def.approvalPolicy, status: 'active' });
    }
  }
}

export async function effectiveLeash(services: Services, handId: string, practiceId: string | null): Promise<{ leash: LeashSpec; status: string }> {
  await ensureRegistryRows(services);
  const rows = await services.db.select().from(schema.hands).where(and(eq(schema.hands.handId, handId), or(isNull(schema.hands.practiceId), practiceId ? eq(schema.hands.practiceId, practiceId) : isNull(schema.hands.practiceId))));
  const global = rows.find((r) => r.practiceId === null);
  const local = rows.find((r) => r.practiceId !== null);
  return { leash: { ...(global?.leash ?? {}), ...(local?.leash ?? {}) }, status: local?.status ?? global?.status ?? 'active' };
}

/**
 * Run a Hand as a recorded task. Returns the task row. Approval flows re-run with approved=true.
 */
export async function runHand<I extends Record<string, unknown>>(services: Services, handId: string, input: I, opts: { practiceId: string | null; trigger: string; title: string; aggregateType?: string; aggregateId?: string; approved?: boolean; taskId?: string }) {
  const h = registry.get(handId);
  if (!h) throw new Error(`Unknown Hand ${handId}`);
  const { leash, status } = await effectiveLeash(services, handId, opts.practiceId);
  const steps: Array<{ at: string; tool: string; risk: string; args?: unknown; result?: unknown; note?: string }> = [];
  const leashChecks: LeashCheck[] = [];
  const taskId = opts.taskId ?? newId('task');
  let llmUsed = false;

  if (!opts.taskId) {
    await services.db.insert(schema.agentTasks).values({ id: taskId, practiceId: opts.practiceId, handId, trigger: opts.trigger, title: opts.title, input, steps: [], leashChecks: [], status: 'running', aggregateType: opts.aggregateType ?? null, aggregateId: opts.aggregateId ?? null });
  } else {
    await services.db.update(schema.agentTasks).set({ status: 'running', error: null }).where(eq(schema.agentTasks.id, taskId));
  }

  const finish = async (patch: Partial<typeof schema.agentTasks.$inferInsert>) => {
    await services.db.update(schema.agentTasks).set({ steps, leashChecks, llmUsed, finishedAt: new Date().toISOString(), ...patch }).where(eq(schema.agentTasks.id, taskId));
    const [row] = await services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, taskId)).limit(1);
    return row!;
  };

  if (status === 'paused') return finish({ status: 'refused', error: 'Hand is paused' });

  const ctx: HandRunContext = {
    services, practiceId: opts.practiceId, leash, approved: opts.approved ?? false,
    async step(tool, args, fn, note) {
      const risk: RiskClass | undefined = h.def.tools[tool];
      if (!risk) throw new Refused(`Tool ${tool} is not in the mandate of ${h.def.name}`);
      if (risk === 'R3' && !ctx.approved) throw new NeedsApproval(`${tool} needs ${h.def.approvalPersona} approval`);
      if (tool.startsWith('llm.')) llmUsed = true;
      const result = await fn();
      steps.push({ at: new Date().toISOString(), tool, risk, args, result: summarise(result), note });
      return result;
    },
    leashCheck(checks) {
      const res = checkLeash(leash, checks);
      leashChecks.push(...res);
      const failed = res.filter((c) => !c.ok);
      if (failed.length && !ctx.approved) throw new NeedsApproval(`Leash: ${failed.map((f) => `${f.rule} ${f.actual} > ${f.limit}`).join('; ')}`, failed);
      return res;
    },
    log(note) {
      steps.push({ at: new Date().toISOString(), tool: 'note', risk: 'R0', note });
    },
  };

  try {
    if (status === 'shadow') ctx.log('Hand in shadow mode: actions recorded, external effects suppressed by tools');
    const output = await h.exec(input, ctx);
    return finish({ status: 'done', output });
  } catch (e) {
    if (e instanceof NeedsApproval) return finish({ status: 'needs_approval', approvalPersona: h.def.approvalPersona, approvalReason: e.reason });
    if (e instanceof Refused) return finish({ status: 'refused', error: e.reason });
    return finish({ status: 'failed', error: (e as Error).message });
  }
}

function summarise(v: unknown) {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 600 ? JSON.parse(s.slice(0, 600) + '"') : v;
  } catch {
    return String(v);
  }
}
