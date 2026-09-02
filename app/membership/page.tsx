// GET IN. — the membership page. It sells belonging, not a subscription:
// you go out, you discover things, Guestlist gets you into things, you
// support independent businesses, you get looked after, and being part of
// it does some good.
//
// Live from the day the design is ready. Before payments are switched on it
// reads COMING SOON and collects a waitlist; the same page becomes the real
// checkout the moment STRIPE_SECRET_KEY exists.

import Link from 'next/link';
import { billingEnabled, currentMemberWithMembership, formatPence, getPlan, isOnWaitlist } from '@/lib/membership';
import { liveGoodCauses } from '@/lib/drops';
import { listApprovedBusinesses } from '@/lib/market';
import { JoinCta } from '@/components/membership/JoinCta';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { MarketArt } from '@/components/market/MarketArt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guestlist Membership — GET IN.' };

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const [me, plan, live, causes, businesses, sp] = await Promise.all([
    currentMemberWithMembership(), getPlan(), Promise.resolve(billingEnabled()), liveGoodCauses(),
    listApprovedBusinesses({ featuredOnly: true, limit: 4 }), searchParams,
  ]);
  const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
  const onWaitlist = me ? await isOnWaitlist(me.id) : false;

  return (
    <main className="wrap">
      <ClubTrack type="membership_page_viewed" />
      <section className="mbHero">
        <div className="mbKicker">{live ? 'Guestlist Membership' : 'Guestlist Membership · Coming soon'}</div>
        <h1 className="mbTitle">Get in.</h1>
        <p className="mbPrice">Guestlist Membership — {price}/month</p>
        <p className="mbLead">
          Free entrance to parties. Queue jumps. Member offers. Independent businesses.
          And a membership that does some good along the way.
        </p>
        {sp.cancelled && <p className="mbErr" style={{ marginBottom: 14 }}>No charge was made. Whenever you’re ready.</p>}
        <JoinCta mode={live ? 'checkout' : 'waitlist'} isSignedIn={!!me} isMember={!!me?.isMember} onWaitlist={onWaitlist} price={price} />
      </section>

      <div className="mbBenefits">
        <div className="mbBenefit lead">
          <h3>Get in free</h3>
          <p>See an event you want to go to? Ask Guestlist. We’ll try to arrange free entrance through the promoter, the venue, our own allocations — or by buying access where that’s reasonable. Members get free entrance to parties whenever we can make it happen.</p>
          <div className="small">Subject to availability and fair use.</div>
        </div>
        <div className="mbBenefit">
          <h3>Queue jump</h3>
          <p>Priority and fast-track entrance where available, through participating events and venues. Less time on the pavement, more time inside.</p>
        </div>
        <div className="mbBenefit">
          <h3>Member prices</h3>
          <p>When we can’t get a member in free, we can often arrange a discounted ticket or a special Guestlist price instead.</p>
        </div>
        <div className="mbBenefit">
          <h3>Guestlist Market</h3>
          <p>Special offers from independent businesses selected by Guestlist — restaurants, bars, record shops, studios, clothing, places to stay. People we like, giving members something extra.</p>
          <div className="small"><Link href="/market" style={{ textDecoration: 'underline' }}>Browse the Market →</Link></div>
        </div>
        <div className="mbBenefit">
          <h3>Member drops</h3>
          <p>Surprise tickets, last-minute guestlists, special events, secret parties and other occasional opportunities. You’ll hear first.</p>
        </div>
        <div className="mbBenefit">
          <h3>Do good for others</h3>
          <p>Being part of Guestlist contributes something positive. Members support community projects chosen with the community — and see exactly what those projects are.</p>
          {causes.length > 0 ? (
            <div className="small">{causes.map((c) => c.title).join(' · ')}</div>
          ) : (
            <div className="small">The first projects will be announced to members. Nothing is claimed here until it’s real.</div>
          )}
        </div>
      </div>

      {businesses.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div className="sectionLabel">In the Market</div>
          <div className="marketGrid" style={{ marginTop: 10 }}>
            {businesses.map((b) => (
              <Link key={b.id} href={`/market/${b.slug}`} className="marketCard">
                <div className="art">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {b.hero_image_url ? <img src={b.hero_image_url} alt="" /> : <MarketArt name={b.name} category={b.category_name} />}
                </div>
                <div className="body">
                  <div className="marketCategory">{b.category_name ?? 'Independent'}</div>
                  <h3>{b.name}</h3>
                  {b.offer && <div className="marketOfferLine">{b.offer.title}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mbStatement">
        I go out. I discover things. Guestlist gets me into things. I support independent businesses.
        I get looked after. <span>And being part of it does something positive.</span>
      </p>

      <div className="mbBenefits" style={{ marginTop: 10 }}>
        <div className="mbBenefit lead" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
          <div>
            <h3 style={{ fontSize: 'clamp(22px, 4vw, 34px)' }}>{live ? `Join Guestlist — ${price}/month` : 'Be first in'}</h3>
            <p>{live ? 'Cancel any time from your membership page.' : `${price}/month when it opens. No payment today.`}</p>
          </div>
          <JoinCta mode={live ? 'checkout' : 'waitlist'} isSignedIn={!!me} isMember={!!me?.isMember} onWaitlist={onWaitlist} price={price} />
        </div>
      </div>

      <div className="mbFoot">
        <span className="adminSub" style={{ margin: 0 }}>
          Free entrance is subject to availability and fair use; not every event is included, and organisers keep the final say at the door.
        </span>
        <Link href="/membership/terms" className="btnGhost">Membership terms</Link>
      </div>
    </main>
  );
}
