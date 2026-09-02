// WHAT MEMBERSHIP ACTUALLY GETS YOU.
//
// Six equal grey boxes said everything was equally important, which meant
// nothing led. This gives the section a shape: getting in free is the reason
// anybody joins, so it takes the whole top; the two things you feel next —
// walking past a queue, and a drop landing — take a row of their own; and the
// three standing benefits sit underneath at the size they deserve.
//
// It is one component used by both the page that sells membership and the page
// a member already has, because the promise and the thing delivered have to be
// the same words. The live details — how many drops, which causes — are the
// only difference, and they come in as props.
//
// Nothing here claims more than the copy did before. "Free entrance whenever
// we can make it happen" is a careful sentence and the fine print stays next
// to the big number rather than at the bottom of the page.

import Link from 'next/link';

type Props = {
  // A member is being shown what they have; everybody else, what they'd get.
  variant: 'member' | 'prospect';
  drops?: number;
  causes?: { title: string }[];
};

// Icons are inline because three of them are the only images on this section
// and a request each is a request too many.
const Icon = {
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
    </svg>
  ),
  price: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6.5A3.5 3.5 0 0 0 8.6 8.4c0 3.1 1.4 4.6 1.4 7.1 0 1.4-.7 2.5-1.6 3.1M7 13h6M6.5 18.6h11" />
    </svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h16l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3L4 8Z" />
      <path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20s-7.2-4.4-7.2-9.2A4.1 4.1 0 0 1 12 8.3a4.1 4.1 0 0 1 7.2 2.5C19.2 15.6 12 20 12 20Z" />
    </svg>
  ),
  crown: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 8l4 3.5L12 4l5 7.5L21 8l-1.6 10.4a1 1 0 0 1-1 .85H5.6a1 1 0 0 1-1-.85L3 8Z" />
    </svg>
  ),
};

export function MembershipBenefits({ variant, drops = 0, causes = [] }: Props) {
  const isMember = variant === 'member';

  return (
    <section className="mbPerks" aria-label="What membership gets you">

      {/* THE REASON ANYBODY JOINS, at the size that says so. */}
      <div className="mbPerkHero">
        <div className="mbPerkHeroText">
          {/* A member already has these; everybody else is being told about
              them. Same six things, two different sentences. */}
          <div className="mbPerkKicker">{isMember ? 'What you’ve got' : 'Membership benefits'}</div>
          {/* Natural case in the markup, uppercased in CSS: what gets read aloud
              and what gets copied should be words, not shouting. */}
          <h2 className="mbPerkBig">Get in free</h2>
          <div className="mbPerkSub">Your night. On us.</div>
          <p className="mbPerkLead">
            {isMember
              ? 'Free entrance to parties whenever we can make it happen.'
              : 'See an event you want to go to? Ask Guestlist, and we’ll work on getting you in.'}
          </p>
          <p className="mbPerkBody">
            Through the promoter, the venue, our own allocations, or by buying access
            where that’s reasonable. When we can’t, we’ll say so — and often find a
            member price instead.
          </p>
          {/* The caveat sits with the claim, not at the bottom of the page. */}
          <div className="mbPerkFine">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.4 2.4 4.6-4.9" />
            </svg>
            Subject to availability and fair use.
          </div>
        </div>
        <div className="mbPerkHeroArt" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/secret-party.jpg" alt="" />
          {/* The words, not a number. A price of £0 invites the reader to
              start pricing the thing; "free guestlist" names what they get. */}
          <div className="mbPerkStamp">
            <span className="mbPerkStampBig">Free</span>
            <span className="mbPerkStampWord">Guestlist</span>
          </div>
        </div>
      </div>

      {/* The two you feel on the night. */}
      <div className="mbPerkPair">
        <div className="mbPerkCard lilac">
          <span className="mbPerkIcon">{Icon.arrow}</span>
          <h3>Queue jump</h3>
          <div className="mbPerkTag">Less queue. More party.</div>
          <p>Priority and fast-track entrance where available, through participating events and venues.</p>
        </div>

        <div className="mbPerkCard cream">
          <span className="mbPerkIcon gold">{Icon.spark}</span>
          <h3>Member drops</h3>
          <div className="mbPerkTag">You never know what’s coming.</div>
          <p>Surprise tickets, last-minute guestlists, special events and secret parties.</p>
          <div className="mbPerkDrop">
            <span className="mbPerkDropLabel">Next drop</span>
            {drops > 0 ? (
              <Link href="/you/membership#drops" className="mbPerkDropState live">
                {`${drops} live now →`}
              </Link>
            ) : (
              <span className="mbPerkDropState">
                {isMember ? 'Nothing live — you’ll know first' : 'Members hear first'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The three standing benefits. */}
      <div className="mbPerkTrio">
        <div className="mbPerkCard">
          <span className="mbPerkIcon">{Icon.price}</span>
          <h3>Member prices</h3>
          <div className="mbPerkTag">Pay less when free isn’t possible.</div>
          <p>
            A discounted ticket or a special Guestlist price
            {isMember ? ' shows on your membership page the moment we have it.' : ', arranged for members.'}
          </p>
        </div>

        <div className="mbPerkCard">
          <span className="mbPerkIcon">{Icon.market}</span>
          <h3>Guestlist Market</h3>
          <div className="mbPerkTag">The best places, chosen by us.</div>
          <p>Restaurants, bars, record shops, studios, clothing and places to stay — handpicked by Guestlist, not listed by anyone.</p>
          <Link href="/market" className="mbPerkLink">Browse the Market →</Link>
        </div>

        <div className="mbPerkCard">
          <span className="mbPerkIcon">{Icon.heart}</span>
          <h3>Do good for others</h3>
          <div className="mbPerkTag">Good nights can do good things.</div>
          <p>Members support community projects chosen with the community — and you see exactly what those projects are.</p>
          {/* Never a promise where there is not yet a project. */}
          {causes.length > 0
            ? <div className="mbPerkNote">{causes.map((c) => c.title).join(' · ')}</div>
            : <div className="mbPerkNote">The first projects will be announced to members. Nothing is claimed here until it’s real.</div>}
        </div>
      </div>

      <div className="mbPerkFoot">
        <span className="mbPerkIcon">{Icon.crown}</span>
        <div className="mbPerkFootText">
          <div className="mbPerkFootTitle">{isMember ? 'This is your access' : 'This is the access'}</div>
          <p>
            {isMember
              ? 'Make the most of it. Press GET ME IN on any event, check your membership page, and keep an eye out for Member Drops.'
              : 'Press GET ME IN on any event and we go to work — free entrance where we can, a member price where we can’t.'}
          </p>
        </div>
        <Link href="/events" className="mbPerkFootCta">Explore events →</Link>
      </div>
    </section>
  );
}
