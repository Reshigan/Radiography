import { describe, expect, it } from 'vitest';
import { createTestDb } from './node.js';
import { seedAll } from './seed/index.js';
import * as s from './schema/index.js';

describe('db', () => {
  it('migrates and seeds core data', async () => {
    const db = await createTestDb();
    const summary = await seedAll(db);
    expect(summary.patients).toBe(120);
    const users = await db.select().from(s.users);
    expect(users.map((u) => u.persona)).toContain('RGT');
    const rooms = await db.select().from(s.rooms);
    expect(rooms.length).toBeGreaterThan(10);
    // idempotent
    const again = await seedAll(db);
    expect(again.patients).toBe(120);
  }, 30000);
});
