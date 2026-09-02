// ADMIN → GET ME IN → one request. Everything needed to fulfil it on one
// screen: the event, the member (and their history and what they've cost),
// the promoter (and who to call, and how the relationship stands), the
// timeline, and the actions.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminRequestDetail, STATUS_LABEL, declineReasonLabel, type RequestStatus } from '@/lib/accessRequests';
import { formatPence } from '@/lib/membership';
import { fmtDate, fmtEventDate, fmtEventTime, formatPrice } from '@/lib/util';
import { GetMeInDesk } from '@/components/admin/GetMeInDesk';
import { PromoterRelationship } from '@/components/admin/PromoterRelationship';

export const dynamic = 'force-dynamic';

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await adminRequestDetail(id);
  if (!r) notFound();
  const ms = r.member_summary;
  const ps = r.promoter_stats;

  return (
    <main>
      <p className="adminSub" style={{ marginBottom: 6 }}><Link href="/admin/getmein" style={{ textDecoration: 'underline' }}>← GET ME IN</Link></p>
      <h1 className="adminTitle" style={{ marginBottom: 4 }}>{r.title}</h1>
      <p className="adminSub">
        <span className={`evChip ${['confirmed_free', 'purchased_by_guestlist', 'attended'].includes(r.status) ? 'green' : r.status === 'unavailable' ? 'red' : r.status === 'discounted' ? 'amber' : ''}`}>{STATUS_LABEL[r.status as RequestStatus]}</span>
        {r.entry_status && <span className="evChip" style={{ marginLeft: 6 }}>door list: {r.entry_status}</span>}
        <span className={`evChip ${r.places > 1 ? 'amber' : ''}`} style={{ marginLeft: 6 }}>{r.places > 1 ? 'ME +1' : 'JUST ME'}</span>
        {r.decline_reason && <span className="evChip red" style={{ marginLeft: 6 }}>{declineReasonLabel(r.decline_reason)}</span>}
      </p>

      <GetMeInDesk requestId={r.id} status={r.status} hasPromoter={!!r.promoter_id} currency={r.currency} places={r.places} memberName={r.member_name} />

      <div className="deskGrid" style={{ marginTop: 18 }}>
        <div>
          <div className="adminCard">
            <div className="sectionLabel" style={{ marginTop: 0 }}>The event</div>
            <div className="facts" style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
              <span><Link href={`/events/${r.slug}`} style={{ textDecoration: 'underline' }}><b>{r.title}</b></Link> · <Link href={`/admin/events/${r.event_id}`} style={{ textDecoration: 'underline' }}>edit</Link></span>
              <span>{fmtEventDate(r.start_at, r.end_at, r.timezone)} · {fmtEventTime(r.start_at, r.end_at, r.timezone)}</span>
              <span>{[r.venue_name, r.city].filter(Boolean).join(', ') || 'Venue unknown'}</span>
              <span>Ticket price: <b>{formatPrice(r.price_from, r.price_to, r.event_currency) ?? 'unknown'}</b>{r.ticket_url && <> · <a href={r.ticket_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>tickets ↗</a></>}</span>
              <span>{r.event_requests} member{r.event_requests === 1 ? '' : 's'} asked about this event</span>
            </div>
          </div>

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>The request</div>
            <div className="facts" style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
              <span>Asked {fmtDate(r.requested_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · <b>{r.places === 1 ? 'just them' : 'them +1'}</b></span>
              {r.member_note && <span>Member said: “{r.member_note}”</span>}
              {r.fulfilment_method && <span>How: <b>{r.fulfilment_method.replace('_', ' ')}</b></span>}
              <span>Cost to Guestlist: <b>{formatPence(r.guestlist_cost_pence, r.currency)}</b>{r.ticket_value_pence != null && <> · ticket value {formatPence(r.ticket_value_pence, r.currency)} each</>}{r.member_price_pence != null && <> · member price {formatPence(r.member_price_pence, r.currency)}</>}</span>
              {r.member_message && <span>Told the member: “{r.member_message}”</span>}
              {r.decided_at && <span>Decided {fmtDate(r.decided_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            {r.admin_notes && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10 }}>{r.admin_notes}</pre>}
          </div>

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>Timeline</div>
            <ul className="timeline">
              {r.timeline.map((t) => (
                <li key={t.id}>
                  <div className="when">{fmtDate(t.created_at, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {t.actor_name ?? 'system'}</div>
                  {t.from_status !== t.to_status && t.to_status && <b>{STATUS_LABEL[t.to_status as RequestStatus] ?? t.to_status} </b>}
                  {t.note}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <div className="adminCard">
            <div className="sectionLabel" style={{ marginTop: 0 }}>The member</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{r.member_slug ? <Link href={`/members/${r.member_slug}`} style={{ textDecoration: 'underline' }}>{r.member_name}</Link> : r.member_name}</div>
            <div className="adminSub" style={{ marginBottom: 10 }}>{r.member_email}</div>
            <div className="statGrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
              {([
                [String(ms.requests_month), 'This month'], [String(ms.requests_lifetime), 'All time'], [String(ms.free_entries), 'Free entries'],
                [String(ms.discounts), 'Discounts'], [String(ms.declined), 'Declined'], [formatPence(ms.cost_lifetime_pence), 'Cost lifetime'],
              ] as [string, string][]).map(([v, l]) => (
                <div className="statTile" key={l} style={{ padding: 10 }}><div className="v" style={{ fontSize: 18 }}>{v}</div><div className="l">{l}</div></div>
              ))}
            </div>
            {ms.plus_ones > 0 && <div className="adminSub" style={{ marginBottom: 8 }}>{ms.plus_ones} request{ms.plus_ones === 1 ? '' : 's'} with a +1.</div>}
            <div className="sectionLabel">History</div>
            {r.member_history.filter((h) => h.id !== r.id).slice(0, 8).map((h) => (
              <div className="attentionRow" key={h.id}>
                <span><Link href={`/admin/getmein/${h.id}`} style={{ textDecoration: 'underline' }}>{h.title}</Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{fmtDate(h.start_at, 'Europe/London', { day: 'numeric', month: 'short' })}</span></span>
                <span style={{ fontSize: 12 }}>{STATUS_LABEL[h.status]}{h.guestlist_cost_pence > 0 && ` · ${formatPence(h.guestlist_cost_pence)}`}</span>
              </div>
            ))}
            {r.member_history.length <= 1 && <p className="adminSub">First request.</p>}
          </div>

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>The promoter</div>
            {!r.promoter_id ? (
              <p className="adminSub">This event has no promoter on Guestlist. <Link href={`/admin/events/${r.event_id}`} style={{ textDecoration: 'underline' }}>Set one on the event</Link> to track the relationship.</p>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700 }}><Link href={`/promoters/${r.promoter_slug}`} style={{ textDecoration: 'underline' }}>{r.promoter_name}</Link> <span className="evChip" style={{ marginLeft: 6 }}>{r.relationship_status}</span></div>
                <div className="adminSub" style={{ marginBottom: 8 }}>
                  {r.promoter_website && <a href={r.promoter_website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', marginRight: 10 }}>website ↗</a>}
                  {r.promoter_socials?.instagram && <a href={r.promoter_socials.instagram} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', marginRight: 10 }}>instagram ↗</a>}
                  {r.standard_allocation && <span>Allocation: <b>{r.standard_allocation}</b></span>}
                </div>
                {ps && (
                  <div className="statGrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
                    {([
                      [String(ps.requests), 'Requests'], [String(ps.members_sent), 'Members sent'], [String(ps.free_places), 'Free places'],
                      [String(ps.discounted_places), 'Discounted'], [String(ps.tickets_bought), 'Bought'], [formatPence(ps.value_delivered_pence), 'Value delivered'],
                    ] as [string, string][]).map(([v, l]) => (
                      <div className="statTile" key={l} style={{ padding: 10 }}><div className="v" style={{ fontSize: 18 }}>{v}</div><div className="l">{l}</div></div>
                    ))}
                  </div>
                )}
                <PromoterRelationship
                  promoterId={r.promoter_id}
                  contacts={r.contacts}
                  initial={{
                    contactEmail: r.promoter_contact_email ?? '', contactPhone: r.promoter_contact_phone ?? '',
                    relationshipStatus: r.relationship_status ?? 'none', relationshipNotes: r.relationship_notes ?? '',
                    standardAllocation: r.standard_allocation ?? '', allocationNotes: r.allocation_notes ?? '',
                  }}
                />
                <div className="sectionLabel" style={{ marginTop: 14 }}>Conversations</div>
                {r.outreach.length === 0 && <p className="adminSub">No outreach logged yet.</p>}
                <ul className="timeline">
                  {r.outreach.map((o) => (
                    <li key={o.id}>
                      <div className="when">{fmtDate(o.created_at, 'Europe/London', { day: 'numeric', month: 'short' })} · {o.actor_name ?? '—'} · {o.direction} · {o.channel}{o.event_title && ` · ${o.event_title}`}</div>
                      <b>{o.outcome.replace('_', ' ')}{o.places_offered != null && ` (${o.places_offered} places)`}</b> — {o.summary}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
