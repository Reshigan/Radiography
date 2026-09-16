// Dump a locally seeded SQLite database to SQL that Cloudflare D1 will accept.
// Usage: SEED_DB=../../apps/api/data/bonakala.db node packages/db/tools/dump.mjs > (writes /tmp/bonakala-seed.sql)
// D1 constraints handled here: one INSERT per row (large multi-row statements hit SQLITE_TOOBIG),
// and parent tables emitted first so foreign keys resolve during import.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
const db = createClient({ url: 'file:' + (process.env.SEED_DB ?? '../../apps/api/data/bonakala.db') + '' });
const out = fs.createWriteStream('/tmp/bonakala-seed.sql');
const all = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")).rows.map(r => r.name);
const first = ['legal_entities','entity_relationships','shareholdings','sites','rooms','modalities','users','sessions','patients','patient_identifiers','referrers'];
const tables = [...first.filter(t => all.includes(t)), ...all.filter(t => !first.includes(t))];
const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return String(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
let total = 0;
for (const t of tables) {
  const rows = (await db.execute(`SELECT * FROM "${t}"`)).rows;
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(',');
  // chunk multi-row inserts to keep statements a manageable size
  for (const r of rows) {
    out.write(`INSERT INTO "${t}" (${cols}) VALUES (${Object.values(r).map(esc).join(',')});\n`);
  }
  total += rows.length;
  console.log(`${t}: ${rows.length}`);
}
out.end();
console.log('TOTAL ROWS', total);
