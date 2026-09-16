import type { Db } from '../types.js';
import type { SeedContext } from './context.js';

/** Cluster B seeder: filled in by the module builder. Must be idempotent (check before insert). */
export async function seedClusterB(_db: Db, _ctx: SeedContext): Promise<Record<string, number> | void> {
  return;
}
