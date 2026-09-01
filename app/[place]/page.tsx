// City / destination pages at the top level: /london, /berlin, /ibiza,
// /zanzibar. Driven entirely by the canonical location model — no
// hardcoded city routes, every place with a location row gets one.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getCountryBySlug, getLocationBySlug } from '@/lib/locations';
import { countrySlug, countryWithArticle } from '@/lib/countries';
import { placeEventCards } from '@/lib/placeEvents';
import { CountryView } from './CountryView';
import { query } from '@/lib/db';
import { getRecommendedEvents, trackRecommendationImpressions, weekendWindow } from '@/lib/recommend';
import { toRecCards } from '@/lib/recCards';
import { RecShelf } from '@/components/v2c/RecShelf';
import { EventCard } from '@/components/EventCard';
import { FollowCityButton } from '@/components/v2c/FollowCityButton';
import { GuestlistNow } from '@/components/GuestlistNow';
import { AskPanel } from '@/components/ask/AskPanel';
import type { EventCard as EventCardType } from '@/lib/events';

export const dynamic = 'force-dynamic';

export default async function PlacePage({ params }: { params: Promise<{ place: string }> }) {
  const { place } = await params;
  const location = await getLocationBySlug(place);
  // A city row wins the slug — Singapore and Luxembourg are cities we list
  // before they are countries. Anything else that names a country we hold
  // cities in gets the country page, and a location row filed as a country
  // gets it too rather than an empty city page.
  if (!location || location.kind === 'country') {
    const country = await getCountryBySlug(place);
    if (country) return <CountryView country={country} />;
  }
  if (!location) notFound();
  const member = await getCurrentMember();
  const country = location.country_name ?? null;
  const countryHref = country ? `/${countrySlug(country)}` : null;

  const weekend = weekendWindow();
  const [events, weekendPicks, forYou, promoters, venues, genres, memberFollowsCity,
         restOfCountry, beyondCountry] = await Promise.all([
    query<EventCardType>(
      `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
              e.city, e.country, e.event_type, e.price_from, e.price_to, e.currency,
              e.primary_image_url, e.worth_travelling, e.featured, e.listing_status,
              v.name as venue_name,
              coalesce((select count(*)::int from member_event_actions mea
                         where mea.event_id = e.id and mea.rsvp = 'going'), 0) as going_count,
              coalesce((select json_agg(json_build_object('name', g.name, 'slug', g.slug))
                          from event_genres eg join genres g on g.id = eg.genre_id
                         where eg.event_id = e.id), '[]'::json) as genres,
              coalesce((select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url))
                          from member_event_actions mea2 join members m on m.id = mea2.member_id
                         where mea2.event_id = e.id and mea2.rsvp = 'going'), '[]'::json) as going_avatars
         from events e left join venues v on v.id = e.venue_id
        where e.location_id = $1 and e.status = 'live'
          and e.listing_status <> 'cancelled' and e.start_at > now()
        order by e.start_at limit 24`,
      [location.id]
    ),
    member
      ? getRecommendedEvents(member.id, {
          locationId: location.id, from: weekend.from, to: weekend.to, limit: 6, exploration: false,
        })
      : Promise.resolve([]),
    member
      ? getRecommendedEvents(member.id, { locationId: location.id, limit: 6, exploration: false })
      : Promise.resolve([]),
    query<{ id: string; name: string; slug: string; verified: boolean }>(
      `select distinct p.id, p.name, p.slug, p.verified
         from promoters p join events e on e.promoter_id = p.id
        where e.location_id = $1 and e.status = 'live' and e.start_at > now()
        limit 12`,
      [location.id]
    ),
    query<{ id: string; name: string; slug: string }>(
      `select distinct v.id, v.name, v.slug
         from venues v join events e on e.venue_id = v.id
        where e.location_id = $1 and e.status = 'live' and e.start_at > now()
        limit 12`,
      [location.id]
    ),
    query<{ name: string; slug: string; n: number }>(
      `select g.name, g.slug, count(*)::int as n
         from event_genres eg
         join genres g on g.id = eg.genre_id and g.parent_genre_id is null
         join events e on e.id = eg.event_id
        where e.location_id = $1 and e.status = 'live' and e.start_at > now()
        group by g.id order by n desc limit 10`,
      [location.id]
    ),
    member
      ? query(`select 1 from member_locations where member_id = $1 and location_id = $2`,
          [member.id, location.id]).then((r) => r.length > 0)
      : Promise.resolve(false),
    // Somebody looking at one city wants that city first, then the rest of
    // the country they are already in, and only then the world. Two shelves
    // below the grid, rather than a mixed list that buries what is local.
    country
      ? placeEventCards({ countryNames: [country], excludeLocationId: location.id, limit: 8 })
      : Promise.resolve([]),
    placeEventCards({ excludeCountryNames: country ? [country] : null, limit: 8 }),
  ]);

  if (member) {
    await trackRecommendationImpressions(member.id, [...weekendPicks, ...forYou], `city:${location.slug}`);
  }

  const weekendIds = new Set(weekendPicks.map((e) => e.id));
  const savedIds = new Set<string>(
    member
      ? (await query<{ event_id: string }>(
          `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
          [member.id]
        )).map((r) => r.event_id)
      : []
  );

  return (
    <main className="wrap">
      <div className="cityHead">
        <div>
          <div className="homeKicker">
            {countryHref && country
              ? <><Link href={countryHref} style={{ textDecoration: 'underline' }}>{country}</Link>{location.timezone ? ` · ${location.timezone}` : ''}</>
              : [location.country_name, location.timezone].filter(Boolean).join(' · ')}
          </div>
          <h1 className="pageTitle" style={{ margin: 0 }}>{location.name}</h1>
        </div>
        {member && <FollowCityButton locationId={location.id} following={memberFollowsCity} />}
      </div>

      <GuestlistNow city={location.name} isAdmin={member?.role === 'admin'} />

      <AskPanel isSignedIn={!!member} placeholder={`What\u2019s good in ${location.name} tonight?`} />

      {events.length === 0 ? (
        <div className="emptyState">
          <h3>Guestlist is still warming up in {location.name}.</h3>
          <p>Know the nights that matter here? Help us put {location.name} on the map.</p>
          <div className="suggestions">
            <Link href="/events/submit" className="btnAccent">Add an event →</Link>
            <Link href="/explore" className="btnGhost">Explore other cities</Link>
          </div>
        </div>
      ) : (
        <>
          {weekendPicks.length > 0 && (
            <RecShelf title={`This weekend in ${location.name} — for you`} surface="city_weekend"
                      events={toRecCards(weekendPicks)} />
          )}
          {forYou.filter((e) => !weekendIds.has(e.id)).length > 0 && (
            <RecShelf title="For you" surface="city_foryou"
                      events={toRecCards(forYou.filter((e) => !weekendIds.has(e.id)))} />
          )}
          {genres.length > 0 && (
            <div className="chipRow" style={{ margin: '14px 0' }}>
              {genres.map((g) => (
                <Link key={g.slug} href={`/events?city=${encodeURIComponent(location.name)}&genre=${g.slug}`} className="chip">
                  {g.name} ({g.n})
                </Link>
              ))}
            </div>
          )}
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">{`Coming up in ${location.name}`}</h2>
          </div>
          <div className="cardGrid" style={{ paddingBottom: 26 }}>
            {events.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}

      {(promoters.length > 0 || venues.length > 0) && (
        <div className="cityCrewRow">
          {promoters.length > 0 && (
            <div>
              <div className="sectionLabel">Promoters</div>
              <div className="chipRow">
                {promoters.map((p) => (
                  <Link key={p.id} href={`/promoters/${p.slug}`} className="chip">
                    {p.name}{p.verified && ' ✓'}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {venues.length > 0 && (
            <div>
              <div className="sectionLabel">Venues</div>
              <div className="chipRow">
                {venues.map((v) => (
                  <Link key={v.id} href={`/venues/${v.slug}`} className="chip">{v.name}</Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {restOfCountry.length > 0 && country && (
        <>
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">{`Elsewhere in ${countryWithArticle(country)}`}</h2>
            {countryHref && <Link href={countryHref} className="btnGhost">{`All of ${countryWithArticle(country)} →`}</Link>}
          </div>
          <div className="cardGrid" style={{ paddingBottom: 26 }}>
            {restOfCountry.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}

      {beyondCountry.length > 0 && (
        <>
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">{country ? `Beyond ${countryWithArticle(country)}` : 'Everywhere else'}</h2>
            <Link href="/explore" className="btnGhost">Explore the world →</Link>
          </div>
          <div className="cardGrid" style={{ paddingBottom: 26 }}>
            {beyondCountry.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}

    </main>
  );
}
