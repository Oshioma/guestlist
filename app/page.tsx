// Guestlist homepage — events-forward front door.
// Built to hold up with an empty database (photography + genres + CTAs) and
// to get richer automatically as events and promoters go live.
// The original private-access landing page is preserved at legacy/index.html.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { browseEvents, getTopLevelGenres } from '@/lib/events';
import { listPromoters } from '@/lib/profiles';
import { query } from '@/lib/db';
import { EventCard } from '@/components/EventCard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const member = await getCurrentMember();
  const [events, genres, promoters] = await Promise.all([
    browseEvents({
      tab: 'for-you',
      sort: 'recommended',
      member: member ? { id: member.id, home_country: member.home_country } : null,
      limit: 6,
    }),
    getTopLevelGenres(),
    listPromoters({ sort: 'popular', limit: 4 }),
  ]);
  const savedIds = new Set<string>(
    member
      ? (
          await query<{ event_id: string }>(
            `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
            [member.id]
          )
        ).map((r) => r.event_id)
      : []
  );

  return (
    <main>
      <section className="homeHero">
        <div className="homeHeroMedia" aria-hidden="true">
          {/* eslint-disable @next/next/no-img-element */}
          <img src="/images/secret-party.jpg" alt="" />
          <img src="/images/supper-club.jpg" alt="" />
          <img src="/images/retreat-beach.jpg" alt="" />
          {/* eslint-enable @next/next/no-img-element */}
        </div>
        <div className="wrap homeHeroInner">
          <div className="homeKicker">A curated guide to dance-music culture</div>
          <h1 className="homeTitle">
            The nights worth
            <br />
            leaving the house for.
          </h1>
          <p className="homeLead">
            Club nights, day parties, festivals and the people behind them —
            hand-picked for the generation raised on rave. Not every event.
            The right ones.
          </p>
          <div className="homeCtas">
            <Link href="/events" className="btnAccent">Browse events →</Link>
            {!member && <Link href="/signup" className="btnGhost">Join Guestlist</Link>}
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="chipRow" style={{ padding: '26px 0 10px' }}>
          {genres.map((g) => (
            <Link key={g.slug} href={`/events?genre=${g.slug}`} className="chip">
              {g.name}
            </Link>
          ))}
        </div>

        {events.length > 0 && (
          <>
            <div className="homeSectionHead">
              <h2 className="homeSectionTitle">On Guestlist now</h2>
              <Link href="/events" className="btnGhost">View all</Link>
            </div>
            <div className="cardGrid" style={{ paddingBottom: 36 }}>
              {events.map((e) => (
                <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
              ))}
            </div>
          </>
        )}

        <section className="homeSplit">
          <div className="homeSplitCard">
            <div className="homeKicker">For members</div>
            <h3>Discover, then connect.</h3>
            <p>
              Follow the promoters, venues and DJs you rate. Save what looks
              good, mark yourself going, and see who else from the Guestlist
              will be in the room.
            </p>
            <Link href={member ? '/events' : '/signup'} className="btnGhost">
              {member ? 'Find your next night →' : 'Create a free account →'}
            </Link>
          </div>
          <div className="homeSplitCard">
            <div className="homeKicker">For promoters</div>
            <h3>Your events, kept current.</h3>
            <p>
              Claim your profile, connect your website, and Guestlist finds and
              updates your events automatically — then shows you the views,
              ticket clicks and followers they earn.
            </p>
            <Link href="/promoters" className="btnGhost">Find your profile →</Link>
          </div>
        </section>

        {promoters.length > 0 && (
          <>
            <div className="homeSectionHead">
              <h2 className="homeSectionTitle">The crews behind the nights</h2>
              <Link href="/promoters" className="btnGhost">All promoters</Link>
            </div>
            <div className="homePromoterRow">
              {promoters.map((p) => (
                <Link key={p.id} href={`/promoters/${p.slug}`} className="homePromoterChip">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" />
                  ) : (
                    <span className="mono">{p.name[0]}</span>
                  )}
                  <span>
                    {p.name}
                    {p.verified && <span className="verifiedMark" title="Verified"> ✓</span>}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        <section className="homeSubmitStrip">
          <div>
            <h3 style={{ margin: '0 0 6px' }}>Know a night we’re missing?</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Paste the event link and we’ll take care of the rest.
            </p>
          </div>
          <Link href="/events/submit" className="btnAccent">Add an event →</Link>
        </section>

        <footer className="siteFooter">
          <div>Guestlist — the best events for our community, not every event.</div>
          <div>info@guestlist.net</div>
        </footer>
      </div>
    </main>
  );
}
