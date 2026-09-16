import type { Db } from '../types.js';
import type { SeedContext } from './context.js';

/** Cluster C seeder: filled in by the module builder. Must be idempotent (check before insert). */
export async function seedClusterC(_db: Db, _ctx: SeedContext): Promise<Record<string, number> | void> {
  return;
}
