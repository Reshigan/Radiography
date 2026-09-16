/**
 * Development-time schema sync: builds the DDL for the current Drizzle schema in memory and applies it.
 * Used by tests and by `DB_SYNC=schema` local runs so parallel module work never collides on migration
 * files. Production uses the generated migrations (`pnpm db:generate`).
 */
import * as schema from './schema/index.js';
import type { Db } from './types.js';

export async function syncSchema(db: Db): Promise<number> {
  const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
  const empty = await generateSQLiteDrizzleJson({});
  const current = await generateSQLiteDrizzleJson(schema as any);
  const statements = await generateSQLiteMigration(empty, current);
  for (const s of statements) await db.run(s as any);
  return statements.length;
}
