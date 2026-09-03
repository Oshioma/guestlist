// ADMIN → REQUESTS → one request. Everything needed to fulfil it on one
// screen: the event (or what the member told us about one we don't have),
// the member (membership, history, cost), the promoter (who to call, where
// the relationship stands), the timeline, and the actions.

import Link from 'next/link';
import { FAIR_USE_WATCH } from '@/lib/accessRequests';
import { notFound } from 'next/navigation';
import { adminRequestDetail, STATUS_LABEL, outcomeReasonLabel, requestTypeLabel, type RequestStatus } from '@/lib/accessRequests';
import { formatPence } from '@/lib/membership';
import { fmtDate, fmtEventDate, fmtEventTime, formatPrice } from '@/lib/util';
import { GetMeInDesk } from '@/components/admin/GetMeInDesk';
import { PromoterRelationship } from '@/components/admin/PromoterRelationship';

export const dynamic = 'force-dynamic';

const stamp = (s: string) => fmtDate(s, 'Europe/London', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await adminRequestDetail(id);
  if (!r) notFound();
  const ms = r.member_summary;
  const ps = r.promoter_stats;
  const heading = r.title ?? r.external_name ?? r.external_host ?? requestTypeLabel(r.request_type);
  const isAsk = r.origin === 'ask_guestlist';

  return (
    <main>
      <p className="adminSub" style={{ marginBottom: 6 }}><Link href="/admin/getmein" style={{ textDecoration: 'underline' }}>← Requests</Link></p>
      <h1 className="adminTitle" style={{ marginBottom: 4 }}>
        <span className={`originChip${isAsk ? ' ask' : ''}`} style={{ marginRight: 10, verticalAlign: 'middle' }}>{isAsk ? 'Ask Guestlist' : 'Get me in'}</span>{heading}
      </h1>
      <p className="adminSub">
        <span className={`evChip ${['confirmed_free', 'purchased_by_guestlist', 'attended', 'answered'].includes(r.status) ? 'green' : r.status === 'unavailable' ? 'red' : r.status === 'discounted' ? 'amber' : ''}`}>{STATUS_LABEL[r.status as RequestStatus]}</span>
        <span className="evChip" style={{ marginLeft: 6 }}>{requestTypeLabel(r.request_type)}</span>
        {r.entry_status && <span className="evChip" style={{ marginLeft: 6 }}>door list: {r.entry_status}</span>}
        <span className={`evChip ${r.places > 1 ? 'amber' : ''}`} style={{ marginLeft: 6 }}>{r.places > 1 ? 'ME +1' : 'JUST ME'}</span>
        {!r.event_id && <span className="evChip amber" style={{ marginLeft: 6 }}>not linked to a Guestlist event</span>}
        {r.outcome_reason && <span className="evChip red" style={{ marginLeft: 6 }}>{outcomeReasonLabel(r.outcome_reason)}</span>}
        {r.context && <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>via {r.context.replace('_', ' ')}</span>}
      </p>

      <GetMeInDesk
        requestId={r.id} status={r.status} hasEvent={!!r.event_id} hasPromoter={!!r.promoter_id} currency={r.currency}
        places={r.places} memberName={r.member_name} requestType={r.request_type} externalUrl={r.external_url}
        alreadyImported={!!r.import_submission_id}
        suggested={r.suggested_event_id && r.suggested_title ? { id: r.suggested_event_id, title: r.suggested_title } : null}
      />

      <div className="deskGrid" style={{ marginTop: 18 }}>
        <div>
          {r.event_id ? (
            <div className="adminCard">
              <div className="sectionLabel" style={{ marginTop: 0 }}>The event</div>
              <div className="facts" style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
                <span><Link href={`/events/${r.slug}`} style={{ textDecoration: 'underline' }}><b>{r.title}</b></Link> · <Link href={`/admin/events/${r.event_id}`} style={{ textDecoration: 'underline' }}>edit</Link>{r.match_confidence && r.match_confidence !== 'admin' && <> · matched by {r.match_confidence}</>}</span>
                {r.start_at && <span>{fmtEventDate(r.start_at, r.end_at, r.timezone ?? 'Europe/London')} · {fmtEventTime(r.start_at, r.end_at, r.timezone ?? 'Europe/London')}</span>}
                <span>{[r.venue_name, r.city].filter(Boolean).join(', ') || 'Venue unknown'}</span>
                <span>Ticket price: <b>{formatPrice(r.price_from, r.price_to, r.event_currency) ?? 'unknown'}</b>{r.ticket_url && <> · <a href={r.ticket_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>tickets ↗</a></>}</span>
                <span>{r.event_requests} member{r.event_requests === 1 ? '' : 's'} asked about this event</span>
              </div>
            </div>
          ) : (
            <div className="adminCard">
              <div className="sectionLabel" style={{ marginTop: 0 }}>{r.external_url || r.external_name ? 'The event — not on Guestlist' : 'The ask'}</div>
              <div className="facts" style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
                {r.external_name && <span><b>{r.external_name}</b></span>}
                {r.external_url && <span>Link: <a href={r.external_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', wordBreak: 'break-all' }}>{r.external_url}</a> <span style={{ color: 'var(--text-faint)' }}>({r.external_host})</span></span>}
                {(r.external_venue || r.external_city || r.external_country) && <span>Where: <b>{[r.external_venue, r.external_city, r.external_country].filter(Boolean).join(', ')}</b></span>}
                <span>When: <b>{r.external_starts_at ? stamp(r.external_starts_at) : 'not given'}</b></span>
                <span>Ticket price: <b>{r.external_price_pence != null ? formatPence(r.external_price_pence, r.currency) : 'not given'}</b></span>
                {r.external_lineup && <span>Lineup: <b>{r.external_lineup}</b></span>}
                {r.suggested_title && <span>Possible match on Guestlist: <b>{r.suggested_title}</b> ({r.match_confidence}) — confirm with Link it above</span>}
                {r.same_ask > 0 && <span><b>{r.same_ask}</b> other member{r.same_ask === 1 ? '' : 's'} sent the same link</span>}
                {r.import_submission_id && <span>Sent through the import pipeline{r.created_event_id ? <> — <Link href={`/admin/events/${r.created_event_id}`} style={{ textDecoration: 'underline' }}>draft event</Link></> : ' — in the review queue'}</span>}
                {!r.external_url && !r.external_name && <span style={{ color: 'var(--text-faint)' }}>Nothing structured — read the member’s note and answer.</span>}
              </div>
            </div>
          )}

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>The request</div>
            <div className="facts" style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
              <span>Asked {stamp(r.requested_at)} · <b>{r.places === 1 ? 'just them' : 'them +1'}</b> · {requestTypeLabel(r.request_type)}</span>
              {r.member_note && <span>Member said: “{r.member_note}”</span>}
              {r.fulfilment_method && <span>How: <b>{r.fulfilment_method.replace('_', ' ')}</b></span>}
              <span>Cost to Guestlist: <b>{formatPence(r.guestlist_cost_pence, r.currency)}</b>{r.ticket_value_pence != null && <> · ticket value {formatPence(r.ticket_value_pence, r.currency)} each</>}{r.member_price_pence != null && <> · member price {formatPence(r.member_price_pence, r.currency)}</>}</span>
              {r.member_message && <span>Told the member: “{r.member_message}”</span>}
              {r.decided_at && <span>Decided {stamp(r.decided_at)}</span>}
            </div>
            {r.admin_notes && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10 }}>{r.admin_notes}</pre>}
          </div>

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>Timeline</div>
            <ul className="timeline">
              {r.timeline.map((t) => (
                <li key={t.id}>
                  <div className="when">{stamp(t.created_at)} · {t.actor_name ?? 'system'}</div>
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
            {r.member_requests_week >= FAIR_USE_WATCH.asksPerWeek && <div style={{ marginTop: 4 }}><span className="evChip amber" title="Information only — nothing is restricted automatically">Heavy week · {r.member_requests_week} asks in 7 days</span></div>}
            <div className="adminSub" style={{ marginBottom: 6 }}>{r.member_email}</div>
            <div className="adminSub" style={{ marginBottom: 10 }}>
              Membership: <span className={`evChip ${r.member_status === 'active' || r.member_status === 'trialing' ? 'green' : r.member_status === 'past_due' ? 'amber' : 'red'}`}>{r.member_status ?? 'none'}</span>
              {r.member_billing_source && r.member_billing_source !== 'stripe' && <span className="evChip" style={{ marginLeft: 6 }}>{r.member_billing_source}</span>}
            </div>
            <div className="statGrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
              {([
                [String(ms.requests_month), 'This month'], [String(ms.requests_lifetime), 'All time'], [String(ms.asks), 'Asks'],
                [String(ms.free_entries), 'Free entries'], [String(ms.discounts), 'Discounts'], [String(ms.declined), 'Declined'],
                [formatPence(ms.cost_lifetime_pence), 'Cost lifetime'], [String(ms.plus_ones), '+1 asks'], [String(ms.purchased), 'Bought'],
              ] as [string, string][]).map(([v, l]) => (
                <div className="statTile" key={l} style={{ padding: 10 }}><div className="v" style={{ fontSize: 18 }}>{v}</div><div className="l">{l}</div></div>
              ))}
            </div>
            <div className="sectionLabel">History</div>
            {r.member_history.filter((h) => h.id !== r.id).slice(0, 8).map((h) => (
              <div className="attentionRow" key={h.id}>
                <span><Link href={`/admin/getmein/${h.id}`} style={{ textDecoration: 'underline' }}>{h.title}</Link> <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{h.start_at ? fmtDate(h.start_at, 'Europe/London', { day: 'numeric', month: 'short' }) : ''}{h.origin === 'ask_guestlist' ? ' · ask' : ''}</span></span>
                <span style={{ fontSize: 12 }}>{STATUS_LABEL[h.status]}{h.guestlist_cost_pence > 0 && ` · ${formatPence(h.guestlist_cost_pence)}`}</span>
              </div>
            ))}
            {r.member_history.length <= 1 && <p className="adminSub">First request.</p>}
          </div>

          <div className="adminCard" style={{ marginTop: 14 }}>
            <div className="sectionLabel" style={{ marginTop: 0 }}>The promoter</div>
            {!r.promoter_id ? (
              <p className="adminSub">{r.event_id ? <>This event has no promoter on Guestlist. <Link href={`/admin/events/${r.event_id}`} style={{ textDecoration: 'underline' }}>Set one on the event</Link>, or assign one above.</> : 'Nobody identified yet. Find who runs it, then Assign promoter above — every ask should start a relationship.'}</p>
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
                      [String(ps.external_requests), 'From asks'], [String(ps.outreach), 'Conversations'], [String(ps.declined), 'Declined'],
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
