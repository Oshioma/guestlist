// A COUNTRY'S OWN PAGE — /netherlands, /italy, /united-kingdom.
//
// Cities were the only place with a page of their own, which meant nobody
// could ask a simple question: what is on in Italy? A country page answers
// it, and gives the country headings on /explore somewhere to point.
//
// No country needs creating: a country page exists for as long as we hold
// cities in it, and lists whatever is on across all of them.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { citiesInCountry, type CountryPlace } from '@/lib/locations';
import { countryWithArticle } from '@/lib/countries';
import { placeEventCards } from '@/lib/placeEvents';
import { query } from '@/lib/db';
import { EventCard } from '@/components/EventCard';
import { AskPanel } from '@/components/ask/AskPanel';

export async function CountryView({ country }: { country: CountryPlace }) {
  const member = await getCurrentMember();
  const [cities, events, elsewhere, genres, savedIds] = await Promise.all([
    citiesInCountry(country.rawNames),
    placeEventCards({ countryNames: country.rawNames, limit: 48 }),
    // Somewhere to go next, so a quiet country is never a dead end.
    placeEventCards({ excludeCountryNames: country.rawNames, limit: 8 }),
    query<{ name: string; slug: string; n: number }>(
      `select g.name, g.slug, count(*)::int as n
         from event_genres eg
         join genres g on g.id = eg.genre_id and g.parent_genre_id is null
         join events e on e.id = eg.event_id
         left join locations l on l.id = e.location_id
        where e.status = 'live' and e.start_at > now()
          and (e.country = any($1::text[]) or l.country_name = any($1::text[]))
        group by g.id order by n desc limit 10`,
      [country.rawNames]
    ),
    member
      ? query<{ event_id: string }>(
          `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
          [member.id]
        ).then((r) => new Set(r.map((x) => x.event_id)))
      : Promise.resolve(new Set<string>()),
  ]);

  return (
    <main className="wrap">
      <div className="cityHead">
        <div>
          <div className="homeKicker">
            <Link href="/explore" style={{ textDecoration: 'underline' }}>Explore the world</Link>
          </div>
          <h1 className="pageTitle" style={{ margin: 0 }}>{country.name}</h1>
        </div>
      </div>

      <AskPanel isSignedIn={!!member} placeholder={`What’s good in ${countryWithArticle(country.name)} this weekend?`} />

      {cities.length > 0 && (
        <div className="chipRow" style={{ margin: '4px 0 14px' }}>
          {cities.map((c) => (
            <Link key={c.id} href={`/${c.slug}`} className="chip">
              {c.name} <span style={{ opacity: 0.6 }}>{c.upcoming_events}</span>
            </Link>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div className="emptyState">
          <h3>{`Nothing on in ${countryWithArticle(country.name)} right now.`}</h3>
          <p>{`Know the nights that matter in ${countryWithArticle(country.name)}? Put them on the map.`}</p>
          <div className="suggestions">
            <Link href="/events/submit" className="btnAccent">Add an event →</Link>
            <Link href="/explore" className="btnGhost">Explore other countries</Link>
          </div>
        </div>
      ) : (
        <>
          {genres.length > 0 && (
            <div className="chipRow" style={{ margin: '0 0 14px' }}>
              {genres.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="chip">
                  {g.name} ({g.n})
                </Link>
              ))}
            </div>
          )}
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">{`Coming up in ${countryWithArticle(country.name)}`}</h2>
          </div>
          <div className="cardGrid" style={{ paddingBottom: 26 }}>
            {events.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}

      {elsewhere.length > 0 && (
        <>
          <div className="homeSectionHead">
            <h2 className="homeSectionTitle">{`Beyond ${countryWithArticle(country.name)}`}</h2>
            <Link href="/explore" className="btnGhost">Explore the world →</Link>
          </div>
          <div className="cardGrid" style={{ paddingBottom: 26 }}>
            {elsewhere.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}

    </main>
  );
}
