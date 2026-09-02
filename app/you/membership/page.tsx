// YOUR MEMBERSHIP — the member area. Not a dashboard of coupons: your
// membership, your events, offers worth your time, what's dropping, and
// what being part of Guestlist is doing for others.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { billingEnabled, currentMemberWithMembership, formatPence, getPlan, membershipLabel } from '@/lib/membership';
import { memberRequests } from '@/lib/accessRequests';
import { listApprovedBusinesses, memberClaims, offerHeadline } from '@/lib/market';
import { liveDrops, liveGoodCauses, memberDropClaims } from '@/lib/drops';
import { fmtEventDate } from '@/lib/util';
import { ManageMembership } from '@/components/membership/ManageMembership';
import { DropClaim } from '@/components/membership/DropClaim';
import { MemberBadge } from '@/components/membership/MemberBadge';

export const dynamic = 'force-dynamic';

// Upcoming first; a night that has finished (six hours' grace) is history.
function splitRequests<T extends { start_at: string; end_at: string | null; friendly: { key: string } }>(rows: T[]) {
  const cutoff = Date.now() - 6 * 3600_000;
  const upcoming = rows.filter((r) => new Date(r.end_at ?? r.start_at).getTime() > cutoff && r.friendly.key !== 'cancelled');
  return { upcoming, past: rows.filter((r) => !upcoming.includes(r)) };
}

const fmtMonth = (s: string) => new Date(s).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const fmtDay = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function YourMembershipPage() {
  const me = await currentMemberWithMembership();
  if (!me) redirect('/login?next=/you/membership');
  const [plan, requests, businesses, claims, drops, dropClaims, causes] = await Promise.all([
    getPlan(), memberRequests(me.id), listApprovedBusinesses({ featuredOnly: true, limit: 6 }),
    memberClaims(me.id, 6), me.isMember ? liveDrops() : Promise.resolve([]), memberDropClaims(me.id), liveGoodCauses(),
  ]);
  const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
  const m = me.membership;
  const { upcoming, past } = splitRequests(requests);
  const since = m?.member_since ? fmtMonth(m.member_since) : null;
  const periodEnd = m?.current_period_end ? fmtDay(m.current_period_end) : null;
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

      <div className="memberGrid">
        <section className="youPanel">
          <h2 className="youPanelTitle">Your membership</h2>
          <p className="youPanelSub">{me.isMember ? 'Part of Guestlist.' : 'Not a member yet.'}</p>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{membershipLabel(m)}</div>
          {membershipMeta && <div className="youHistoryMeta" style={{ marginTop: 4 }}>{membershipMeta}</div>}
          {m?.status === 'past_due' && (
            <p className="youHistoryMeta" style={{ color: 'var(--danger)', marginTop: 8 }}>Your last payment didn’t go through. Update your card and everything carries on.</p>
          )}
          <div className="youPanelActions">
            {me.isMember && m?.billing_source === 'stripe' && billingEnabled() && <ManageMembership label={m.status === 'past_due' ? 'Update payment' : 'Manage or cancel'} />}
            {!me.isMember && <Link href="/membership" className="btnAccent">{billingEnabled() ? `Join — ${price}/month` : 'Join the waitlist'}</Link>}
            <Link href="/membership/terms" className="youHistoryMeta" style={{ textDecoration: 'underline' }}>Membership terms</Link>
          </div>
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

        <section className="youPanel wide">
          <h2 className="youPanelTitle">Your events</h2>
          <p className="youPanelSub">Requests and confirmed guestlists. See something you want to go to? Press GET ME IN on the event.</p>
          {upcoming.length === 0 && (
            <div className="impactBox">Nothing on the list yet. <Link href="/events" style={{ textDecoration: 'underline' }}>Find something →</Link></div>
          )}
          {upcoming.map((r) => (
            <div className="requestRow" key={r.id}>
              <div>
                <Link href={`/events/${r.slug}`} className="title">{r.title}</Link>
                <div className="meta">
                  {fmtEventDate(r.start_at, r.end_at, r.timezone)}{r.venue_name && ` · ${r.venue_name}`}{r.city && ` · ${r.city}`}
                  {r.places > 1 && ' · you +1'}
                  {r.friendly.key === 'discount' && r.member_price_pence != null && ` · ${formatPence(r.member_price_pence, r.currency)}`}
                </div>
                {r.friendly.key !== 'working' && <div className="meta">{r.friendly.body}</div>}
              </div>
              <span className={`reqChip ${r.friendly.key}`}>{r.friendly.key === 'working' ? 'Working on it' : r.friendly.title}</span>
            </div>
          ))}
          {past.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="youHistoryMeta" style={{ cursor: 'pointer' }}>Past requests ({past.length})</summary>
              {past.map((r) => (
                <div className="requestRow" key={r.id}>
                  <div>
                    <Link href={`/events/${r.slug}`} className="title">{r.title}</Link>
                    <div className="meta">{fmtEventDate(r.start_at, r.end_at, r.timezone)}</div>
                  </div>
                  <span className={`reqChip ${r.friendly.key}`}>{r.friendly.key === 'working' ? 'Closed' : r.friendly.title}</span>
                </div>
              ))}
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
      </div>
    </main>
  );
}
