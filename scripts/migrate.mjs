// Applies db/migrations/*.sql in order, tracking applied files in _migrations.
// Usage: node scripts/migrate.mjs [--reset]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(root, '.env.local'))) {
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

if (process.argv.includes('--reset')) {
  console.log('Resetting schema…');
  await client.query('drop schema public cascade; create schema public;');
}

await client.query(`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now()
)`);

const dir = path.join(root, 'db', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const { rows } = await client.query('select name from _migrations');
const applied = new Set(rows.map((r) => r.name));

for (const file of files) {
  if (applied.has(file)) continue;
  process.stdout.write(`Applying ${file}… `);
  await client.query('begin');
  try {
    await client.query(readFileSync(path.join(dir, file), 'utf8'));
    await client.query('insert into _migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log('ok');
  } catch (err) {
    await client.query('rollback');
    console.error('FAILED');
    console.error(err.message);
    process.exit(1);
  }
}

console.log('Migrations up to date.');
await client.end();
