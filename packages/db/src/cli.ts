import path from 'node:path';
import fs from 'node:fs';
import { createNodeDb, migrateNodeDb } from './node.js';
import { seedAll } from './seed/index.js';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL ?? 'file:./data/bonakala.db';
const file = url.startsWith('file:') ? url.slice(5) : null;

async function main() {
  if (cmd === 'reset' && file && fs.existsSync(file)) {
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
    console.log('removed', file);
  }
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = createNodeDb(url);
  await migrateNodeDb(db);
  console.log('migrated', url);
  if (cmd === 'seed' || cmd === 'reset') {
    const summary = await seedAll(db);
    console.log('seeded', summary);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
