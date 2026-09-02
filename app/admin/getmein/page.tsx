// ADMIN → REQUESTS: GET ME IN and ASK GUESTLIST in one inbox. What members
// have asked for, what it will take, how the last thirty days went — and
// what members want that Guestlist does not have yet.

import Link from 'next/link';
import { adminQueue, STATUS_LABEL, outcomeReasonLabel, requestTypeLabel, type QueueKind, type RequestStatus } from '@/lib/accessRequests';
import { externalDemand, requestOverview } from '@/lib/membershipStats';
import { formatPence } from '@/lib/membership';
import { fmtDate, fmtEventDate, formatPrice } from '@/lib/util';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

export default async function AdminGetMeInPage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === 'done' || sp.view === 'all' ? sp.view : 'open';
  const kind: QueueKind = sp.kind === 'get_me_in' || sp.kind === 'ask_guestlist' ? sp.kind : 'all';
  const [rows, stats, demand] = await Promise.all([adminQueue(view, kind), requestOverview(), externalDemand()]);
  const qs = (v: string, k: string) => `/admin/getmein?view=${v}&kind=${k}`;

  return (
    <main>
      <h1 className="adminTitle">Requests</h1>
      <p className="adminSub">GET ME IN (an event on Guestlist) and ASK GUESTLIST (anything else). Every request is a reason to talk to a promoter.</p>

      <div className="statGrid">
        {([
          [String(stats.open), 'Open now'],
          [String(stats.requests_month), 'Requests this month'],
          [String(demand.asks_30d), 'Asks · 30d'],
          [pct(stats.fulfilment_rate), 'Fulfilled · 30d'],
          [pct(stats.free_rate), 'Free entry · 30d'],
          [pct(stats.discount_rate), 'Discount · 30d'],
          [formatPence(stats.cost_30d_pence), 'Cost · 30d'],
          [formatPence(stats.cost_lifetime_pence), 'Cost · all time'],
          [stats.avg_cost_pence == null ? '—' : formatPence(stats.avg_cost_pence), 'Avg cost / fulfilled'],
          [String(stats.direct_guestlist_30d), 'Straight onto a promoter list · 30d'],
        ] as [string, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v" style={{ fontSize: 22 }}>{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="statePills" style={{ marginBottom: 8 }}>
        {(['open', 'done', 'all'] as const).map((k) => (
          <Link key={k} href={qs(k, kind)} className={`statePill${view === k ? ' active' : ''}`}>{k === 'open' ? 'Needs the desk' : k === 'done' ? 'Decided' : 'Everything'}</Link>
        ))}
      </div>
      <div className="statePills" style={{ marginBottom: 14 }}>
        {(['all', 'get_me_in', 'ask_guestlist'] as const).map((k) => (
          <Link key={k} href={qs(view, k)} className={`statePill${kind === k ? ' active' : ''}`}>{k === 'all' ? 'Both' : k === 'get_me_in' ? 'GET ME IN' : 'ASK GUESTLIST'}</Link>
        ))}
      </div>

      {rows.length === 0 && <p className="adminSub">Nothing here.</p>}
      {rows.map((r) => {
        const title = r.title ?? r.external_name ?? r.external_host ?? requestTypeLabel(r.request_type);
        const when = r.start_at ? fmtEventDate(r.start_at, r.end_at, r.timezone ?? 'Europe/London') : r.external_starts_at ? fmtDate(r.external_starts_at, 'Europe/London', { day: 'numeric', month: 'short' }) : 'date unknown';
        return (
          <Link href={`/admin/getmein/${r.id}`} className="reviewCard" key={r.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', textDecoration: 'none' }}>
            <div>
              <h3>
                <span className={`originChip${r.origin === 'ask_guestlist' ? ' ask' : ''}`} style={{ marginRight: 8 }}>{r.origin === 'ask_guestlist' ? 'Ask Guestlist' : 'Get me in'}</span>
                {title}
                <span className={`evChip ${['confirmed_free', 'purchased_by_guestlist', 'attended', 'answered'].includes(r.status) ? 'green' : r.status === 'unavailable' ? 'red' : r.status === 'discounted' ? 'amber' : ''}`} style={{ marginLeft: 10 }}>
                  {STATUS_LABEL[r.status as RequestStatus]}{r.entry_status && r.status === 'requested' ? ` · promoter list ${r.entry_status}` : ''}
                </span>
                {r.request_type !== 'event_access' && <span className="evChip" style={{ marginLeft: 6 }}>{requestTypeLabel(r.request_type)}</span>}
                {r.places > 1 && <span className="evChip amber" style={{ marginLeft: 6 }}>ME +1</span>}
                {!r.event_id && r.external_url && <span className="evChip amber" style={{ marginLeft: 6 }}>{r.suggested_title ? 'possible match' : 'not on Guestlist'}</span>}
              </h3>
              <div className="facts">
                <span>Member: <b>{r.member_name}</b>{r.member_status && ` · ${r.member_status}${r.member_billing_source && r.member_billing_source !== 'stripe' ? ` (${r.member_billing_source})` : ''}`} · {r.member_requests_month} this month · {formatPence(r.member_lifetime_cost_pence)} lifetime</span>
                <span>When: <b>{when}</b></span>
                {(r.venue_name || r.external_venue) && <span>Venue: <b>{r.venue_name ?? r.external_venue}</b>{(r.city ?? r.external_city) && `, ${r.city ?? r.external_city}`}</span>}
                {!r.venue_name && !r.external_venue && (r.city ?? r.external_city) && <span>City: <b>{r.city ?? r.external_city}</b></span>}
                <span>Ticket: <b>{r.event_id ? (formatPrice(r.price_from, r.price_to, r.event_currency) ?? 'unknown') : r.external_price_pence != null ? formatPence(r.external_price_pence, r.currency) : 'unknown'}</b></span>
                <span>Promoter: <b>{r.promoter_name ?? 'none yet'}</b>{r.relationship_status && r.relationship_status !== 'none' && ` · ${r.relationship_status}`}{r.promoter_contact_email || r.promoter_contact_phone ? ' · contact known' : r.promoter_name ? ' · no contact yet' : ''}</span>
                <span>Asked: <b>{fmtDate(r.requested_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b></span>
                {r.event_requests > 1 && <span><b>{r.event_requests}</b> members want this event</span>}
                {r.outcome_reason && <span>Why: <b>{outcomeReasonLabel(r.outcome_reason)}</b></span>}
              </div>
              {r.external_url && <div className="externalBlock">🔗 {r.external_url}{r.external_lineup && ` · ${r.external_lineup}`}</div>}
              {r.member_note && <div className="warnList" style={{ color: 'var(--text-muted)' }}>“{r.member_note}”</div>}
            </div>
            <div className="actions"><span className="btnGhost" style={{ textAlign: 'center' }}>Open →</span></div>
          </Link>
        );
      })}

      <h2 className="adminTitle" style={{ marginTop: 40 }}>What members want that we don’t have</h2>
      <p className="adminSub">External requests are demand signals: events we’re missing, promoters members care about, venues and cities with unmet demand.</p>
      <div className="statGrid">
        {([
          [String(demand.external), 'External events asked for'],
          [String(demand.linked), 'Linked to Guestlist'],
          [String(demand.created), 'Imported as events'],
          [String(demand.fulfilled), 'Asks fulfilled'],
          [String(demand.declined), 'Asks declined'],
          [String(demand.promoters_assigned), 'Promoters identified'],
          [String(demand.new_relationships), 'New promoter conversations'],
        ] as [string, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v" style={{ fontSize: 22 }}>{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="deskGrid">
        <div>
          <div className="sectionLabel">Events we’re missing</div>
          {demand.wanted.length === 0 && <p className="adminSub">No external requests yet.</p>}
          {demand.wanted.map((w) => (
            <div className="attentionRow" key={w.id}>
              <span><Link href={`/admin/getmein/${w.id}`} style={{ textDecoration: 'underline' }}><b>{w.name ?? w.host ?? 'Unnamed'}</b></Link>
                <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> {w.host && w.name ? `· ${w.host}` : ''}{w.city && ` · ${w.city}`}{w.starts_at && ` · ${fmtDate(w.starts_at, 'Europe/London', { day: 'numeric', month: 'short' })}`}</span></span>
              <span style={{ fontSize: 12.5 }}>{w.n} ask{w.n === 1 ? '' : 's'} · {STATUS_LABEL[w.status as RequestStatus]}</span>
            </div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Where the links come from</div>
          {demand.by_host.length === 0 && <p className="adminSub">—</p>}
          {demand.by_host.map((h) => (
            <div className="attentionRow" key={h.host}><span><b>{h.host}</b></span><span style={{ fontSize: 12.5 }}>{h.n} asks · {h.members} members · {h.fulfilled} in</span></div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Kinds of ask</div>
          {demand.by_type.map((t) => (
            <div className="attentionRow" key={t.request_type}><span>{requestTypeLabel(t.request_type)}</span><b>{t.n}</b></div>
          ))}
        </div>
        <div>
          <div className="sectionLabel">Promoters in asks</div>
          {demand.by_promoter.length === 0 && <p className="adminSub">No promoter assigned to an ask yet.</p>}
          {demand.by_promoter.map((p) => (
            <div className="attentionRow" key={p.id}>
              <span><Link href={`/promoters/${p.slug}`} style={{ textDecoration: 'underline' }}><b>{p.name}</b></Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{p.relationship_status}</span></span>
              <span style={{ fontSize: 12.5 }}>{p.fulfilled} of {p.n}</span>
            </div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Venues members are trying to reach</div>
          {demand.by_venue.length === 0 && <p className="adminSub">—</p>}
          {demand.by_venue.map((v) => (
            <div className="attentionRow" key={`${v.venue}-${v.city}`}><span><b>{v.venue}</b>{v.city && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> · {v.city}</span>}</span><b>{v.n}</b></div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Cities with demand</div>
          {demand.by_city.length === 0 && <p className="adminSub">—</p>}
          {demand.by_city.map((c) => (
            <div className="attentionRow" key={c.city}><span>{c.city}</span><b>{c.n}</b></div>
          ))}
          <div className="sectionLabel" style={{ marginTop: 26 }}>Why requests failed</div>
          {stats.by_reason.length === 0 && <p className="adminSub">Nothing declined yet.</p>}
          {stats.by_reason.map((x) => (
            <div className="attentionRow" key={x.reason}><span>{outcomeReasonLabel(x.reason)}</span><b>{x.n}</b></div>
          ))}
        </div>
      </div>

      <div className="deskGrid" style={{ marginTop: 34 }}>
        <div>
          <div className="sectionLabel">Guestlist events members want most · 90d</div>
          {stats.top_events.length === 0 && <p className="adminSub">No requests yet.</p>}
          {stats.top_events.map((e) => (
            <div className="attentionRow" key={e.id}>
              <span><Link href={`/events/${e.slug}`} style={{ textDecoration: 'underline' }}><b>{e.title}</b></Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{fmtDate(e.start_at, 'Europe/London', { day: 'numeric', month: 'short' })}</span></span>
              <span style={{ fontSize: 12.5 }}>{e.n} asked · {e.fulfilled} in</span>
            </div>
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
