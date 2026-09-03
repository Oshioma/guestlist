// /membership for someone who has already joined. The sales page has done
// its job; this is the welcome mat — what is live for them right now, how
// to use the membership, and everything they have got, in the present tense.

import Link from 'next/link';
import { MembershipBenefits } from '@/components/membership/MembershipBenefits';
import { MembershipGallery, MembershipHeroImage } from '@/components/membership/MembershipGallery';
import { formatPence, membershipLabel, type MemberWithMembership } from '@/lib/membership';
import { memberRequests, type MemberRequest } from '@/lib/accessRequests';
import { listApprovedBusinesses, memberClaims } from '@/lib/market';
import { liveDrops, liveGoodCauses } from '@/lib/drops';
import { fmtEventDate } from '@/lib/util';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { MarketArt } from '@/components/market/MarketArt';

// Live asks: anything we are still working on or have sorted, for an
// event that has not finished (or has no date yet). Kept out of the
// component so the clock is read once, at request time.
function liveAsks(requests: MemberRequest[], limit = 4): MemberRequest[] {
  const now = Date.now();
  return requests.filter((r) => {
    if (r.friendly.key === 'cancelled' || r.friendly.key === 'sorry') return false;
    const ends = r.end_at ?? r.start_at;
    return !ends || new Date(ends).getTime() + 6 * 3600 * 1000 > now;
  }).slice(0, limit);
}

const monthYear = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
const dayMonth = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;

export async function MemberHome({ me }: { me: MemberWithMembership }) {
  const [requests, claims, drops, causes, businesses] = await Promise.all([
    memberRequests(me.id, 12), memberClaims(me.id, 6), liveDrops(6), liveGoodCauses(),
    listApprovedBusinesses({ featuredOnly: true, limit: 4 }),
  ]);
  const open = liveAsks(requests);
  const liveClaims = claims.filter((c) => c.status === 'claimed').slice(0, 3);
  const m = me.membership;
  const first = me.display_name.split(' ')[0];
  const since = monthYear(m?.member_since ?? null);
  const status = membershipLabel(m);
  const renewal = m?.billing_source === 'stripe' && m.current_period_end
    ? `${m.cancel_at_period_end ? 'Ends' : 'Renews'} ${dayMonth(m.current_period_end)}`
    : m?.billing_source === 'lifetime' ? 'For life'
    : m?.current_period_end ? `Until ${dayMonth(m.current_period_end)}` : null;
  const hasNow = open.length > 0 || liveClaims.length > 0 || drops.length > 0;

  // WHAT IS LIVE FOR THEM, IN THE HERO RATHER THAN UNDER IT.
  //
  // "Right now" used to be a band of its own below the welcome, which meant
  // the one thing on this page that changes — a guestlist place that came
  // through, a code, a drop — was the thing you had to scroll to reach, under
  // a headline that says the same words every day. It sits beside the
  // headline now, on the dark, where the hero already had empty space on the
  // right and nothing to put in it.
  //
  // Three at most. This is a glance at what is live, not the list — the list
  // is on the membership page, and every card goes there.
  const nowCards = [
    ...open.map((r) => ({
      key: `r-${r.id}`,
      kind: `${r.request_type === 'event_access' ? 'Get me in' : 'Ask Guestlist'}${r.places > 1 ? ' · +1' : ''}`,
      title: r.title,
      meta: `${r.start_at ? fmtEventDate(r.start_at, r.end_at, r.timezone ?? 'Europe/London') : 'Date to come'}`
        + `${r.venue_name ? ` · ${r.venue_name}` : r.city ? ` · ${r.city}` : ''}`,
      tag: (
        <span className={`reqChip ${r.friendly.key}`}>
          {r.friendly.key === 'working' ? 'Working on it' : r.friendly.key === 'discount' && r.member_price_pence != null ? `${formatPence(r.member_price_pence, r.currency)} for you` : r.friendly.title}
        </span>
      ),
      drop: false,
    })),
    ...liveClaims.map((c) => ({
      key: `c-${c.id}`,
      kind: 'Market · your code',
      title: c.business_name,
      meta: `${c.offer_title}${c.expires_at ? ` · until ${dayMonth(c.expires_at)}` : ''}`,
      tag: <span className="mbCode">{c.code}</span>,
      drop: false,
    })),
    ...drops.map((d) => ({
      key: `d-${d.id}`,
      kind: 'Member drop',
      title: d.title,
      meta: `${d.event_title ?? (d.places ? `${d.places} places` : 'Members first')}${d.ends_at ? ` · until ${dayMonth(d.ends_at)}` : ''}`,
      tag: <span className="reqChip guestlisted">Live now</span>,
      drop: true,
    })),
  ];
  const shown = nowCards.slice(0, 3);

  return (
    <main className="wrap">
      <ClubTrack type="membership_page_viewed" />
      <section className={`mbHero member${hasNow ? ' withNow' : ''}`}>
        <MembershipHeroImage />
        <div className="mbHeroCopy">
          <div className="mbKicker">Guestlist Membership · {status}</div>
          <h1 className="mbTitle">You’re in.</h1>
          <p className="mbPrice">{first}, you’re a Guestlist member{since ? ` · since ${since}` : ''}.</p>
          <p className="mbLead">
            See something you want to go to? Ask, and we’ll try to get you in. Claim offers from independent businesses we like.
            Hear about drops first. This is how to use it.
          </p>
          <div className="mbCtaRow">
            <Link href="/events" className="mbCta">Find something to go to</Link>
            <Link href="/you/ask" className="btnGhost">Ask Guestlist</Link>
            <Link href="/you/membership" className="btnGhost">Your membership</Link>
          </div>
        </div>

        {hasNow && (
          <aside className="mbHeroNow" aria-label="Right now">
            <div className="mbHeroNowHead">
              <span className="mbHeroNowLabel">Right now</span>
              {nowCards.length > shown.length && (
                <Link href="/you/membership" className="mbHeroNowAll">
                  {`All ${nowCards.length} →`}
                </Link>
              )}
            </div>
            {shown.map((c) => (
              <Link key={c.key} href="/you/membership" className={`mbNowCard${c.drop ? ' drop' : ''}`}>
                <div className="mbNowKind">{c.kind}</div>
                <div className="mbNowTitle">{c.title}</div>
                <div className="mbNowMeta">{c.meta}</div>
                {c.tag}
              </Link>
            ))}
          </aside>
        )}
      </section>

      <div className="sectionLabel" style={{ marginTop: 34 }}>How to use it</div>
      <div className="mbBenefits mbHow" style={{ marginTop: 10 }}>
        <div className="mbBenefit">
          <span className="mbStep">1</span>
          <h3>Get me in</h3>
          <p>On any event page, press <strong>GET ME IN</strong> — just you, or you +1. We go to the promoter, the venue or our own allocations, and come back with <strong>YOU’RE ON THE GUESTLIST</strong>, a member price, or straight talk.</p>
          <div className="small"><Link href="/events" style={{ textDecoration: 'underline' }}>Browse events →</Link></div>
        </div>
        <div className="mbBenefit">
          <span className="mbStep">2</span>
          <h3>Ask Guestlist</h3>
          <p>Not on Guestlist yet? Paste any link — a Resident Advisor page, an Instagram post, a venue site — and we’ll work on it. Sold out, plus-ones, “what’s good on Saturday”: ask.</p>
          <div className="small"><Link href="/you/ask" style={{ textDecoration: 'underline' }}>Ask now →</Link></div>
        </div>
        <div className="mbBenefit">
          <span className="mbStep">3</span>
          <h3>The Market</h3>
          <p>Independent businesses we like, giving members something extra. Open a listing, press <strong>CLAIM</strong>, show the code. One live code per member at a time — they’re personal and they expire.</p>
          <div className="small"><Link href="/market" style={{ textDecoration: 'underline' }}>Browse the Market →</Link></div>
        </div>
      </div>

      <MembershipGallery />

      <MembershipBenefits variant="member" drops={drops.length} causes={causes} />

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
            <h3 style={{ fontSize: 'clamp(22px, 4vw, 34px)' }}>Your membership</h3>
            <p>{status}{renewal ? ` · ${renewal}` : ''}. Your asks, codes and billing live on your membership page. Manage or cancel any time — no questions.</p>
          </div>
          <div className="mbCtaRow">
            <Link href="/you/membership" className="mbCta">Your membership →</Link>
          </div>
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
