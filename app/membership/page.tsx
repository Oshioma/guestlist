// GET IN. — the membership page. It sells belonging, not a subscription:
// you go out, you discover things, Guestlist gets you into things, you
// support independent businesses, you get looked after, and being part of
// it does some good.
//
// Live from the day the design is ready. Before payments are switched on it
// reads COMING SOON and collects a waitlist; the same page becomes the real
// checkout the moment STRIPE_SECRET_KEY exists.

import Link from 'next/link';
import { MembershipBenefits } from '@/components/membership/MembershipBenefits';
import { billingEnabled, currentMemberWithMembership, formatPence, getPlan, isOnWaitlist } from '@/lib/membership';
import { liveGoodCauses } from '@/lib/drops';
import { listApprovedBusinesses } from '@/lib/market';
import { JoinCta } from '@/components/membership/JoinCta';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { MarketArt } from '@/components/market/MarketArt';
import { MemberHome } from '@/components/membership/MemberHome';
import { MembershipGallery, MembershipHeroImage } from '@/components/membership/MembershipGallery';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guestlist Membership — GET IN.' };

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const me = await currentMemberWithMembership();
  // Someone who has joined does not need selling to. Same address, their page.
  if (me?.isMember) return <MemberHome me={me} />;
  const [plan, live, causes, businesses, sp] = await Promise.all([
    getPlan(), Promise.resolve(billingEnabled()), liveGoodCauses(),
    listApprovedBusinesses({ featuredOnly: true, limit: 4 }), searchParams,
  ]);
  const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
  const onWaitlist = me ? await isOnWaitlist(me.id) : false;

  return (
    <main className="wrap">
      <ClubTrack type="membership_page_viewed" />
      <section className="mbHero">
        <MembershipHeroImage />
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

      <MembershipGallery />

      <MembershipBenefits variant="prospect" causes={causes} />

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
