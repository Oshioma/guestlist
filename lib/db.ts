import { Pool } from 'pg';

// Single connection pool across dev hot-reloads.
const globalForDb = globalThis as unknown as { __glPool?: Pool };

export const db =
  globalForDb.__glPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/guestlist',
    max: 10,
  });

if (!globalForDb.__glPool) globalForDb.__glPool = db;

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
