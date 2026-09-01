// ADMIN → SYSTEM → DATABASE: is the live database actually carrying
// everything this deployment expects?
//
// This page exists because a single missing table once took the whole
// homepage down, and nothing anywhere said so until visitors saw an
// application error. A missing migration should be something we notice
// here, not something the public discovers.

import { auditSchema } from '@/lib/schemaAudit';

export const dynamic = 'force-dynamic';

export default async function SchemaPage() {
  const audit = await auditSchema();

  return (
    <main>
      <h1 className="adminTitle">Database</h1>
      <p className="adminSub">
        Compares the live database against everything the deployed code expects.
        Applying SQL by hand in the Supabase editor creates the tables but leaves
        no record behind, so the schema itself is checked rather than the
        migration log.
      </p>

      <div className={`schemaVerdict${audit.ok ? ' ok' : ' bad'}`}>
        <strong>
          {audit.ok
            ? 'Up to date — every table and column the code expects is present.'
            : 'Behind — the deployment expects things this database does not have.'}
        </strong>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          {audit.checkedTables} tables and {audit.checkedColumns} added columns checked.
        </div>
      </div>

      {audit.missingTables.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 className="homeSectionTitle" style={{ fontSize: 17 }}>
            Missing tables ({audit.missingTables.length})
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Any page that reads one of these will fail. Run the migration that creates it.
          </p>
          <ul className="schemaList">
            {audit.missingTables.map((t) => <li key={t}><code>{t}</code></li>)}
          </ul>
        </section>
      )}

      {audit.missingColumns.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <h2 className="homeSectionTitle" style={{ fontSize: 17 }}>
            Missing columns ({audit.missingColumns.length})
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            The table exists but a later migration never ran against it. These break
            queries exactly as hard as a missing table.
          </p>
          <ul className="schemaList">
            {audit.missingColumns.map((c) => <li key={c}><code>{c}</code></li>)}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 26 }}>
        <h2 className="homeSectionTitle" style={{ fontSize: 17 }}>
          Migration log ({audit.recordedCount} recorded)
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {audit.unrecordedMigrations.length === 0
            ? 'Every migration file has a row in _migrations.'
            : `${audit.unrecordedMigrations.length} migration file${audit.unrecordedMigrations.length === 1 ? ' has' : 's have'} no row in _migrations. That is expected for anything applied by hand, and is only worth acting on when the schema check above is also unhappy.`}
        </p>
        {audit.unrecordedMigrations.length > 0 && (
          <ul className="schemaList">
            {audit.unrecordedMigrations.map((m) => <li key={m}><code>{m}</code></li>)}
          </ul>
        )}
      </section>
    </main>
  );
}
