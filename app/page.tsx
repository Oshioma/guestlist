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
import { getRecommendedEvents, trackRecommendationImpressions, weekendWindow } from '@/lib/recommend';
import { toRecCards } from '@/lib/recCards';
import { peopleYouMayHaveDancedWith, yourPeopleUpcoming } from '@/lib/scene';
import { fmtEventDate } from '@/lib/util';
import { memberPlaces } from '@/lib/locations';
import { RecShelf } from '@/components/v2c/RecShelf';
import { GuestlistNow } from '@/components/GuestlistNow';
import { EventImage } from '@/components/EventImage';
import { AskPanel } from '@/components/ask/AskPanel';

export const dynamic = 'force-dynamic';

// MY GUESTLIST — the logged-in front door: a personalised cultural
// magazine, not an admin dashboard.
async function MemberHome({ member }: { member: { id: string; display_name: string } }) {
  const weekend = weekendWindow();
  const [weekendPicks, picks, yourPeople, danced, places, travel] = await Promise.all([
    getRecommendedEvents(member.id, { limit: 4, from: weekend.from, to: weekend.to, exploration: false }),
    getRecommendedEvents(member.id, { limit: 6 }),
    yourPeopleUpcoming(member.id, { from: weekend.from, to: weekend.to, limit: 8 }),
    peopleYouMayHaveDancedWith(member.id, 4),
    memberPlaces(member.id),
    query<{ id: string; name: string; slug: string; start_date: string; end_date: string; n: number }>(
      `select tp.id, l.name, l.slug, tp.start_date::text, tp.end_date::text,
              (select count(*)::int from events e
                where e.location_id = tp.location_id and e.status = 'live'
                  and e.listing_status <> 'cancelled'
                  and e.start_at::date between tp.start_date and tp.end_date) as n
         from travel_plans tp join locations l on l.id = tp.location_id
        where tp.member_id = $1 and tp.end_date >= current_date
        order by tp.start_date limit 3`,
      [member.id]
    ),
  ]);
  const hour = new Date().getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = member.display_name.split(' ')[0];
  const weekendIds = new Set(weekendPicks.map((e) => e.id));
  const laterPicks = picks.filter((e) => !weekendIds.has(e.id)).slice(0, 4);
  await trackRecommendationImpressions(member.id, [...weekendPicks, ...laterPicks], 'home');

  return (
    <section className="wrap myGuestlist">
      <div className="homeKicker">{greeting}</div>
      <h1 className="myGuestlistTitle">{firstName}, here’s your Guestlist.</h1>

      {travel.length > 0 && (
        <div className="travelStrip">
          {travel.map((t) => (
            <Link key={t.id} href={`/${t.slug}`} className="travelCard">
              <span className="travelWhere">{`While you’re in ${t.name}`}</span>
              <span className="travelWhen">{`${t.start_date} → ${t.end_date}`}</span>
              <span className="travelCount">
                {t.n > 0 ? `${t.n} event${t.n === 1 ? '' : 's'} on` : 'We’re keeping an eye out'}
              </span>
            </Link>
          ))}
        </div>
      )}

      <GuestlistNow />

      {weekendPicks.length > 0 && (
        <RecShelf title="This weekend" surface="home_weekend" events={toRecCards(weekendPicks)} />
      )}

      {yourPeople.length > 0 && (
        <>
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">Your people this weekend</h2>
            <Link href="/people" className="btnGhost">Your people</Link>
          </div>
          <div className="yourPeopleStrip">
            {yourPeople.map((p) => (
              <Link key={`${p.member_id}-${p.event_id}`} href={`/events/${p.slug}`} className="yourPeopleCard">
                <span className="yourPeopleName">
                  {p.is_close ? `★ ${p.display_name}` : p.display_name}
                </span>
                <span className="yourPeopleEvent">{p.title}</span>
                <span className="yourPeopleMeta">
                  {`${fmtEventDate(p.start_at, p.end_at, p.timezone)}${p.city ? ` · ${p.city}` : ''}${p.i_am_going ? ' · You’re going too' : ''}`}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      {laterPicks.length > 0 && (
        <RecShelf title="Picked for you" surface="home_picks" events={toRecCards(laterPicks)} />
      )}
      {weekendPicks.length === 0 && laterPicks.length === 0 && (
        <div className="clubJoin">
          <p>Nothing picked for you yet — tell us what you love and we’ll get to work.</p>
          <Link href="/you" className="btnAccent">Set up your Guestlist →</Link>
        </div>
      )}

      {/* Ask sits under the events: you look at what's on first, and ask
          when the list has not answered it. */}
      <AskPanel isSignedIn placeholder="What should I actually do?" />

      {danced.length > 0 && (
        <>
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">People from your scene</h2>
            <Link href="/people" className="btnGhost">See all</Link>
          </div>
          <div className="dancedGrid">
            {danced.map((d) => (
              <Link href={`/members/${d.slug}`} className="dancedCard" key={d.id}>
                {d.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="dancedAvatar" src={d.avatar_url} alt="" />
                ) : (
                  <span className="dancedAvatar personAvatarFallback">{d.display_name[0]}</span>
                )}
                <span className="dancedName">{d.display_name}</span>
                <span className="dancedWhere">
                  {d.entity_name}
                  {d.overlap_from != null && <> · {d.overlap_from}–{d.overlap_to}</>}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {places.length > 0 && (
        <div className="chipRow" style={{ marginTop: 18 }}>
          <span className="sectionLabel" style={{ margin: 0 }}>Your places</span>
          {places.map((p) => (
            <Link key={`${p.relation}-${p.id}`} href={`/${p.slug}`} className="chip">
              {p.relation === 'home' ? `⌂ ${p.name}` : p.name}
            </Link>
          ))}
          <Link href="/explore" className="chip">Explore the world →</Link>
        </div>
      )}
    </section>
  );
}

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
      {member && <MemberHome member={member} />}
      {!member && (
      <section className="homeHero">
        <div className="homeHeroMedia" aria-hidden="true">
          {/* eslint-disable @next/next/no-img-element */}
          <img src="/images/secret-party.jpg" alt="" />
          <img src="/images/supper-club.jpg" alt="" />
          <img src="/images/retreat-beach.jpg" alt="" />
          {/* eslint-enable @next/next/no-img-element */}
        </div>
        <div className="wrap homeHeroInner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="homeBrandMark" src="/brand/Guestlist_CirclePurple_300dpi.png" alt="" />
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
      )}

      <div className="wrap">
        {!member && <GuestlistNow />}
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
                    <EventImage src={p.image_url} />
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
