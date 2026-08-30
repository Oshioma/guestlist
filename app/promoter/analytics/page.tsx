// Promoter dashboard — ANALYTICS. Real, aggregate data only.

import Link from 'next/link';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import {
  audienceInsights, eventPerformance, promoterStats, type RangeDays,
} from '@/lib/promoterAnalytics';

export const dynamic = 'force-dynamic';

const RANGES: [RangeDays, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']];

export default async function PromoterAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/analytics">{null}</DashShell>;
  }
  const promoter = ctx.active;
  const days = ([7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30) as RangeDays;

  const [stats, topEvents, insights] = await Promise.all([
    promoterStats(promoter.id, days),
    eventPerformance(promoter.id, { days, limit: 8 }),
    audienceInsights(promoter.id, days),
  ]);
  const ctr = stats.views > 0 ? ((stats.ticketClicks / stats.views) * 100).toFixed(1) : null;
  const byViews = [...topEvents].sort((a, b) => b.views - a.views);

  return (
    <DashShell ctx={ctx} tab="/analytics">
      <div className="statePills" style={{ marginBottom: 20 }}>
        {RANGES.map(([d, label]) => (
          <Link key={d} href={`/promoter/analytics?days=${d}${ctx.promoterships.length > 1 ? `&p=${promoter.id}` : ''}`}
                className={`statePill${days === d ? ' active' : ''}`}>
            {label}
          </Link>
        ))}
      </div>

      <div className="statGrid">
        {([
          [stats.views, 'Event views'],
          [stats.uniqueViewers, 'Unique viewers'],
          [stats.ticketClicks, `Ticket clicks${ctr ? ` · ${ctr}% CTR` : ''}`],
          [stats.interested, 'Interested'],
          [stats.going, 'Going'],
          [stats.saves, 'Saves'],
          [stats.shares, 'Shares'],
          [stats.followers, 'Followers (total)'],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}>
            <div className="v">{v.toLocaleString()}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <div className="sectionLabel">Top events</div>
      {byViews.length ? (
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead>
              <tr><th>Event</th><th>Views</th><th>Ticket clicks</th><th>CTR</th><th>Interested</th><th>Going</th></tr>
            </thead>
            <tbody>
              {byViews.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/events/${e.slug}`} style={{ textDecoration: 'underline' }}>{e.title}</Link></td>
                  <td>{e.views.toLocaleString()}</td>
                  <td>{e.ticket_clicks.toLocaleString()}</td>
                  <td>{e.views > 0 ? `${((e.ticket_clicks / e.views) * 100).toFixed(1)}%` : '—'}</td>
                  <td>{e.interested}</td>
                  <td>{e.going}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="adminSub">No activity in this period yet.</p>
      )}

      <div className="detailColumns" style={{ paddingTop: 26, paddingBottom: 40 }}>
        <div>
          <div className="sectionLabel">Top member cities</div>
          {insights.topCities.length ? (
            insights.topCities.map((c) => (
              <div className="attentionRow" key={c.city}>
                <span>{c.city}</span><b>{c.n}</b>
              </div>
            ))
          ) : (
            <p className="adminSub">Not enough aggregate data yet — this fills in as members engage.</p>
          )}
        </div>
        <div>
          <div className="sectionLabel">Top genres by engagement</div>
          {insights.topGenres.length ? (
            insights.topGenres.map((g) => (
              <div className="attentionRow" key={g.name}>
                <span>{g.name}</span><b>{g.n}</b>
              </div>
            ))
          ) : (
            <p className="adminSub">No genre engagement in this period.</p>
          )}
        </div>
      </div>
    </DashShell>
  );
}
