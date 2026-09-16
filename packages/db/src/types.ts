import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema/index.js';
/** Async SQLite database (libsql on Node, D1 on Workers) with the full schema. */
export type Db = BaseSQLiteDatabase<'async', any, typeof schema>;
