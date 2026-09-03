// WHAT MEMBERSHIP ACTUALLY GETS YOU.
//
// Six benefits, six cards the same size. Nothing is a footnote to anything
// else: getting in free is the headline reason, but somebody who joins for the
// Market, or for what the membership funds, is joining for a real reason too —
// and a small grey box underneath a big card says otherwise.
//
// Six equal cards in a grid: a round icon tile, the name, a line in the
// accent, a short rule, the substance, and a link. No card is bigger than
// another.
//
// It is one component used by both the page that sells membership and the page
// a member already has, because the promise and the thing delivered have to be
// the same words. The live details — how many drops, which causes — are the
// only difference, and they come in as props.
//
// Nothing here claims more than the copy did before. "Free entrance whenever
// we can make it happen" is a careful sentence, and its caveat stays beside it
// rather than at the bottom of the page.

import Link from 'next/link';

type Props = {
  // A member is being shown what they have; everybody else, what they'd get.
  variant: 'member' | 'prospect';
  drops?: number;
  causes?: { title: string }[];
};

// Icons are inline because a request each is a request too many.
const Icon = {
  free: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.4 2.4 4.6-4.9" />
    </svg>
  ),
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

type Benefit = {
  key: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  lead: string;
  body: string;
  fine?: string;
  state?: { label: string; text: string; href: string | null };
  link?: { href: string; label: string };
  note?: string;
};

export function MembershipBenefits({ variant, drops = 0, causes = [] }: Props) {
  const isMember = variant === 'member';

  const benefits: Benefit[] = [
    {
      key: 'membership.hero',
      icon: Icon.free,
      title: 'Get in free',
      sub: 'Your night. On us.',
      lead: isMember
        ? 'Free entrance to parties whenever we can make it happen.'
        : 'See an event you want to go to? Ask Guestlist, and we’ll work on getting you in.',
      body: 'Through the promoter, the venue, our own allocations, or by buying access '
        + 'where that’s reasonable. When we can’t, we’ll say so — and often find a member price instead.',
      fine: 'Subject to availability and fair use.',
      link: isMember ? { href: '/events', label: 'Browse events →' } : { href: '/membership/terms', label: 'How it works →' },
    },
    {
      key: 'membership.queueJump',
      icon: Icon.arrow,
      title: 'Queue jump',
      sub: 'Less queue. More party.',
      lead: 'Priority and fast-track entrance where available.',
      body: 'Through participating events and venues — less time on the pavement, more time inside.',
      link: { href: '/membership/terms', label: 'Learn more →' },
    },
    {
      key: 'membership.drops',
      icon: Icon.spark,
      title: 'Member drops',
      sub: 'You never know what’s coming.',
      lead: 'Surprise tickets, last-minute guestlists, special events and secret parties.',
      body: isMember
        ? 'They land on your membership page and by email, and they go fast.'
        : 'Members hear about them first, and they go fast.',
      state: {
        label: 'Next drop',
        text: drops > 0
          ? `${drops} live now →`
          : isMember ? 'Nothing live — you’ll know first' : 'Members hear first',
        href: drops > 0 ? '/you/membership#drops' : null,
      },
      link: isMember ? { href: '/you/membership#drops', label: 'Your drops →' } : { href: '/membership/terms', label: 'Learn more →' },
    },
    {
      key: 'membership.prices',
      icon: Icon.price,
      title: 'Member prices',
      sub: 'Pay less when free isn’t possible.',
      lead: 'A discounted ticket or a special Guestlist price.',
      body: isMember
        ? 'It shows on your membership page the moment we have it.'
        : 'Arranged for members when free entrance isn’t on the table.',
      link: isMember ? { href: '/you/membership', label: 'Your membership →' } : { href: '/membership/terms', label: 'Learn more →' },
    },
    {
      key: 'membership.market',
      icon: Icon.market,
      title: 'Guestlist Market',
      sub: 'The best places, chosen by us.',
      lead: 'Restaurants, bars, record shops, studios, clothing and places to stay.',
      body: 'Handpicked by Guestlist, not listed by anyone — independent people we actually like.',
      link: { href: '/market', label: 'Browse the Market →' },
    },
    {
      key: 'membership.doGood',
      icon: Icon.heart,
      title: 'Do good for others',
      sub: 'Good nights can do good things.',
      lead: 'Members support community projects chosen with the community.',
      body: 'And you see exactly what those projects are.',
      // Never a promise where there is not yet a project.
      note: causes.length > 0
        ? causes.map((c) => c.title).join(' · ')
        : 'The first projects will be announced to members. Nothing is claimed here until it’s real.',
      link: isMember ? { href: '/you/membership', label: 'See current projects →' } : { href: '/membership/terms', label: 'How it works →' },
    },
  ];

  return (
    <section className="mbPerks" aria-label="What membership gets you">
      <div className="mbPerkKicker mbPerkKickerTop">
        {isMember ? 'What you’ve got' : 'Membership benefits'}
      </div>

      <div className="mbPerkGrid">
        {benefits.map((b) => (
          <div className="mbPerkCard" key={b.key}>
            <div className="mbPerkCardHead">
              <span className="mbPerkTile">{b.icon}</span>
              <div>
                {/* Natural case in the markup, uppercased in CSS: what gets read
                    aloud and what gets copied should be words, not shouting. */}
                <h2 className="mbPerkBig">{b.title}</h2>
                <div className="mbPerkSub">{b.sub}</div>
              </div>
            </div>
            <div className="mbPerkRule" />
            <p className="mbPerkBody">{b.lead} {b.body}</p>
            {b.fine && (
              <div className="mbPerkFine">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.4 2.4 4.6-4.9" />
                </svg>
                {b.fine}
              </div>
            )}
            {b.note && <div className="mbPerkNote">{b.note}</div>}
            <div className="mbPerkCardFoot">
              {b.state && (
                b.state.href
                  ? <Link href={b.state.href} className="mbPerkLink">{b.state.text}</Link>
                  : <span className="mbPerkDropState">{b.state.label}: {b.state.text}</span>
              )}
              {b.link && !b.state?.href && <Link href={b.link.href} className="mbPerkLink">{b.link.label}</Link>}
            </div>
          </div>
        ))}
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
