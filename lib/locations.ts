// Canonical geography. One location row per real place (city/region/
// country/destination) — "London", "LONDON" and "London, UK" resolve to the
// same row. ISO 3166 country codes, IANA timezones. City strings on
// events/venues remain as display cache; identity lives here.

import { query, queryOne } from './db';
import { canonicalCountry, countrySlug } from './countries';
import { canonicalCity } from './cityNames';

export type Location = {
  id: string;
  kind: 'city' | 'region' | 'country' | 'destination';
  name: string;
  slug: string;
  region: string | null;
  country_code: string | null;
  country_name: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

export function normalizePlaceName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Bare place slugs (/london, /berlin); country suffix only on collision.
export function slugifyPlace(name: string): string {
  return normalizePlaceName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Common country name → ISO 3166-1 alpha-2. Not exhaustive — unknown names
// keep a null code and can be fixed in admin; nothing breaks without one.
const COUNTRY_CODES: Record<string, string> = {
  'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  spain: 'ES', netherlands: 'NL', germany: 'DE', france: 'FR', italy: 'IT',
  portugal: 'PT', croatia: 'HR', belgium: 'BE', ireland: 'IE', austria: 'AT',
  switzerland: 'CH', 'czech republic': 'CZ', czechia: 'CZ', poland: 'PL',
  hungary: 'HU', romania: 'RO', greece: 'GR', malta: 'MT', cyprus: 'CY',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', iceland: 'IS', serbia: 'RS',
  tanzania: 'TZ', 'south africa': 'ZA', kenya: 'KE', nigeria: 'NG', ghana: 'GH',
  morocco: 'MA', egypt: 'EG',
  'united states': 'US', usa: 'US', us: 'US', canada: 'CA', mexico: 'MX',
  brazil: 'BR', colombia: 'CO', argentina: 'AR', chile: 'CL',
  australia: 'AU', 'new zealand': 'NZ', japan: 'JP', 'south korea': 'KR',
  china: 'CN', singapore: 'SG', thailand: 'TH', indonesia: 'ID', india: 'IN',
  'united arab emirates': 'AE', israel: 'IL', turkey: 'TR',
};

export function countryCodeFor(countryName: string | null | undefined): string | null {
  if (!countryName) return null;
  const trimmed = countryName.trim();
  // Known names/aliases first — "UK" must resolve to GB, not pass through.
  const mapped = COUNTRY_CODES[normalizePlaceName(trimmed)];
  if (mapped) return mapped;
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed; // already an ISO code
  return null;
}

export async function getLocationBySlug(slug: string): Promise<Location | null> {
  return queryOne<Location>(`select * from locations where slug = $1`, [slug]);
}

export async function getLocation(id: string): Promise<Location | null> {
  return queryOne<Location>(`select * from locations where id = $1`, [id]);
}

// Resolve a (city, country) pair to a canonical location, creating it if
// new. This is the single entry point that prevents duplicate places.
export async function findOrCreateCity(opts: {
  name: string;
  countryName?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  kind?: Location['kind'];
}): Promise<Location> {
  // "dar es salaam" and "Dar es salaam" are the same place written carelessly.
  // Fixing the casing here means it is fixed everywhere a city is created.
  const name = canonicalCity(opts.name) ?? opts.name.trim();
  const code = opts.countryCode?.toUpperCase() ?? countryCodeFor(opts.countryName);
  const normalized = normalizePlaceName(name);
  const kind = opts.kind ?? 'city';

  const existing = await queryOne<Location>(
    `select * from locations
      where kind = $1 and normalized_name = $2 and country_code is not distinct from $3`,
    [kind, normalized, code]
  );
  if (existing) return existing;

  // No country given — somebody typed "London" into a box. Reuse the London we
  // already have rather than creating a second one beside it: a duplicate city
  // splits its events in two and is invisible until somebody notices half of
  // them missing. Where the name is genuinely ambiguous we take the busiest,
  // which is the one they almost certainly meant.
  if (!code) {
    const sameName = await queryOne<Location>(
      `select l.* from locations l
        left join lateral (
          select count(*)::int as n from events e
           where e.location_id = l.id and e.status = 'live' and e.start_at > now()
        ) ev on true
       where l.kind = $1 and l.normalized_name = $2
       order by ev.n desc nulls last, l.created_at
       limit 1`,
      [kind, normalized]
    );
    if (sameName) return sameName;
  }

  // Bare slug first; on collision (a different real city with the same
  // name) fall back to a country-code suffix, then a numeric one.
  const base = slugifyPlace(name);
  const candidates = [base, code ? `${base}-${code.toLowerCase()}` : `${base}-2`, `${base}-3`, `${base}-4`];
  let slug = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (!(await queryOne(`select 1 from locations where slug = $1`, [c]))) { slug = c; break; }
  }
  const row = await queryOne<Location>(
    `insert into locations (kind, name, normalized_name, slug, country_code, country_name, timezone, latitude, longitude)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (kind, normalized_name, country_code) do update set name = locations.name
     returning *`,
    [kind, name, normalized, slug, code, opts.countryName?.trim() ?? null,
     opts.timezone ?? null, opts.latitude ?? null, opts.longitude ?? null]
  );
  return row!;
}

export async function searchLocations(q: string, limit = 8): Promise<Location[]> {
  const term = normalizePlaceName(q);
  if (!term) return [];
  return query<Location>(
    `select * from locations
      where normalized_name like $1 || '%' or normalized_name like '% ' || $1 || '%'
      order by (normalized_name = $1) desc, name
      limit $2`,
    [term, limit]
  );
}

export type MemberPlace = Location & { relation: 'home' | 'following' };

export async function memberPlaces(memberId: string): Promise<MemberPlace[]> {
  return query<MemberPlace>(
    `select l.*, 'home' as relation
       from members m join locations l on l.id = m.home_location_id
      where m.id = $1
     union all
     select l.*, 'following' as relation
       from member_locations ml join locations l on l.id = ml.location_id
      where ml.member_id = $1
      order by relation, name`,
    [memberId]
  );
}

// Destinations with real upcoming supply — drives "Explore the world".
// Never a hardcoded "cool cities" list.
export type Destination = Location & {
  upcoming_events: number;
  promoters: number;
  venues: number;
  members: number;
};

export async function liveDestinations(limit = 24): Promise<Destination[]> {
  return query<Destination>(
    `select l.*,
            coalesce(ev.n, 0) as upcoming_events,
            coalesce(pr.n, 0) as promoters,
            coalesce(ve.n, 0) as venues,
            coalesce(me.n, 0) as members
       from locations l
       join lateral (
         select count(*)::int as n from events e
          where e.location_id = l.id and e.status = 'live'
            and e.listing_status <> 'cancelled' and e.start_at > now()
       ) ev on true
       left join lateral (
         select count(distinct e.promoter_id)::int as n from events e
          where e.location_id = l.id and e.status = 'live' and e.start_at > now()
            and e.promoter_id is not null
       ) pr on true
       left join lateral (
         select count(*)::int as n from venues v where v.location_id = l.id
       ) ve on true
       left join lateral (
         select count(*)::int as n from members m where m.home_location_id = l.id
       ) me on true
      where ev.n > 0
      order by ev.n desc, l.name
      limit $1`,
    [limit]
  );
}

// --- Countries as places of their own ---------------------------------------
// /netherlands, /united-kingdom, /italy. A country is not a row anyone has to
// create: it is whatever countries the live cities are in, so a country page
// exists the moment the first event in it goes live and disappears when the
// last one passes. Names are canonicalised on the way through (see
// lib/countries), so "UK", "England" and "GB" all land on one page.

export type LiveCountry = {
  name: string;
  slug: string;
  code: string | null;
  events: number;
  cities: number;
};

// The raw country_name values in the database that mean this country. Written
// values should already be canonical, but a row that predates the cleanup
// still has to find its way to the right page.
async function rawNamesForCountry(canonical: string): Promise<string[]> {
  const rows = await query<{ country_name: string | null }>(
    `select distinct country_name from locations where country_name is not null`
  );
  return rows
    .map((r) => r.country_name as string)
    .filter((n) => canonicalCountry(n) === canonical);
}

export async function liveCountries(): Promise<LiveCountry[]> {
  const rows = await query<{ country_name: string | null; country_code: string | null; events: number }>(
    `select l.country_name, l.country_code,
            (select count(*)::int from events e
              where e.location_id = l.id and e.status = 'live'
                and e.listing_status <> 'cancelled' and e.start_at > now()) as events
       from locations l`
  );
  const byCountry = new Map<string, LiveCountry>();
  for (const r of rows) {
    if (r.events <= 0) continue;
    const name = canonicalCountry(r.country_name ?? r.country_code);
    if (!name) continue;
    const entry = byCountry.get(name) ?? {
      name, slug: countrySlug(name), code: countryCodeFor(name), events: 0, cities: 0,
    };
    entry.events += r.events;
    entry.cities += 1;
    byCountry.set(name, entry);
  }
  return [...byCountry.values()].sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
}

export type CountryPlace = LiveCountry & { rawNames: string[] };

// A country page is offered for any country we hold cities in, live events or
// not — a country with nothing on says so, rather than 404ing on a link a
// member followed yesterday.
export async function getCountryBySlug(slug: string): Promise<CountryPlace | null> {
  const wanted = slug.trim().toLowerCase();
  const rows = await query<{ country_name: string | null; country_code: string | null }>(
    `select distinct country_name, country_code from locations where country_name is not null`
  );
  const names = new Set<string>();
  for (const r of rows) {
    const name = canonicalCountry(r.country_name ?? r.country_code);
    if (name && countrySlug(name) === wanted) names.add(name);
  }
  const name = [...names][0];
  if (!name) return null;
  const live = (await liveCountries()).find((c) => c.name === name);
  return {
    name,
    slug: countrySlug(name),
    code: countryCodeFor(name),
    events: live?.events ?? 0,
    cities: live?.cities ?? 0,
    rawNames: await rawNamesForCountry(name),
  };
}

// Cities in a country that have something on, busiest first.
export async function citiesInCountry(rawNames: string[]): Promise<Destination[]> {
  return query<Destination>(
    `select l.*, ev.n as upcoming_events, 0 as promoters, 0 as venues, 0 as members
       from locations l
       join lateral (
         select count(*)::int as n from events e
          where e.location_id = l.id and e.status = 'live'
            and e.listing_status <> 'cancelled' and e.start_at > now()
       ) ev on true
      where l.country_name = any($1::text[]) and ev.n > 0
      order by ev.n desc, l.name`,
    [rawNames]
  );
}
