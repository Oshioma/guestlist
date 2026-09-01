// WHERE A MEMBER'S LIFE ACTUALLY IS.
//
// Three tiers, used anywhere Guestlist has to decide what to put in front of
// somebody: near one of their cities, then their country, then the rest of the
// world. Distance decides "near", not country — Dar es Salaam picks up
// Zanzibar (~65km) while London never picks up Spain.
//
// This lives on its own because two different surfaces need the same answer
// and must not drift: the events browse ranking and the Tonight list. A member
// who sees London first on one and Ibiza first on the other has been told two
// different things about where they live.

import { query } from './db';
import { countryWithArticle } from './countries';

// A city is "near" within this many kilometres. Generous enough to cover a
// region, tight enough that it never crosses a sea.
export const NEAR_KM = 150;

export type PlaceAnchor = {
  latitude: number | null;
  longitude: number | null;
  country_name: string | null;
};

// A member's home city plus every city they follow. Both count: somebody who
// lives in London and follows Lagos should see both ahead of Ibiza.
export async function memberPlaceAnchors(memberId: string): Promise<PlaceAnchor[]> {
  return query<PlaceAnchor>(
    `select l.latitude, l.longitude, l.country_name
       from members m join locations l on l.id = m.home_location_id
      where m.id = $1
     union
     select l.latitude, l.longitude, l.country_name
       from member_locations ml join locations l on l.id = ml.location_id
      where ml.member_id = $1`,
    [memberId]
  );
}

export const TIER_NEAR = 0;
export const TIER_COUNTRY = 1;
export const TIER_ELSEWHERE = 2;
// Nobody has told us where this member lives. Distinct from "near" on
// purpose: treating an unplaced member as if everything were on their
// doorstep is how a page ends up claiming Ibiza is local.
export const TIER_UNKNOWN = 3;

// A SQL expression giving 0 / 1 / 2 for an events row aliased `e`. `arg`
// appends a bind parameter and returns its placeholder, so this drops into
// whatever query the caller is already building.
//
// A member with no place set gets TIER_UNKNOWN for everything — a flat value,
// so nothing is reordered, and a value a caller can recognise so it can ask
// where they live instead of pretending to know.
export function proximityTierSql(
  places: PlaceAnchor[],
  arg: (value: unknown) => string,
  eventAlias = 'e'
): string {
  const coords = places.filter((p) => p.latitude != null && p.longitude != null);
  const countries = [...new Set(places.map((p) => p.country_name).filter(Boolean))] as string[];
  if (!coords.length && !countries.length) return `(select ${TIER_UNKNOWN})`;

  const nearClauses = coords.map((p) => {
    const latP = arg(p.latitude);
    const lngP = arg(p.longitude);
    // Haversine, kilometres.
    return `(6371 * acos(least(1, greatest(-1,
        cos(radians(${latP})) * cos(radians(${eventAlias}.latitude)) *
        cos(radians(${eventAlias}.longitude) - radians(${lngP})) +
        sin(radians(${latP})) * sin(radians(${eventAlias}.latitude))
      )))) <= ${arg(NEAR_KM)}`;
  });
  const near = nearClauses.length
    ? `(${eventAlias}.latitude is not null and ${eventAlias}.longitude is not null and (${nearClauses.join(' or ')}))`
    : 'false';
  const sameCountry = countries.length
    ? `(${eventAlias}.country is not null and ${eventAlias}.country = any(${arg(countries)}))`
    : 'false';
  return `(case when ${near} then ${TIER_NEAR} when ${sameCountry} then ${TIER_COUNTRY} else ${TIER_ELSEWHERE} end)`;
}

// What to call each tier on screen. The country is named when we know it,
// because "elsewhere" means nothing without saying elsewhere than what.
export function tierHeading(tier: number, home: { city: string | null; country: string | null }): string {
  if (tier === TIER_NEAR) return home.city ? `Tonight near ${home.city}` : 'Tonight near you';
  if (tier === TIER_COUNTRY) {
    return home.country
      ? `Elsewhere in ${countryWithArticle(home.country)} tonight`
      : 'Elsewhere in your country tonight';
  }
  return home.country ? `Beyond ${countryWithArticle(home.country)} tonight` : 'Everywhere else tonight';
}
