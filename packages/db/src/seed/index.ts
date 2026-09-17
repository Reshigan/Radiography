import type { Db } from '../types.js';
import { seedCore } from './core.js';
import type { SeedContext } from './context.js';
import { seedClusterA } from './cluster-a.js';
import { seedClusterB } from './cluster-b.js';
import { seedClusterC } from './cluster-c.js';
import { seedClusterD } from './cluster-d.js';
import { seedAutomationHistory } from './automation-history.js';
export type { SeedContext } from './context.js';

/** Module seeders register here (each builder appends its own line). Each receives the shared context.
 *  seedAutomationHistory runs last: it counts already-seeded entities (claims, charges, appointments…)
 *  to backfill realistic agent_tasks volume, so it must follow every seeder that creates them. */
export const moduleSeeders: Array<(db: Db, ctx: SeedContext) => Promise<Record<string, number> | void>> = [seedClusterA, seedClusterB, seedClusterC, seedClusterD, seedAutomationHistory];

export async function seedAll(db: Db): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  const ctx = await seedCore(db, summary);
  for (const s of moduleSeeders) {
    const r = await s(db, ctx);
    if (r) Object.assign(summary, r);
  }
  return summary;
}
