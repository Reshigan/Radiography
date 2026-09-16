import type { Db } from '../types.js';
import { seedCore } from './core.js';
import type { SeedContext } from './context.js';
import { seedClusterA } from './cluster-a.js';
import { seedClusterB } from './cluster-b.js';
import { seedClusterC } from './cluster-c.js';
import { seedClusterD } from './cluster-d.js';
export type { SeedContext } from './context.js';

/** Module seeders register here (each builder appends its own line). Each receives the shared context. */
export const moduleSeeders: Array<(db: Db, ctx: SeedContext) => Promise<Record<string, number> | void>> = [seedClusterA, seedClusterB, seedClusterC, seedClusterD];

export async function seedAll(db: Db): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  const ctx = await seedCore(db, summary);
  for (const s of moduleSeeders) {
    const r = await s(db, ctx);
    if (r) Object.assign(summary, r);
  }
  return summary;
}
