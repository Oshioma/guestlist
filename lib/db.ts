import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

// Single connection pool across dev hot-reloads.
const globalForDb = globalThis as unknown as { __glPool?: Pool };

// Every serverless instance gets its own pool, and the database allows 200
// connections in all. Ten per instance that were never let go meant a busy
// evening ran it out ("EMAXCONN max client connections reached") and pages
// and uploads failed. So: few per instance, idle ones closed quickly, and
// Vercel told about the pool so it can close them before an instance sleeps.
export const db =
  globalForDb.__glPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/guestlist',
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

if (!globalForDb.__glPool) {
  globalForDb.__glPool = db;
  attachDatabasePool(db);
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
