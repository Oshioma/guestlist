// Promoter dashboard — OVERVIEW: quick stats, next events, events needing
// attention, onboarding checklist, recent notifications.

import Link from 'next/link';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { followerStats } from '@/lib/announcements';
import { eventPerformance, eventsNeedingAttention, promoterStats } from '@/lib/promoterAnalytics';
import { query, queryOne } from '@/lib/db';
import { fmtEventDate } from '@/lib/util';
import { PerfCard } from '@/components/promoter/PerfCard';
import { MemberAsks } from '@/components/promoter/MemberAsks';
import { promoterOpenAsks } from '@/lib/accessRequests';
import { roleAtLeast } from '@/lib/promoterAuth';

export const dynamic = 'force-dynamic';

export default async function PromoterOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="">{null}</DashShell>;
  }
  const promoter = ctx.active;

  const [stats, followers, upcoming, attention, notifications, source, liveCount, asks] = await Promise.all([
    promoterStats(promoter.id, 30),
    followerStats(promoter.id),
    eventPerformance(promoter.id, { days: 30, upcomingOnly: true, limit: 5 }),
    eventsNeedingAttention(promoter.id),
    query<{ id: string; type: string; created_at: string; payload: Record<string, unknown> }>(
      `select id, type, created_at::text, payload from promoter_notifications
        where promoter_id = $1 order by created_at desc limit 5`,
      [promoter.id]
    ),
    queryOne<{ id: string }>(`select id from event_sources where promoter_id = $1 limit 1`, [promoter.id]),
    queryOne<{ n: number }>(
      `select count(*)::int as n from events where promoter_id = $1 and status = 'live'`,
      [promoter.id]
    ),
    promoterOpenAsks(promoter.id),
  ]);

  const steps: [string, boolean, string][] = [
    ['Complete your profile', !!(promoter.description && promoter.image_url), '/promoter/profile'],
    ['Connect your website', !!source, '/promoter/sources'],
    ['Review discovered events', attention.every((a) => !a.issues.includes('awaiting confirmation')), '/promoter/events'],
    ['Publish your first event', (liveCount?.n ?? 0) > 0, '/promoter/events'],
    ['See your analytics', true, '/promoter/analytics'],
  ];
  const showOnboarding = steps.slice(0, 4).some(([, done]) => !done);

  const NOTIF_TEXT: Record<string, string> = {
    events_found: 'New events found from your website',
    event_needs_review: 'An event needs review',
    event_published: 'Event published',
    ticket_url_missing: 'An event is missing its ticket link',
    possible_duplicate: 'A possible duplicate was flagged',
    claim_approved: 'Your profile claim was approved',
    source_failing: 'We’re having trouble reading your website',
  };

  return (
    <DashShell ctx={ctx} tab="">
      <div className="statGrid">
        {([
          [upcoming.length, 'Upcoming events'],
          [stats.views, 'Event views · 30d'],
          [stats.ticketClicks, 'Ticket clicks · 30d'],
          [stats.interested, 'Interested · 30d'],
          [stats.going, 'Going · 30d'],
          [stats.followers, `Followers · +${followers.new_30d} this month`],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}>
            <div className="v">{v.toLocaleString()}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      {(followers.top_cities.length > 0 || followers.top_genres.length > 0) && (
        <p className="youHistoryMeta" style={{ marginTop: 2 }}>
          {[
            followers.top_cities.length > 0 && `Top cities: ${followers.top_cities.map((c) => c.city).join(', ')}`,
            followers.top_genres.length > 0 && `Top genres: ${followers.top_genres.map((g) => g.genre).join(', ')}`,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {showOnboarding && (
        <div className="sideCard" style={{ maxWidth: 460 }}>
          <div className="big" style={{ marginBottom: 8 }}>Welcome to Guestlist</div>
          {steps.map(([label, done, href], i) => (
            <Link href={href} key={label} className={`onboardStep${done ? ' done' : ''}`} style={{ display: 'flex' }}>
              <span className="tick">{done ? '✓' : i + 1}</span>
              {label}
            </Link>
          ))}
        </div>
      )}

      {asks.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 26 }}>Guestlist members asking ({asks.length})</div>
          <p className="adminSub">Members pay Guestlist to get into things. Put them on your list in one press — we send their pass and handle the rest. Can’t this time? Hand it back and we’ll find another way.</p>
          <MemberAsks promoterId={promoter.id} asks={asks} canAct={roleAtLeast(ctx.active.role, 'editor')} querySuffix={ctx.promoterships.length > 1 ? `?p=${promoter.id}` : ''} />
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 26 }}>Your next events</div>
      {upcoming.length ? (
        upcoming.map((e) => <PerfCard key={e.id} event={e} promoterId={promoter.id} />)
      ) : (
        <p className="adminSub">
          Nothing upcoming. <Link href="/promoter/events/new" style={{ color: 'var(--accent-ink, var(--accent))' }}>Create an event</Link>{' '}
          or <Link href="/promoter/sources" style={{ color: 'var(--accent-ink, var(--accent))' }}>connect your website</Link>.
        </p>
      )}

      {attention.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 26 }}>Events needing attention</div>
          {attention.map((e) => (
            <div className="attentionRow" key={e.id}>
              <span>
                <b>{e.title}</b>{' '}
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                  {fmtEventDate(e.start_at, null, 'Europe/London')}
                </span>
              </span>
              <span className="issues">{e.issues.join(' · ')}</span>
              <Link className="btnGhost" style={{ padding: '5px 12px', fontSize: 11 }} href={`/promoter/events/${e.id}`}>
                Fix
              </Link>
            </div>
          ))}
        </>
      )}

      {notifications.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 26 }}>Recent activity</div>
          {notifications.map((n) => (
            <div className="attentionRow" key={n.id}>
              <span>{NOTIF_TEXT[n.type] ?? n.type}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </>
      )}
    </DashShell>
  );
}
