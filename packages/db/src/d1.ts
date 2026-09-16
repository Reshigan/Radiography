import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index.js';
import type { Db } from './types.js';

export function createD1Db(binding: D1Database): Db {
  return drizzle(binding, { schema }) as unknown as Db;
}
