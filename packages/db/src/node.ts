import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as schema from './schema/index.js';
import type { Db } from './types.js';

export function createNodeDb(url = process.env.DATABASE_URL ?? 'file:./data/bonakala.db'): Db {
  const client = createClient({ url });
  return drizzle(client, { schema }) as unknown as Db;
}

export const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrateNodeDb(db: Db): Promise<void> {
  await migrate(db as any, { migrationsFolder });
}

/** In-memory database with the current schema applied; used by tests. */
export async function createTestDb(): Promise<Db> {
  const db = createNodeDb(':memory:');
  const { syncSchema } = await import('./sync.js');
  await syncSchema(db);
  return db;
}

/** Apply schema: migrations by default, or a direct schema sync when DB_SYNC=schema (development). */
export async function prepareNodeDb(db: Db): Promise<void> {
  if (process.env.DB_SYNC === 'schema') {
    const { syncSchema } = await import('./sync.js');
    await syncSchema(db);
  } else {
    await migrateNodeDb(db);
  }
}
