// ADMIN → EVENTS → SOURCES: the independent event graph. Each source can be
// scanned on demand (SCAN NOW) or polled on a schedule via the
// /api/jobs/scan-sources cron endpoint. Trust levels gate auto-publishing.

import { query } from '@/lib/db';
import { fmtDate, sourceTypeLabel } from '@/lib/util';
import { AddSourceForm } from '@/components/admin/AddSourceForm';
import { SourceControls } from '@/components/admin/SourceControls';

export const dynamic = 'force-dynamic';

type SourceRow = {
  id: string;
  source_type: string;
  name: string;
  url: string;
  feed_url: string | null;
  active: boolean;
  trust: string;
  polling_enabled: boolean;
  poll_frequency_hours: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  events_found: number;
  failure_count: number;
  promoter_name: string | null;
  venue_name: string | null;
  linked_events: number;
  scan_count: number;
  last_scan_new: number | null;
  last_scan_extracted: number | null;
};

export default async function SourcesPage() {
  const sources = await query<SourceRow>(
    `select s.id, s.source_type, s.name, s.url, s.feed_url, s.active, s.trust,
            s.polling_enabled, s.poll_frequency_hours,
            s.last_checked_at::text, s.last_success_at::text,
            s.events_found, s.failure_count,
            p.name as promoter_name, v.name as venue_name,
            (select count(*)::int from event_source_links l where l.source_id = s.id) as linked_events,
            coalesce(sc.scan_count, 0) as scan_count,
            sc.last_scan_new, sc.last_scan_extracted
       from event_sources s
       left join promoters p on p.id = s.promoter_id
       left join venues v on v.id = s.venue_id
       left join lateral (
         select count(*)::int as scan_count,
                (select new_candidates from source_scans x
                  where x.source_id = s.id order by started_at desc limit 1) as last_scan_new,
                (select extracted from source_scans x
                  where x.source_id = s.id order by started_at desc limit 1) as last_scan_extracted
           from source_scans sc2 where sc2.source_id = s.id
       ) sc on true
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
        labels, feeds and blogs we monitor directly — no dependency on the big
        ticket platforms. TRUSTED sources qualify for conservative auto-publishing.
      </p>

      <AddSourceForm promoters={promoters} venues={venues} />

      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr>
              <th>Source name</th>
              <th>Type</th>
              <th>URL</th>
              <th>Trust</th>
              <th>Events found</th>
              <th>Last checked</th>
              <th>Status / controls</th>
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
                  {s.feed_url && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11 }} title={s.feed_url}>RSS ✓</div>
                  )}
                </td>
                <td><span className={`trustPill ${s.trust}`}>{s.trust}</span></td>
                <td>
                  {s.events_found || s.linked_events || 0}
                  {s.scan_count > 0 && s.last_scan_new != null && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                      last scan: {s.last_scan_new} new, {s.last_scan_extracted} extracted
                    </div>
                  )}
                </td>
                <td>
                  {s.last_checked_at
                    ? fmtDate(s.last_checked_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : 'Never'}
                  {s.failure_count > 0 && (
                    <div style={{ color: 'var(--danger)', fontSize: 12 }}>{s.failure_count} failures</div>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12.5 }}>
                    <span className={`statusDot ${s.active ? 'ok' : 'off'}`} />
                    {s.active ? (s.polling_enabled ? `Polling ${s.poll_frequency_hours}h` : 'Active') : 'Paused'}
                  </div>
                  <SourceControls
                    id={s.id}
                    active={s.active}
                    trust={s.trust}
                    pollingEnabled={s.polling_enabled}
                    pollFrequencyHours={s.poll_frequency_hours}
                  />
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--text-faint)' }}>No sources yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
