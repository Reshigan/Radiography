import { text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const id = () => text('id').primaryKey();
export const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
export const updatedAt = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
export const practiceId = () => text('practice_id').notNull();
export const practiceIdNullable = () => text('practice_id');
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
export const bool = (name: string) => integer(name, { mode: 'boolean' });
export const cents = (name: string) => integer(name);
