/** Back-office Hand run history: backfills agent_tasks so the automation & FTE report
 *  (M16 GET /analytics/back-office-automation) has real trailing volume to show, not zeros.
 *  Idempotent; synthetic DEMO data. Volume per Hand is tied to the actual count of the entity
 *  it processes, already seeded by earlier clusters, so the picture stays honest — a Hand that
 *  genuinely has low real volume (e.g. Remittance, batch by nature) shows low run counts here too. */
import { eq, and } from 'drizzle-orm';
import { newId } from '@bonakala/domain';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import { rng } from './data.js';

const WINDOW_DAYS = 60;

/** One row per back-office Hand: which table's count drives run volume, and how touchless the
 *  run mix is — set from each Hand's own approval policy (docs/11), not invented per report. */
const HANDS: Array<{ handId: string; trigger: string; titlePrefix: string; touchlessPct: number }> = [
  { handId: 'referral', trigger: 'referral.received', titlePrefix: 'Referral conversion', touchlessPct: 0.8 },
  { handId: 'booking', trigger: 'whatsapp.inbound', titlePrefix: 'WhatsApp booking', touchlessPct: 0.85 },
  { handId: 'authorisation', trigger: 'funding.case.created.v1', titlePrefix: 'Pre-authorisation', touchlessPct: 0.65 },
  { handId: 'front-desk', trigger: 'encounter.started', titlePrefix: 'Pre-check-in', touchlessPct: 0.88 },
  { handId: 'coding', trigger: 'report.signed.v1', titlePrefix: 'Coding', touchlessPct: 0.9 },
  { handId: 'claims', trigger: 'schedule', titlePrefix: 'Claim batch', touchlessPct: 0.92 },
  { handId: 'remittance', trigger: 'remittance.received', titlePrefix: 'Remittance posting', touchlessPct: 0.94 },
  { handId: 'collections', trigger: 'schedule', titlePrefix: 'Dunning run', touchlessPct: 0.9 },
];

async function countFor(db: Db, handId: string, practiceId: string): Promise<number> {
  switch (handId) {
    case 'referral': return (await db.select({ id: s.referrals.id }).from(s.referrals).where(eq(s.referrals.practiceId, practiceId))).length;
    case 'booking': return (await db.select({ id: s.appointments.id }).from(s.appointments).where(eq(s.appointments.practiceId, practiceId))).length;
    case 'authorisation': return (await db.select({ id: s.fundingCases.id }).from(s.fundingCases).where(eq(s.fundingCases.practiceId, practiceId))).length;
    case 'front-desk': return (await db.select({ id: s.encounters.id }).from(s.encounters).where(eq(s.encounters.practiceId, practiceId))).length;
    case 'coding': return (await db.select({ id: s.charges.id }).from(s.charges).where(eq(s.charges.practiceId, practiceId))).length;
    case 'claims': return (await db.select({ id: s.claims.id }).from(s.claims).where(eq(s.claims.practiceId, practiceId))).length;
    case 'remittance': return (await db.select({ id: s.remittances.id }).from(s.remittances).where(eq(s.remittances.practiceId, practiceId))).length;
    case 'collections': return (await db.select({ id: s.dunningActions.id }).from(s.dunningActions).where(eq(s.dunningActions.practiceId, practiceId))).length;
    default: return 0;
  }
}

export async function seedAutomationHistory(db: Db, ctx: SeedContext): Promise<Record<string, number> | void> {
  const existing = await db.select({ id: s.agentTasks.id }).from(s.agentTasks).where(and(eq(s.agentTasks.handId, 'coding'))).limit(1);
  if (existing.length) return;
  const r = rng(2609);
  const now = new Date(ctx.now);
  let count = 0;
  for (const practiceId of [ctx.practiceA, ctx.practiceB]) {
    for (const h of HANDS) {
      const n = await countFor(db, h.handId, practiceId);
      for (let i = 0; i < n; i++) {
        const ageDays = r() * WINDOW_DAYS;
        const startedAt = new Date(now.getTime() - ageDays * 86400_000).toISOString();
        const touchless = r() < h.touchlessPct;
        const status = touchless ? 'done' : r() < 0.85 ? 'approved' : 'needs_approval';
        await db.insert(s.agentTasks).values({
          id: newId('task'), practiceId, handId: h.handId, trigger: h.trigger, status,
          title: `${h.titlePrefix} · ${startedAt.slice(0, 10)}`,
          input: {}, output: touchless ? { ok: true } : null,
          steps: [{ at: startedAt, tool: 'db.read', risk: 'R0', result: { ok: true } }],
          leashChecks: [],
          approvalPersona: status === 'needs_approval' ? (h.handId === 'referral' || h.handId === 'booking' ? 'BKG' : h.handId === 'front-desk' ? 'FDK' : h.handId === 'remittance' || h.handId === 'collections' ? 'DEB' : 'BIL') : null,
          approvedBy: status === 'approved' ? 'system-demo' : null, approvedAt: status === 'approved' ? startedAt : null,
          startedAt, finishedAt: startedAt,
        });
        count++;
      }
    }
  }
  return { automationHistoryTasks: count };
}
