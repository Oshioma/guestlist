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
  // Home is where they live. Following is somewhere they care about — a city
  // they used to live in, one they visit, one they are going to in March.
  // Both beat the rest of the world; home beats both.
  kind: 'home' | 'following';
};

// A member's home city, and every city they follow. Both beat the rest of the
// world; home beats both — somebody who lives in London and follows Lagos
// wants London first, then Lagos, then everywhere else.
export async function memberPlaceAnchors(memberId: string): Promise<PlaceAnchor[]> {
  return query<PlaceAnchor>(
    `select l.latitude, l.longitude, l.country_name, 'home' as kind
       from members m join locations l on l.id = m.home_location_id
      where m.id = $1
     union all
     select l.latitude, l.longitude, l.country_name, 'following' as kind
       from member_locations ml join locations l on l.id = ml.location_id
      where ml.member_id = $1
        and ml.location_id is distinct from (select home_location_id from members where id = $1)`,
    [memberId]
  );
}

// The order Guestlist puts a member's world in.
export const TIER_NEAR = 0;      // near the city they live in
export const TIER_FOLLOWED = 1;  // near a city they follow
export const TIER_COUNTRY = 2;   // their country, or a followed city's country
export const TIER_ELSEWHERE = 3; // the rest of the world
// Nobody has told us where this member lives. Distinct from "near" on
// purpose: treating an unplaced member as if everything were on their
// doorstep is how a page ends up claiming Ibiza is local.
export const TIER_UNKNOWN = 4;

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
  const withCoords = (kind: PlaceAnchor['kind']) =>
    places.filter((p) => p.kind === kind && p.latitude != null && p.longitude != null);
  const countries = [...new Set(places.map((p) => p.country_name).filter(Boolean))] as string[];
  const home = withCoords('home');
  const followed = withCoords('following');
  if (!home.length && !followed.length && !countries.length) return `(select ${TIER_UNKNOWN})`;

  // Haversine, kilometres.
  const nearAny = (anchors: PlaceAnchor[]) => {
    if (!anchors.length) return 'false';
    const clauses = anchors.map((p) => {
      const latP = arg(p.latitude);
      const lngP = arg(p.longitude);
      return `(6371 * acos(least(1, greatest(-1,
          cos(radians(${latP})) * cos(radians(${eventAlias}.latitude)) *
          cos(radians(${eventAlias}.longitude) - radians(${lngP})) +
          sin(radians(${latP})) * sin(radians(${eventAlias}.latitude))
        )))) <= ${arg(NEAR_KM)}`;
    });
    return `(${eventAlias}.latitude is not null and ${eventAlias}.longitude is not null and (${clauses.join(' or ')}))`;
  };

  const sameCountry = countries.length
    ? `(${eventAlias}.country is not null and ${eventAlias}.country = any(${arg(countries)}))`
    : 'false';

  return `(case
      when ${nearAny(home)} then ${TIER_NEAR}
      when ${nearAny(followed)} then ${TIER_FOLLOWED}
      when ${sameCountry} then ${TIER_COUNTRY}
      else ${TIER_ELSEWHERE} end)`;
}

// What to call each tier on screen. The country is named when we know it,
// because "elsewhere" means nothing without saying elsewhere than what.
export function tierHeading(tier: number, home: { city: string | null; country: string | null }): string {
  if (tier === TIER_NEAR) return home.city ? `Tonight near ${home.city}` : 'Tonight near you';
  // A followed city is somewhere they chose to care about, so it is named as
  // that rather than lumped in with "elsewhere in your country".
  if (tier === TIER_FOLLOWED) return 'Tonight in the cities you follow';
  if (tier === TIER_COUNTRY) {
    return home.country
      ? `Elsewhere in ${countryWithArticle(home.country)} tonight`
      : 'Elsewhere in your country tonight';
  }
  return home.country ? `Beyond ${countryWithArticle(home.country)} tonight` : 'Everywhere else tonight';
}
