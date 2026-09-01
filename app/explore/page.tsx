// EXPLORE THE WORLD — destinations driven by real event supply, never a
// hardcoded "cool cities" list. A place appears here when it actually has
// upcoming events on Guestlist.
//
// Grouped by country, because "explore the world" read as one long alphabet
// of cities: a flat list buries the fact that a scene has three cities in it,
// and gives someone looking for Italy no way to look for Italy.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { liveDestinations } from '@/lib/locations';
import { canonicalCountry, countrySlug } from '@/lib/countries';

export const dynamic = 'force-dynamic';

const NO_COUNTRY = 'Elsewhere';

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const params = await searchParams;
  const countryFilter = params.country?.trim() || null;
  const member = await getCurrentMember();
  // Grouping only earns its keep with enough cities to group, so this asks
  // for more than the old flat list did.
  const destinations = await liveDestinations(150);

  // Countries carry their totals from the FULL set, so the filter bar stays
  // put while a filter is applied.
  const byCountry = new Map<string, { cities: typeof destinations; events: number }>();
  for (const d of destinations) {
    // Canonicalised at read time too: a row written before the cleanup
    // still groups under the right country.
    const key = canonicalCountry(d.country_name ?? d.country_code) ?? NO_COUNTRY;
    const group = byCountry.get(key) ?? { cities: [], events: 0 };
    group.cities.push(d);
    group.events += d.upcoming_events;
    byCountry.set(key, group);
  }

  // Busiest scenes first — this is a page for finding somewhere to go, not a
  // gazetteer. Unplaced cities go last.
  const countries = [...byCountry.entries()].sort((a, b) =>
    a[0] === NO_COUNTRY ? 1 : b[0] === NO_COUNTRY ? -1
      : b[1].events - a[1].events || a[0].localeCompare(b[0]));

  const shown = countryFilter ? countries.filter(([c]) => c === countryFilter) : countries;
  const href = (country: string | null) =>
    country ? `/explore?country=${encodeURIComponent(country)}` : '/explore';

  return (
    <main className="wrap">
      <h1 className="pageTitle">Explore the world</h1>
      <p className="pageStandfirst">
        One global network — every city here has real events on Guestlist
        right now. Follow the places you care about and they shape your
        recommendations.
      </p>

      {destinations.length === 0 ? (
        <div className="emptyState">
          <h3>The map is filling in.</h3>
          <p>As events go live around the world, destinations appear here.</p>
        </div>
      ) : (
        <>
          {countries.length > 1 && (
            <div className="chipRow" style={{ marginBottom: 6 }}>
              <Link className={`chip${!countryFilter ? ' active' : ''}`} href={href(null)}>
                Everywhere
              </Link>
              {countries.map(([country]) => (
                <Link
                  key={country}
                  className={`chip${countryFilter === country ? ' active' : ''}`}
                  href={href(countryFilter === country ? null : country)}
                >
                  {country}
                </Link>
              ))}
            </div>
          )}

          {shown.map(([country, group]) => (
            <section key={country} className="exploreCountry2">
              <div className="exploreCountryHead">
                {/* The heading is the way into the country's own page — every
                    city in it on one screen, rather than only the ones that
                    fit here. "Elsewhere" is not a country, so it stays flat. */}
                <h2>
                  {country === NO_COUNTRY
                    ? country
                    : <Link href={`/${countrySlug(country)}`}>{country}</Link>}
                </h2>
                {/* Events, not cities: the cities are right there to be
                    counted, and what a visitor wants to know is how much is on. */}
                <span>{`${group.events} event${group.events === 1 ? '' : 's'}`}</span>
              </div>
              <div className="exploreCities">
                {group.cities.map((d) => (
                  <Link key={d.id} href={`/${d.slug}`} className="exploreCard">
                    <span className="exploreName">{d.name}</span>
                    {/* The country is the heading above; repeating it on every
                        card under it is just noise. */}
                    <span className="exploreStats">
                      {d.upcoming_events} event{d.upcoming_events === 1 ? '' : 's'}
                      {d.promoters > 0 && ` · ${d.promoters} promoter${d.promoters === 1 ? '' : 's'}`}
                      {d.members > 0 && ` · ${d.members} member${d.members === 1 ? '' : 's'}`}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          {shown.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {/* One expression, not text-plus-expression: React splits the
                  latter with comment markers in the server-rendered HTML. */}
              {`Nothing on in ${countryFilter} right now. `}
              <Link href={href(null)} style={{ textDecoration: 'underline' }}>See everywhere</Link>.
            </p>
          )}
        </>
      )}

      {member && (
        <p className="youPanelSub" style={{ marginTop: 20 }}>
          Somewhere missing? Follow it from <Link href="/you#places" style={{ textDecoration: 'underline' }}>your places</Link> and
          we’ll start watching it for you.
        </p>
      )}
    </main>
  );
}
