// Promoter dashboard — FOLLOWERS. Aggregate only, always: totals, growth,
// top cities and genres above the privacy floor, and follower engagement
// with this promoter's events. Never individual identities, never contact
// data, nothing exportable.

import Link from 'next/link';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { followerStats } from '@/lib/announcements';

export const dynamic = 'force-dynamic';

export default async function PromoterFollowersPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/followers">{null}</DashShell>;
  }
  const stats = await followerStats(ctx.active.id);
  const q = ctx.promoterships.length > 1 ? `?p=${ctx.active.id}` : '';

  return (
    <DashShell ctx={ctx} tab="/followers">
      <div className="statGrid">
        {([
          [stats.total, 'Followers'],
          [stats.new_7d, 'New this week'],
          [stats.new_30d, 'New in 30 days'],
          [stats.new_90d, 'New in 90 days'],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}>
            <div className="v">{v.toLocaleString()}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <div className="followerStatGrid">
        <div className="announceStat">
          <span>Top follower cities</span>
          {stats.top_cities.length > 0
            ? stats.top_cities.map((c) => (
                <div key={c.city} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 14 }}>{c.city}</strong>
                  <span>{c.n}</span>
                </div>
              ))
            : <strong style={{ fontSize: 13 }}>Not enough data yet</strong>}
        </div>
        <div className="announceStat">
          <span>Top follower genres</span>
          {stats.top_genres.length > 0
            ? stats.top_genres.map((g) => (
                <div key={g.genre} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 14 }}>{g.genre}</strong>
                  <span>{g.n}</span>
                </div>
              ))
            : <strong style={{ fontSize: 13 }}>Not enough data yet</strong>}
        </div>
        <div className="announceStat">
          <span>Follower engagement (30 days)</span>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Event views</strong><span>{stats.engagement.views_30d}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Interested</strong><span>{stats.engagement.interested_30d}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Going</strong><span>{stats.engagement.going_30d}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Ticket clicks</strong><span>{stats.engagement.ticket_clicks_30d}</span>
          </div>
        </div>
      </div>

      {stats.insight && (
        <p className="youHistoryMeta" style={{ marginTop: 4 }}>💡 {stats.insight}</p>
      )}

      <p className="youHistoryMeta" style={{ marginTop: 14 }}>
        Followers are shown as aggregates only — Guestlist never shares
        member names, emails or private activity, and breakdowns appear only
        above a minimum group size.
      </p>

      <div style={{ marginTop: 18 }}>
        <Link href={`/promoter/announce${q}`} className="btnAccent">Announce to followers →</Link>
      </div>
    </DashShell>
  );
}
