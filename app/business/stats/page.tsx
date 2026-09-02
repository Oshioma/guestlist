// Business portal — STATS. Real counts only; nothing invented.

import { businessDashContext } from '@/lib/marketAuth';
import { businessStats } from '@/lib/market';
import { BusinessShell } from '@/components/business/BusinessShell';

export const dynamic = 'force-dynamic';

export default async function BusinessStatsPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const ctx = await businessDashContext((await searchParams).b);
  if (ctx.kind !== 'ok') return <BusinessShell ctx={ctx} tab="/stats">{null}</BusinessShell>;
  const s = await businessStats(ctx.active.id);
  return (
    <BusinessShell ctx={ctx} tab="/stats">
      <div className="statGrid">
        {([
          [s.views_30d, 'Page views · 30d'], [s.claims_30d, 'Claims · 30d'], [s.redemptions_30d, 'Redeemed · 30d'],
          [s.claims_total, 'Claims · all time'], [s.redemptions_total, 'Redeemed · all time'], [s.unique_members, 'Members reached'],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v">{v.toLocaleString()}</div><div className="l">{l}</div></div>
        ))}
      </div>
      <div className="sectionLabel">Recent claims</div>
      {s.recent.length === 0 && <p className="adminSub">Nothing claimed yet.</p>}
      {s.recent.map((r, i) => (
        <div className="attentionRow" key={i}>
          <span><b>…{r.code_tail}</b> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{r.offer_title}</span></span>
          <span className={`evChip ${r.status === 'redeemed' ? 'green' : r.status === 'claimed' ? 'amber' : ''}`}>{r.status}</span>
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{new Date(r.redeemed_at ?? r.claimed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
    </BusinessShell>
  );
}
