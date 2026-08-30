// Promoter dashboard — SOURCES: connect your website, see feed status,
// scan now, pause/resume.

import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { query, queryOne } from '@/lib/db';
import { fmtDate } from '@/lib/util';
import { SourceFeedPanel } from '@/components/promoter/SourceFeedPanel';
import { roleAtLeast } from '@/lib/promoterAuth';

export const dynamic = 'force-dynamic';

export default async function PromoterSourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/sources">{null}</DashShell>;
  }
  const promoter = ctx.active;

  const source = await queryOne<{
    id: string; url: string; feed_url: string | null; active: boolean; trust: string;
    last_checked_at: string | null; last_success_at: string | null; failure_count: number;
    polling_enabled: boolean; poll_frequency_hours: number;
  }>(
    `select id, url, feed_url, active, trust, last_checked_at::text, last_success_at::text,
            failure_count, polling_enabled, poll_frequency_hours
       from event_sources where promoter_id = $1 order by created_at asc limit 1`,
    [promoter.id]
  );
  const upcomingFound = source
    ? (await queryOne<{ n: number }>(
        `select count(*)::int as n from events
          where promoter_id = $1 and status = 'live'
            and coalesce(end_at, start_at + interval '6 hours') > now()
            and listing_status <> 'cancelled'`,
        [promoter.id]
      ))?.n ?? 0
    : 0;
  const lastScan = source
    ? await queryOne<{ candidates_found: number; new_candidates: number; extracted: number; failed: number; status: string; started_at: string }>(
        `select candidates_found, new_candidates, extracted, failed, status, started_at::text
           from source_scans where source_id = $1 order by started_at desc limit 1`,
        [source.id]
      )
    : null;
  const pending = (await queryOne<{ n: number }>(
    `select count(*)::int as n from events where promoter_id = $1 and status in ('new','needs_review')`,
    [promoter.id]
  ))?.n ?? 0;

  return (
    <DashShell ctx={ctx} tab="/sources">
      <div className="sectionLabel">Your event feed</div>
      <SourceFeedPanel
        promoterId={promoter.id}
        canManage={roleAtLeast(promoter.role, 'admin')}
        canScan={roleAtLeast(promoter.role, 'editor')}
        source={source ? {
          url: source.url,
          active: source.active,
          blocked: source.trust === 'blocked',
          trusted: source.trust === 'trusted',
          lastChecked: source.last_checked_at
            ? fmtDate(source.last_checked_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : null,
          failureCount: source.failure_count,
          pollingHours: source.polling_enabled ? source.poll_frequency_hours : null,
          hasFeed: !!source.feed_url,
        } : null}
        upcomingFound={upcomingFound}
        pendingReview={pending}
        lastScan={lastScan ? {
          when: fmtDate(lastScan.started_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          candidates: lastScan.candidates_found,
          newCandidates: lastScan.new_candidates,
          extracted: lastScan.extracted,
          failed: lastScan.failed,
          ok: lastScan.status === 'succeeded',
        } : null}
      />
      {source?.trust === 'trusted' && (
        <p className="adminSub" style={{ marginTop: 14 }}>
          Your source is marked TRUSTED by Guestlist — clean, high-confidence
          events from your website can publish automatically.
        </p>
      )}
    </DashShell>
  );
}
