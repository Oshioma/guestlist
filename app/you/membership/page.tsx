// YOUR MEMBERSHIP — the member area. Not a dashboard of coupons: your
// membership, ASK GUESTLIST, your requests, offers worth your time, what's
// dropping, and what being part of Guestlist is doing for others.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { billingEnabled, currentMemberWithMembership, formatPence, getPlan, membershipLabel } from '@/lib/membership';
import { memberGuestlisted, memberRequests, requestTypeLabel, type MemberRequest } from '@/lib/accessRequests';
import { doorUrl } from '@/lib/doorPass';
import { listApprovedBusinesses, memberClaims, offerHeadline } from '@/lib/market';
import { liveDrops, liveGoodCauses, memberDropClaims } from '@/lib/drops';
import { fmtEventDate } from '@/lib/util';
import { ManageMembership } from '@/components/membership/ManageMembership';
import { memberRefunds } from '@/lib/membershipAdmin';
import { DropClaim } from '@/components/membership/DropClaim';
import { MemberBadge } from '@/components/membership/MemberBadge';

export const dynamic = 'force-dynamic';

// Live first; a night that has finished (six hours' grace) is history. A
// request with no date yet stays live for a month.
function splitRequests(rows: MemberRequest[]) {
  const now = Date.now();
  const live = rows.filter((r) => {
    if (r.friendly.key === 'cancelled') return false;
    const when = r.end_at ?? r.start_at;
    return when ? new Date(when).getTime() > now - 6 * 3600_000 : new Date(r.requested_at).getTime() > now - 30 * 86400_000;
  });
  return { live, past: rows.filter((r) => !live.includes(r)) };
}

const fmtMonth = (s: string) => new Date(s).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const fmtDay = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function RequestLine({ r, closed = false }: { r: MemberRequest; closed?: boolean }) {
  const when = r.start_at ? fmtEventDate(r.start_at, r.end_at, r.timezone ?? 'Europe/London') : `asked ${fmtDay(r.requested_at)}`;
  // A small picture of the night: the event's own, or its initial when it
  // has none (an ask about a link we do not have yet has nothing to show).
  const thumb = r.image_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="requestThumb" src={r.image_url} alt="" loading="lazy" />
    : <span className="requestThumb fallback" aria-hidden>{(r.title || '?').trim().charAt(0).toUpperCase()}</span>;
  return (
    <div className="requestRow withThumb">
      {r.slug ? <Link href={`/events/${r.slug}`} className="requestThumbLink">{thumb}</Link> : thumb}
      <div>
        {r.slug ? <Link href={`/events/${r.slug}`} className="title">{r.title}</Link> : <span className="title">{r.title}</span>}
        <div className="meta">
          {[
            r.origin === 'ask_guestlist' && r.request_type !== 'event_access' ? requestTypeLabel(r.request_type) : null,
            when, r.venue_name, r.city,
            r.places > 1 ? 'you +1' : null,
            r.friendly.key === 'discount' && r.member_price_pence != null ? formatPence(r.member_price_pence, r.currency) : null,
          ].filter(Boolean).join(' · ')}
        </div>
        {!closed && r.friendly.key !== 'working' && <div className="meta">{r.friendly.body}</div>}
      </div>
      <span className={`reqChip ${r.friendly.key}`}>{closed && r.friendly.key === 'working' ? 'Closed' : r.friendly.key === 'working' ? 'Working on it' : r.friendly.title}</span>
    </div>
  );
}

export default async function YourMembershipPage() {
  const me = await currentMemberWithMembership();
  if (!me) redirect('/login?next=/you/membership');
  const [plan, requests, businesses, claims, drops, dropClaims, causes, guestlisted] = await Promise.all([
    getPlan(), memberRequests(me.id), listApprovedBusinesses({ featuredOnly: true, limit: 6 }),
    memberClaims(me.id, 6), me.isMember ? liveDrops() : Promise.resolve([]), memberDropClaims(me.id), liveGoodCauses(),
    memberGuestlisted(me.id),
  ]);
  const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
  const m = me.membership;
  const { live: liveAll, past } = splitRequests(requests);
  // Nights already on the door list lead the page; no need to list them twice.
  const onList = new Set(guestlisted.map((g) => g.event_id));
  const live = liveAll.filter((r) => !(r.event_id && r.entry_status === 'confirmed' && onList.has(r.event_id)));
  const since = m?.member_since ? fmtMonth(m.member_since) : null;
  const periodEnd = m?.current_period_end ? fmtDay(m.current_period_end) : null;
  const refunds = m?.billing_source === 'stripe' ? await memberRefunds(me.id) : [];
  const membershipMeta = [
    me.isMember && m?.billing_source === 'stripe' ? `${price}/month` : null,
    me.isMember && m?.billing_source === 'stripe' && periodEnd ? `${m.cancel_at_period_end ? 'ends' : 'renews'} ${periodEnd}` : null,
    me.isMember && m?.billing_source !== 'stripe' && periodEnd ? `until ${periodEnd}` : null,
    since ? `since ${since}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <main className="wrap youWrap">
      <div className="memberHead">
        <div>
          <h1 className="pageTitle">Your membership</h1>
          {me.isMember && <MemberBadge style={{ marginTop: 6 }} />}
        </div>
        <Link href="/you" className="btnGhost">Your Guestlist →</Link>
      </div>

      {guestlisted.length > 0 && (
        <section className="glPanel" aria-label="You’re on the guestlist">
          <div className="glKicker">Guestlist Membership</div>
          <h2 className="glTitle">You’re on the guestlist.</h2>
          <p className="glSub">{guestlisted.length === 1 ? 'One night sorted.' : `${guestlisted.length} nights sorted.`} Bring ID, arrive before the list closes, and show your pass at the door.</p>
          <div className="glGrid">
            {guestlisted.map((g) => (
              <article className="glCard" key={g.entry_id}>
                <Link href={`/events/${g.slug}`} className="glArt">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {g.image_url ? <img src={g.image_url} alt="" loading="lazy" /> : <span className="glArtFallback" aria-hidden>{g.title.trim().charAt(0).toUpperCase()}</span>}
                </Link>
                <div className="glBody">
                  <span className="reqChip guestlisted glChip">{g.checked_in_at ? 'CHECKED IN' : 'ON THE GUESTLIST'}</span>
                  <Link href={`/events/${g.slug}`} className="glName">{g.title}</Link>
                  <div className="glMeta">{[fmtEventDate(g.start_at, g.end_at, g.timezone ?? 'Europe/London'), g.venue_name, g.city].filter(Boolean).join(' · ')}</div>
                  <div className="glMeta">Under your name{g.plus_ones > 0 ? `, you +${g.plus_ones}` : ''}, with {g.promoter_name}.</div>
                  <div className="glActions">
                    <a href={doorUrl(g.entry_id)} className="btnAccent" target="_blank" rel="noopener noreferrer">Your pass →</a>
                    <Link href={`/events/${g.slug}`} className="btnGhost">Event</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="memberGrid">
        <section className="youPanel">
          <h2 className="youPanelTitle">Your membership</h2>
          <p className="youPanelSub">{me.isMember ? 'Part of Guestlist.' : 'Not a member yet.'}</p>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{membershipLabel(m)}</div>
          {membershipMeta && <div className="youHistoryMeta" style={{ marginTop: 4 }}>{membershipMeta}</div>}
          {refunds.length > 0 && (
            <div className="youHistoryMeta" style={{ marginTop: 6 }}>
              {refunds.map((r) => <div key={r.id}>Refunded {formatPence(r.amount_pence, r.currency)} on {new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — back on your card within 5–10 days.</div>)}
            </div>
          )}
          {m?.status === 'past_due' && (
            <p className="youHistoryMeta" style={{ color: 'var(--danger)', marginTop: 8 }}>Your last payment didn’t go through. Update your card and everything carries on.</p>
          )}
          <div className="youPanelActions">
            {me.isMember && m?.billing_source === 'stripe' && billingEnabled() && <ManageMembership label={m.status === 'past_due' ? 'Update payment' : 'Manage or cancel'} />}
            {!me.isMember && <Link href="/membership" className="btnAccent">{billingEnabled() ? `Join — ${price}/month` : 'Join the waitlist'}</Link>}
            <Link href="/membership/terms" className="youHistoryMeta" style={{ textDecoration: 'underline' }}>Membership terms</Link>
          </div>
        </section>

        <section className="youPanel askPanelMember">
          <h2 className="youPanelTitle">Ask Guestlist</h2>
          <p className="youPanelSub">Want to go somewhere? Need a +1? Found an event we don’t have? Ask us.</p>
          <div className="youPanelActions">
            {me.isMember
              ? <Link href="/you/ask?context=membership_area" className="btnAccent">Ask Guestlist</Link>
              : <Link href="/membership" className="btnAccent">Members ask Guestlist</Link>}
            <span className="youHistoryMeta">Paste a link from anywhere — Instagram, RA, a flyer.</span>
          </div>
        </section>

        <section className="youPanel wide">
          <h2 className="youPanelTitle">Your requests</h2>
          <p className="youPanelSub">Everything you’ve asked us for. On an event page, press GET ME IN; anywhere else, Ask Guestlist.</p>
          {live.length === 0 && (
            <div className="impactBox">Nothing open right now. <Link href="/events" style={{ textDecoration: 'underline' }}>Find something →</Link>{me.isMember && <> or <Link href="/you/ask" style={{ textDecoration: 'underline' }}>ask Guestlist</Link>.</>}</div>
          )}
          {live.map((r) => <RequestLine key={r.id} r={r} />)}
          {past.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="youHistoryMeta" style={{ cursor: 'pointer' }}>Past requests ({past.length})</summary>
              {past.map((r) => <RequestLine key={r.id} r={r} closed />)}
            </details>
          )}
        </section>

        <section className="youPanel">
          <h2 className="youPanelTitle">Member drops</h2>
          <p className="youPanelSub">Current special opportunities.</p>
          {!me.isMember && <div className="impactBox">Drops are for members: surprise tickets, last-minute lists, secret parties.</div>}
          {me.isMember && drops.length === 0 && <div className="impactBox">Nothing dropping right now. You’ll hear first.</div>}
          {drops.map((d) => (
            <div className="requestRow" key={d.id}>
              <div>
                <div className="title">{d.title}</div>
                {d.body && <div className="meta">{d.body}</div>}
                <div className="meta">
                  {d.event_slug && <Link href={`/events/${d.event_slug}`} style={{ textDecoration: 'underline' }}>{d.event_title}</Link>}
                  {[
                    d.places != null ? `${Math.max(0, d.places - d.claims)} of ${d.places} left` : null,
                    d.ends_at ? `until ${new Date(d.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : null,
                  ].filter(Boolean).map((s, i) => <span key={i}>{i > 0 || d.event_slug ? ' · ' : ''}{s}</span>)}
                </div>
              </div>
              {d.link_url ? (
                <a className="btnAccent" href={d.link_url} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 14px', fontSize: 11 }}>Open</a>
              ) : (
                <DropClaim dropId={d.id} initialClaimed={dropClaims.has(d.id)} full={d.places != null && d.claims >= d.places} />
              )}
            </div>
          ))}
        </section>

        <section className="youPanel">
          <h2 className="youPanelTitle">Market offers</h2>
          <p className="youPanelSub">Independent businesses we like, giving you something extra.</p>
          {claims.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {claims.filter((c) => c.status === 'claimed').slice(0, 3).map((c) => (
                <div className="requestRow" key={c.id}>
                  <div>
                    <div className="title">{c.business_name}</div>
                    <div className="meta">{offerHeadline({ title: c.offer_title, offer_type: c.offer_type, discount_percent: c.discount_percent, discount_amount_pence: c.discount_amount_pence, currency: c.currency })}</div>
                  </div>
                  <Link href={`/market/claims/${c.id}`} className="btnAccent" style={{ padding: '8px 14px', fontSize: 11 }}>Show code</Link>
                </div>
              ))}
            </div>
          )}
          {businesses.length === 0 && claims.length === 0 && <div className="impactBox">The first Market businesses are being chosen. <Link href="/market" style={{ textDecoration: 'underline' }}>See the Market →</Link></div>}
          {businesses.map((b) => (
            <div className="requestRow" key={b.id}>
              <div>
                <Link href={`/market/${b.slug}`} className="title">{b.name}</Link>
                <div className="meta">{b.offer ? offerHeadline(b.offer) : b.tagline ?? b.category_name}</div>
              </div>
              <Link href={`/market/${b.slug}`} className="btnGhost" style={{ padding: '6px 12px', fontSize: 11 }}>View</Link>
            </div>
          ))}
          <div className="youPanelActions"><Link href="/market" className="youHistoryMeta" style={{ textDecoration: 'underline' }}>Everything in the Market →</Link></div>
        </section>

        <section className="youPanel">
          <h2 className="youPanelTitle">Your impact</h2>
          <p className="youPanelSub">Do good for others.</p>
          {causes.length > 0 ? (
            <div>
              {causes.map((c) => (
                <div className="requestRow" key={c.id}>
                  <div>
                    <div className="title">{c.title}</div>
                    {c.summary && <div className="meta">{c.summary}</div>}
                  </div>
                  {c.link_url && <a className="btnGhost" href={c.link_url} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', fontSize: 11 }}>More</a>}
                </div>
              ))}
            </div>
          ) : (
            <div className="impactBox">
              Being part of Guestlist contributes something positive. The community projects the membership supports will appear here as they’re confirmed — with what they are, not just a number.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
