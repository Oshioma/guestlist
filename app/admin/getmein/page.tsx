// ADMIN → GET ME IN: the queue. What members have asked for, what it will
// take, and how the last thirty days went.

import Link from 'next/link';
import { adminQueue, STATUS_LABEL, declineReasonLabel, type RequestStatus } from '@/lib/accessRequests';
import { requestOverview } from '@/lib/membershipStats';
import { formatPence } from '@/lib/membership';
import { fmtDate, fmtEventDate, formatPrice } from '@/lib/util';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

export default async function AdminGetMeInPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: rawView } = await searchParams;
  const view = rawView === 'done' || rawView === 'all' ? rawView : 'open';
  const [rows, stats] = await Promise.all([adminQueue(view), requestOverview()]);

  return (
    <main>
      <h1 className="adminTitle">GET ME IN</h1>
      <p className="adminSub">Members asking Guestlist to get them in. Every request is a reason to talk to a promoter.</p>

      <div className="statGrid">
        {([
          [String(stats.open), 'Open now'],
          [String(stats.requests_month), 'Requests this month'],
          [pct(stats.fulfilment_rate), 'Fulfilled · 30d'],
          [pct(stats.free_rate), 'Free entry · 30d'],
          [pct(stats.discount_rate), 'Discount · 30d'],
          [formatPence(stats.cost_30d_pence), 'Cost · 30d'],
          [formatPence(stats.cost_lifetime_pence), 'Cost · all time'],
          [stats.avg_cost_pence == null ? '—' : formatPence(stats.avg_cost_pence), 'Avg cost / fulfilled'],
          [stats.requests_per_member == null ? '—' : String(stats.requests_per_member), 'Requests / member · 30d'],
          [String(stats.direct_guestlist_30d), 'Straight onto a promoter list · 30d'],
        ] as [string, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v" style={{ fontSize: 22 }}>{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="statePills" style={{ marginBottom: 14 }}>
        {(['open', 'done', 'all'] as const).map((k) => (
          <Link key={k} href={`/admin/getmein?view=${k}`} className={`statePill${view === k ? ' active' : ''}`}>{k === 'open' ? 'Needs the desk' : k === 'done' ? 'Decided' : 'Everything'}</Link>
        ))}
      </div>

      {rows.length === 0 && <p className="adminSub">Nothing here.</p>}
      {rows.map((r) => (
        <Link href={`/admin/getmein/${r.id}`} className="reviewCard" key={r.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', textDecoration: 'none' }}>
          <div>
            <h3>
              {r.title}
              <span className={`evChip ${['confirmed_free', 'purchased_by_guestlist', 'attended'].includes(r.status) ? 'green' : r.status === 'unavailable' ? 'red' : r.status === 'discounted' ? 'amber' : ''}`} style={{ marginLeft: 10 }}>
                {STATUS_LABEL[r.status as RequestStatus]}{r.entry_status && r.status === 'requested' ? ` · promoter list ${r.entry_status}` : ''}
              </span>
              {r.places > 1 && <span className="evChip amber" style={{ marginLeft: 6 }}>ME +1</span>}
            </h3>
            <div className="facts">
              <span>Member: <b>{r.member_name}</b> ({r.member_requests_month} this month · {formatPence(r.member_lifetime_cost_pence)} lifetime)</span>
              <span>When: <b>{fmtEventDate(r.start_at, r.end_at, r.timezone)}</b></span>
              {r.venue_name && <span>Venue: <b>{r.venue_name}</b>{r.city && `, ${r.city}`}</span>}
              <span>Ticket: <b>{formatPrice(r.price_from, r.price_to, r.event_currency) ?? 'unknown'}</b></span>
              <span>Promoter: <b>{r.promoter_name ?? 'none on Guestlist'}</b>{r.relationship_status && r.relationship_status !== 'none' && ` · ${r.relationship_status}`}{r.promoter_contact_email || r.promoter_contact_phone ? ' · contact known' : r.promoter_name ? ' · no contact yet' : ''}</span>
              <span>Asked: <b>{fmtDate(r.requested_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b></span>
              {r.event_requests > 1 && <span><b>{r.event_requests}</b> members want this event</span>}
              {r.decline_reason && <span>Why: <b>{declineReasonLabel(r.decline_reason)}</b></span>}
            </div>
            {r.member_note && <div className="warnList" style={{ color: 'var(--text-muted)' }}>“{r.member_note}”</div>}
          </div>
          <div className="actions"><span className="btnGhost" style={{ textAlign: 'center' }}>Open →</span></div>
        </Link>
      ))}

      <div className="deskGrid" style={{ marginTop: 34 }}>
        <div>
          <div className="sectionLabel">Events members want most · 90d</div>
          {stats.top_events.length === 0 && <p className="adminSub">No requests yet.</p>}
          {stats.top_events.map((e) => (
            <div className="attentionRow" key={e.id}>
              <span><Link href={`/events/${e.slug}`} style={{ textDecoration: 'underline' }}><b>{e.title}</b></Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{fmtDate(e.start_at, 'Europe/London', { day: 'numeric', month: 'short' })}</span></span>
              <span style={{ fontSize: 12.5 }}>{e.n} asked · {e.fulfilled} in</span>
            </div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Why requests failed</div>
          {stats.by_reason.length === 0 && <p className="adminSub">Nothing declined yet.</p>}
          {stats.by_reason.map((x) => (
            <div className="attentionRow" key={x.reason}><span>{declineReasonLabel(x.reason)}</span><b>{x.n}</b></div>
          ))}
        </div>
        <div>
          <div className="sectionLabel">Promoters getting members in</div>
          {stats.top_promoters.length === 0 && <p className="adminSub">No promoter has supplied a place yet.</p>}
          {stats.top_promoters.map((p) => (
            <div className="attentionRow" key={p.id}>
              <span><Link href={`/promoters/${p.slug}`} style={{ textDecoration: 'underline' }}><b>{p.name}</b></Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{p.relationship_status}</span></span>
              <span style={{ fontSize: 12.5 }}>{p.successes} of {p.requests}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
