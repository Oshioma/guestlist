// ADMIN → SUPPLY: the extraction log. Every attempt to turn a URL into an
// event, with its outcome, cost/performance metrics, and retry for
// failures. Failures are never silently swallowed — they all land here.

import Link from 'next/link';
import { query, queryOne } from '@/lib/db';
import { fmtDate } from '@/lib/util';
import { RetryExtraction } from '@/components/admin/RetryExtraction';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  processing: 'Processing', succeeded: 'Succeeded', duplicate_linked: 'Duplicate — linked',
  invalid_url: 'Invalid URL', unsafe_url: 'Private/unsafe URL', fetch_failed: 'Fetch failed',
  not_found: 'Page not found', blocked_by_site: 'Blocked by website', too_large: 'Too large',
  unsupported_content: 'Unsupported content', not_an_event: 'Not an event',
  not_relevant: 'Not relevant', insufficient_information: 'Insufficient information',
  ai_extraction_failed: 'AI extraction failed', invalid_date: 'Invalid date',
  possible_duplicate: 'Possible duplicate', failed: 'Failed',
};

const RETRYABLE = new Set([
  'fetch_failed', 'not_found', 'blocked_by_site', 'too_large', 'ai_extraction_failed',
  'insufficient_information', 'invalid_date', 'failed', 'unsupported_content', 'not_an_event',
]);

type Row = {
  id: string; url: string; status: string; failure_detail: string | null;
  overall_confidence: string | null; relevance: string | null;
  duplicate_state: string; structured_data_found: boolean; ai_used: boolean;
  ai_model: string | null; ai_input_tokens: number | null; ai_output_tokens: number | null;
  fetch_ms: number | null; total_ms: number | null; created_at: string;
  event_title: string | null; event_id: string | null; source_name: string | null;
  warnings: string[];
};

// Outcomes that produced or matched an event. Everything else is a failure
// worth reading a reason for.
const OK_STATUSES = ['succeeded', 'possible_duplicate', 'duplicate_linked'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupplyPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; status?: string }>;
}) {
  const params = await searchParams;
  // Reject anything that is not a real id or a known status, so a hand-edited
  // query string cannot reach the SQL.
  const sourceFilter = UUID.test(params.source ?? '') ? params.source! : null;
  const statusFilter =
    params.status === 'failures' || (params.status && STATUS_LABEL[params.status])
      ? params.status
      : null;

  const args: unknown[] = [];
  const where: string[] = [];
  if (sourceFilter) { args.push(sourceFilter); where.push(`x.source_id = $${args.length}`); }
  if (statusFilter === 'failures') {
    args.push(OK_STATUSES); where.push(`not (x.status = any($${args.length}))`);
  } else if (statusFilter) {
    args.push(statusFilter); where.push(`x.status = $${args.length}`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';

  // Status chips count within the source only, so the row of chips stays put
  // while a status filter is applied.
  const sourceArgs = sourceFilter ? [sourceFilter] : [];
  const sourceClause = sourceFilter ? 'where x.source_id = $1' : '';

  const [rows, stats, statusCounts, filteredSource] = await Promise.all([
    query<Row>(
      `select x.id, x.url, x.status, x.failure_detail, x.overall_confidence, x.relevance,
              x.duplicate_state, x.structured_data_found, x.ai_used, x.ai_model,
              x.ai_input_tokens, x.ai_output_tokens, x.fetch_ms, x.total_ms,
              x.created_at::text, x.warnings,
              e.title as event_title, e.id as event_id, s.name as source_name
         from extractions x
         left join events e on e.id = x.event_id
         left join event_sources s on s.id = x.source_id
        ${clause}
        order by x.created_at desc
        limit 100`,
      args
    ),
    query<{ n: number; ok: number; ai: number; structured: number; tokens_in: number; tokens_out: number }>(
      `select count(*)::int as n,
              count(*) filter (where status in ('succeeded','possible_duplicate','duplicate_linked'))::int as ok,
              count(*) filter (where ai_used)::int as ai,
              count(*) filter (where structured_data_found)::int as structured,
              coalesce(sum(ai_input_tokens), 0)::int as tokens_in,
              coalesce(sum(ai_output_tokens), 0)::int as tokens_out
         from extractions x ${clause}`,
      args
    ),
    query<{ status: string; n: number }>(
      `select x.status, count(*)::int as n from extractions x ${sourceClause}
        group by x.status order by n desc`,
      sourceArgs
    ),
    sourceFilter
      ? queryOne<{ name: string }>(`select name from event_sources where id = $1`, [sourceFilter])
      : Promise.resolve(null),
  ]);
  const s = stats[0];
  const failureCount = statusCounts
    .filter((c) => !OK_STATUSES.includes(c.status) && c.status !== 'processing')
    .reduce((n, c) => n + c.n, 0);

  const filterHref = (next: { source?: string | null; status?: string | null }) => {
    const q = new URLSearchParams();
    const src = next.source === undefined ? sourceFilter : next.source;
    const st = next.status === undefined ? statusFilter : next.status;
    if (src) q.set('source', src);
    if (st) q.set('status', st);
    const qs = q.toString();
    return qs ? `/admin/supply?${qs}` : '/admin/supply';
  };

  return (
    <main>
      <h1 className="adminTitle">Supply log</h1>
      <p className="adminSub">
        {s.n} extraction{s.n === 1 ? '' : 's'} · {s.ok} produced or matched an event ·{' '}
        {s.structured} hit structured data · {s.ai} used AI ({s.tokens_in.toLocaleString()} in /{' '}
        {s.tokens_out.toLocaleString()} out tokens).
      </p>

      {filteredSource && (
        <p className="adminSub" style={{ marginTop: -6 }}>
          Filtered to <strong>{filteredSource.name}</strong> ·{' '}
          <Link href={filterHref({ source: null, status: null })} style={{ textDecoration: 'underline' }}>
            show all sources
          </Link>
        </p>
      )}

      {/* A source's failures are only useful if you can isolate them — this is
          the path from "10 failed" on the sources desk to the actual reasons. */}
      <div className="chipRow" style={{ marginBottom: 18 }}>
        <Link className={`chip${!statusFilter ? ' active' : ''}`} href={filterHref({ status: null })}>
          All outcomes
        </Link>
        {failureCount > 0 && (
          <Link
            className={`chip${statusFilter === 'failures' ? ' active' : ''}`}
            href={filterHref({ status: statusFilter === 'failures' ? null : 'failures' })}
          >
            Failures only ({failureCount})
          </Link>
        )}
        {statusCounts.map((c) => (
          <Link
            key={c.status}
            className={`chip${statusFilter === c.status ? ' active' : ''}`}
            href={filterHref({ status: statusFilter === c.status ? null : c.status })}
          >
            {STATUS_LABEL[c.status] ?? c.status} ({c.n})
          </Link>
        ))}
      </div>

      <div className="adminTableWrap">
        <table className="adminTable">
          <thead>
            <tr>
              <th>When</th>
              <th>URL</th>
              <th>Outcome</th>
              <th>Event</th>
              <th>Evidence</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(r.created_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {r.source_name && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{r.source_name}</div>
                  )}
                </td>
                <td style={{ maxWidth: 260, overflow: 'hidden' }}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                     style={{ textDecoration: 'underline', wordBreak: 'break-all', fontSize: 12.5 }}>
                    {r.url.replace(/^https?:\/\//, '').slice(0, 60)}
                  </a>
                </td>
                <td>
                  <span style={{
                    color: ['succeeded', 'duplicate_linked'].includes(r.status)
                      ? 'var(--ok)'
                      : ['possible_duplicate', 'not_relevant', 'processing'].includes(r.status)
                        ? 'var(--accent)'
                        : 'var(--danger)',
                  }}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.failure_detail && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11, maxWidth: 220 }}>
                      {r.failure_detail.slice(0, 120)}
                    </div>
                  )}
                  {r.warnings.length > 0 && (
                    <div style={{ color: 'var(--accent-ink, var(--accent))', fontSize: 11 }}>{r.warnings.length} warning{r.warnings.length === 1 ? '' : 's'}</div>
                  )}
                </td>
                <td>
                  {r.event_id ? (
                    <Link href={`/admin/events/${r.event_id}`} style={{ textDecoration: 'underline' }}>
                      {r.event_title?.slice(0, 40) ?? 'event'}
                    </Link>
                  ) : '—'}
                  {r.overall_confidence != null && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                      conf {Number(r.overall_confidence).toFixed(0)}%
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {r.structured_data_found ? 'structured' : 'no structure'}
                  {r.ai_used && <div>AI{r.ai_model ? ` (${r.ai_model.split('-').slice(1, 3).join(' ')})` : ''}</div>}
                </td>
                <td style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {r.total_ms != null && <>{(r.total_ms / 1000).toFixed(1)}s</>}
                  {r.ai_input_tokens != null && (
                    <div>{r.ai_input_tokens}/{r.ai_output_tokens ?? 0} tok</div>
                  )}
                </td>
                <td>{RETRYABLE.has(r.status) && <RetryExtraction id={r.id} />}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--text-faint)' }}>
                {sourceFilter || statusFilter
                  ? 'No extractions match these filters.'
                  : 'No extractions yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
