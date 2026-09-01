// SCHEMA AUDIT: does the live database actually have everything the code
// expects?
//
// Migrations get applied by hand in the Supabase SQL editor, which creates
// the tables but never writes the `_migrations` bookkeeping row — so that
// table under-reports badly and cannot be trusted on its own. The schema
// itself is the only honest source, so the audit compares the generated
// expectations against information_schema and treats the `_migrations`
// listing as a hint, clearly labelled as one.

import { query } from '@/lib/db';
import { EXPECTED_COLUMNS, EXPECTED_TABLES, MIGRATION_FILES } from '@/lib/schemaExpectations';

export type SchemaAudit = {
  ok: boolean;
  missingTables: string[];
  missingColumns: string[];
  // Migration files with no row in _migrations. Applying SQL by hand leaves
  // no row behind, so an unrecorded file is a prompt to check, not proof of
  // anything missing.
  unrecordedMigrations: string[];
  recordedCount: number;
  checkedTables: number;
  checkedColumns: number;
};

export async function auditSchema(): Promise<SchemaAudit> {
  const [tables, columns, recorded] = await Promise.all([
    query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`
    ),
    query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`
    ),
    // The table itself may predate this feature on an old deployment.
    query<{ name: string }>(
      `select name from _migrations`
    ).catch(() => [] as { name: string }[]),
  ]);

  const haveTables = new Set(tables.map((t) => t.table_name));
  const haveColumns = new Set(columns.map((c) => `${c.table_name}.${c.column_name}`));
  const haveMigrations = new Set(recorded.map((r) => r.name));

  const missingTables = EXPECTED_TABLES.filter((t) => !haveTables.has(t));
  // Only report a missing column on a table that exists — otherwise every
  // column of a missing table repeats the same news.
  const missingColumns = EXPECTED_COLUMNS.filter((tc) => {
    const [table] = tc.split('.');
    return haveTables.has(table) && !haveColumns.has(tc);
  });

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    unrecordedMigrations: MIGRATION_FILES.filter((f) => !haveMigrations.has(f)),
    recordedCount: haveMigrations.size,
    checkedTables: EXPECTED_TABLES.length,
    checkedColumns: EXPECTED_COLUMNS.length,
  };
}
