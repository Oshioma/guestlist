// ADMIN → EVENTS → SOURCES: the foundation of the independent event graph.
// Sources are the promoter/venue/festival/blog endpoints an automated
// monitor will poll; events_found / last_checked_at are maintained by the
// (future) importer.

import { query } from '@/lib/db';
import { fmtDate, sourceTypeLabel } from '@/lib/util';
import { AddSourceForm } from '@/components/admin/AddSourceForm';
import { SourceToggle } from '@/components/admin/SourceToggle';

export const dynamic = 'force-dynamic';

type SourceRow = {
  id: string;
  source_type: string;
  name: string;
  url: string;
  active: boolean;
  last_checked_at: string | null;
  events_found: number;
  failure_count: number;
  promoter_name: string | null;
  venue_name: string | null;
  linked_events: number;
};

export default async function SourcesPage() {
  const sources = await query<SourceRow>(
    `select s.id, s.source_type, s.name, s.url, s.active, s.last_checked_at,
            s.events_found, s.failure_count,
            p.name as promoter_name, v.name as venue_name,
            (select count(*)::int from events e where e.source_id = s.id) as linked_events
       from event_sources s
       left join promoters p on p.id = s.promoter_id
       left join venues v on v.id = s.venue_id
      order by s.active desc, s.name`
  );

  const [promoters, venues] = await Promise.all([
    query<{ id: string; name: string }>(`select id, name from promoters order by name`),
    query<{ id: string; name: string }>(`select id, name from venues order by name`),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Sources</h1>
      <p className="adminSub">
        The independent event graph: promoter sites, venue calendars, festivals,
        labels and blogs we monitor directly — no dependency on the big ticket platforms.
      </p>

      <AddSourceForm promoters={promoters} venues={venues} />

      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr>
              <th>Source name</th>
              <th>Type</th>
              <th>URL</th>
              <th>Events found</th>
              <th>Last checked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  {(s.promoter_name || s.venue_name) && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                      {s.promoter_name ?? s.venue_name}
                    </div>
                  )}
                </td>
                <td>{sourceTypeLabel(s.source_type)}</td>
                <td>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                    {new URL(s.url).hostname}
                  </a>
                </td>
                <td>{s.events_found || s.linked_events || 0}</td>
                <td>
                  {s.last_checked_at
                    ? fmtDate(s.last_checked_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : 'Never'}
                  {s.failure_count > 0 && (
                    <div style={{ color: 'var(--danger)', fontSize: 12 }}>{s.failure_count} failures</div>
                  )}
                </td>
                <td>
                  <span className={`statusDot ${s.active ? 'ok' : 'off'}`} />
                  {s.active ? 'Active' : 'Paused'}
                  {' '}
                  <SourceToggle id={s.id} active={s.active} />
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--text-faint)' }}>No sources yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
