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
  let applied = 0;
  for (const statement of statements) {
    try {
      await db.run(statement as any);
      applied++;
    } catch (e) {
      // Idempotent: a dev database that already carries the object is fine. Anything else is a real
      // error. Drizzle wraps the driver error, so walk the cause chain for the sqlite message.
      let text = '';
      let cur: unknown = e;
      for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
        text += ` ${cur.message}`;
        cur = (cur as { cause?: unknown }).cause;
      }
      if (!/already exists/i.test(text)) throw e;
    }
  }
  return applied;
}
