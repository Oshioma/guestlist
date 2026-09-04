// Personalised event recommendations — the single service behind For You,
// the member homepage, This Weekend, city pages, travel and the weekly
// email. Deterministic candidate generation + scoring: no black-box ML, no
// vector database. Weights are central, explainable, testable.
//
// Members see REASONS, never raw scores. Reason text uses only signals the
// member themselves provided or mutually visible social data.

import { query } from './db';
import { NEAR_KM } from './events';
import { DEFAULT_HOME } from './proximity';
import { tasteGenreIds } from './taste';
import { track } from './analytics';

export const REC_WEIGHTS = {
  explicitGenre: 30,
  inferredGenre: 15,
  followedPromoter: 25,
  followedArtist: 20,
  followedVenue: 15,
  homeCity: 20,
  followedCity: 15,
  travelDestination: 25,
  // Negative: distance from the member's chosen cities.
  outsideMyCities: -12, // same country, different part of it
  otherCountry: -30,    // another country entirely, and not a trip they planned
  closeFriendGoing: 30, // stronger than an ordinary connection, by design
  connectionGoing: 20,
  sceneGoing: 10,
  trendingPerGoing: 1,     // capped below
  trendingCap: 8,
  featured: 6,
  // Diversity caps (greedy, strongest first)
  maxPerPromoter: 2,
  maxPerVenue: 2,
  maxPerGenre: 3,
  // Exploration: always keep one slot for something outside the bubble.
  explorationSlots: 1,
} as const;

export type RecReason =
  | { code: 'GENRE_MATCH'; genre: string }
  | { code: 'INFERRED_GENRE'; genre: string }
  | { code: 'FOLLOWED_PROMOTER'; name: string }
  | { code: 'FOLLOWED_ARTIST'; name: string }
  | { code: 'FOLLOWED_VENUE'; name: string }
  | { code: 'HOME_CITY'; city: string }
  | { code: 'FOLLOWED_CITY'; city: string }
  | { code: 'TRAVEL_DESTINATION'; city: string }
  | { code: 'CLOSE_FRIEND_GOING'; names: string[]; count: number }
  | { code: 'CONNECTION_GOING'; names: string[]; count: number }
  | { code: 'SCENE_GOING'; count: number }
  | { code: 'TRENDING'; city: string | null }
  | { code: 'EXPLORE' };

export function reasonText(r: RecReason): string {
  switch (r.code) {
    case 'GENRE_MATCH': return `Because you like ${r.genre}`;
    case 'INFERRED_GENRE': return `Because you've been into ${r.genre}`;
    case 'FOLLOWED_PROMOTER': return `Because you follow ${r.name}`;
    case 'FOLLOWED_ARTIST': return `${r.name} is playing`;
    case 'FOLLOWED_VENUE': return `At ${r.name}, which you follow`;
    case 'HOME_CITY': return `Near you in ${r.city}`;
    case 'FOLLOWED_CITY': return `In ${r.city}`;
    case 'TRAVEL_DESTINATION': return `While you're in ${r.city}`;
    case 'CLOSE_FRIEND_GOING':
      return r.names.length
        ? `★ ${r.names.slice(0, 2).join(' and ')}${r.count > 2 ? ` +${r.count - 2}` : ''} ${r.count === 1 ? 'is' : 'are'} going`
        : `★ ${r.count} close friend${r.count === 1 ? ' is' : 's are'} going`;
    case 'CONNECTION_GOING':
      return r.names.length
        ? `${r.names.slice(0, 2).join(' and ')}${r.count > 2 ? ` +${r.count - 2}` : ''} ${r.count === 1 ? 'is' : 'are'} going`
        : `${r.count} connection${r.count === 1 ? ' is' : 's are'} going`;
    case 'SCENE_GOING':
      return r.count === 1
        ? 'Someone from your scene is going'
        : `${r.count} people from your scene are going`;
    case 'TRENDING': return r.city ? `Busy in ${r.city}` : 'Getting attention';
    case 'EXPLORE': return 'Try something different';
  }
}

export type RecommendedEvent = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  country: string | null;
  location_id: string | null;
  venue_name: string | null;
  promoter_id: string | null;
  promoter_name: string | null;
  primary_image_url: string | null;
  event_type: string;
  price_from: string | null;
  price_to: string | null;
  currency: string | null;
  listing_status: string;
  going_count: number;
  my_rsvp: string | null;
  saved: boolean;
  genres: { id: string; name: string; parent_genre_id: string | null }[];
  score: number;
  reasons: RecReason[];
};

export type RecContext = {
  limit?: number;
  locationId?: string | null;  // restrict to one city/destination
  from?: Date | null;          // window start (default now)
  to?: Date | null;            // window end (default +60 days)
  exploration?: boolean;       // default true
  excludeGoing?: boolean;      // default true (you already know about those)
};

export async function getRecommendedEvents(
  memberId: string,
  ctx: RecContext = {}
): Promise<RecommendedEvent[]> {
  const limit = Math.min(ctx.limit ?? 12, 40);
  const from = ctx.from ?? new Date();
  const to = ctx.to ?? new Date(Date.now() + 60 * 86400_000);
  const taste = await tasteGenreIds(memberId);
  const explicitIds = [...taste.explicit];
  const inferredIds = [...taste.inferred];

  const rows = await query<
    Omit<RecommendedEvent, 'score' | 'reasons'> & {
      matched_explicit: { id: string; name: string }[];
      matched_inferred: { id: string; name: string }[];
      followed_promoter: boolean;
      followed_venue: boolean;
      followed_artists: string[];
      is_home_city: boolean;
      is_followed_city: boolean;
      is_travel_city: boolean;
      near_my_places: boolean;
      in_my_country: boolean;
      close_friends_going: string[];
      connections_going: string[];
      scene_going: number;
      featured: boolean;
    }
  >(
    `with own_places as (
       select l.latitude, l.longitude, l.country_name
         from members m join locations l on l.id = m.home_location_id
        where m.id = $1
       union
       select l.latitude, l.longitude, l.country_name
         from member_locations ml join locations l on l.id = ml.location_id
        where ml.member_id = $1
     ),
     -- A member who has never set a city is placed in London (lib/proximity
     -- DEFAULT_HOME), the same stand-in every other surface uses, so their
     -- picks are not the whole world weighted equally.
     my_places as (
       select * from own_places
       union all
       select $7::float, $8::float, $9::text
        where not exists (select 1 from own_places)
     )
     select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.country, e.location_id, v.name as venue_name,
            e.promoter_id, p.name as promoter_name, e.primary_image_url,
            e.event_type, e.price_from::text, e.price_to::text, e.currency,
            e.listing_status, e.featured,
            coalesce(gc.n, 0) as going_count,
            my.rsvp as my_rsvp, (my.saved_at is not null) as saved,
            coalesce(gs.genres, '[]'::json) as genres,
            coalesce(me.matched, '[]'::json) as matched_explicit,
            coalesce(mi.matched, '[]'::json) as matched_inferred,
            exists (select 1 from member_follows f where f.member_id = $1
                     and f.entity_type = 'promoter' and f.entity_id = e.promoter_id) as followed_promoter,
            exists (select 1 from member_follows f where f.member_id = $1
                     and f.entity_type = 'venue' and f.entity_id = e.venue_id) as followed_venue,
            coalesce((select json_agg(a.name) from member_follows f
                       join event_artists ea on ea.artist_id = f.entity_id and ea.event_id = e.id
                       join artists a on a.id = f.entity_id
                      where f.member_id = $1 and f.entity_type = 'artist'), '[]'::json) as followed_artists,
            (e.location_id is not null and e.location_id =
              (select home_location_id from members where id = $1)) as is_home_city,
            exists (select 1 from member_locations ml
                     where ml.member_id = $1 and ml.location_id = e.location_id) as is_followed_city,
            exists (select 1 from travel_plans tp
                     where tp.member_id = $1 and tp.location_id = e.location_id
                       and e.start_at::date between tp.start_date and tp.end_date) as is_travel_city,
            -- Near one of the member's chosen cities, by distance rather than
            -- by name: Dar es Salaam reaches Zanzibar, London never reaches
            -- Spain. my_places is home city + followed cities.
            exists (
              select 1 from my_places p
               where e.latitude is not null and e.longitude is not null
                 and p.latitude is not null and p.longitude is not null
                 and (6371 * acos(least(1, greatest(-1,
                       cos(radians(p.latitude)) * cos(radians(e.latitude)) *
                       cos(radians(e.longitude) - radians(p.longitude)) +
                       sin(radians(p.latitude)) * sin(radians(e.latitude))
                     )))) <= ${NEAR_KM}
            ) as near_my_places,
            exists (select 1 from my_places p
                     where e.country is not null and p.country_name = e.country) as in_my_country,
            coalesce((
              -- Close friends going (the viewer's PRIVATE marks), strongest
              -- social signal. Privacy identical to connections below.
              select json_agg(m2.display_name)
                from member_connections c
                join members m2 on m2.id = case when c.requester_id = $1 then c.addressee_id else c.requester_id end
                join member_event_actions mea2 on mea2.member_id = m2.id and mea2.event_id = e.id and mea2.rsvp = 'going'
               where c.status = 'connected' and (c.requester_id = $1 or c.addressee_id = $1)
                 and case when c.requester_id = $1 then c.requester_close else c.addressee_close end
                 and coalesce((select mp.show_going and mp.profile_public
                                 from member_privacy mp where mp.member_id = m2.id), true)
                 and not exists (select 1 from member_blocks b
                       where (b.blocker_id = $1 and b.blocked_id = m2.id)
                          or (b.blocker_id = m2.id and b.blocked_id = $1))
            ), '[]'::json) as close_friends_going,
            coalesce((
              select json_agg(m2.display_name)
                from member_connections c
                join members m2 on m2.id = case when c.requester_id = $1 then c.addressee_id else c.requester_id end
                join member_event_actions mea2 on mea2.member_id = m2.id and mea2.event_id = e.id and mea2.rsvp = 'going'
               where c.status = 'connected' and (c.requester_id = $1 or c.addressee_id = $1)
                 and not case when c.requester_id = $1 then c.requester_close else c.addressee_close end
                 and coalesce((select mp.show_going and mp.profile_public
                                 from member_privacy mp where mp.member_id = m2.id), true)
                 and not exists (select 1 from member_blocks b
                       where (b.blocker_id = $1 and b.blocked_id = m2.id)
                          or (b.blocker_id = m2.id and b.blocked_id = $1))
            ), '[]'::json) as connections_going,
            coalesce((
              select count(distinct hb.member_id)::int
                from member_scene_history ha
                join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id <> $1
                join scene_entities se2 on se2.id = ha.entity_id and se2.status = 'approved'
                join member_event_actions mea3 on mea3.member_id = hb.member_id
                     and mea3.event_id = e.id and mea3.rsvp = 'going'
               where ha.member_id = $1
                 and coalesce((select mp.show_history and mp.show_going and mp.profile_public
                                 and mp.scene_discovery
                                 from member_privacy mp where mp.member_id = hb.member_id), true)
                 and coalesce((select mp.show_history from member_privacy mp
                                 where mp.member_id = $1), true)
                 and not exists (select 1 from member_blocks b
                       where (b.blocker_id = $1 and b.blocked_id = hb.member_id)
                          or (b.blocker_id = hb.member_id and b.blocked_id = $1))
            ), 0) as scene_going
       from events e
       left join venues v on v.id = e.venue_id
       left join promoters p on p.id = e.promoter_id
       left join member_event_actions my on my.member_id = $1 and my.event_id = e.id
       left join lateral (
         select count(*)::int as n from member_event_actions mea
          where mea.event_id = e.id and mea.rsvp = 'going'
       ) gc on true
       left join lateral (
         select json_agg(json_build_object('id', g.id, 'name', g.name,
                  'parent_genre_id', g.parent_genre_id)) as genres
           from event_genres eg join genres g on g.id = eg.genre_id
          where eg.event_id = e.id
       ) gs on true
       left join lateral (
         select json_agg(json_build_object('id', g.id, 'name', g.name)) as matched
           from event_genres eg join genres g on g.id = eg.genre_id
          where eg.event_id = e.id and eg.genre_id = any($2)
       ) me on true
       left join lateral (
         select json_agg(json_build_object('id', g.id, 'name', g.name)) as matched
           from event_genres eg join genres g on g.id = eg.genre_id
          where eg.event_id = e.id and eg.genre_id = any($3)
       ) mi on true
      where e.status = 'live' and e.listing_status <> 'cancelled'
        and e.start_at >= $4 and e.start_at <= $5
        and ($6::uuid is null or e.location_id = $6)
        and not exists (select 1 from event_feedback ef
                         where ef.member_id = $1 and ef.event_id = e.id)
        ${ctx.excludeGoing === false ? '' : `and (my.rsvp is distinct from 'going')`}
      limit 300`,
    [memberId, explicitIds, inferredIds, from, to, ctx.locationId ?? null,
     DEFAULT_HOME.latitude, DEFAULT_HOME.longitude, DEFAULT_HOME.country]
  );

  const w = REC_WEIGHTS;
  const scored: RecommendedEvent[] = rows.map((r) => {
    const reasons: RecReason[] = [];
    let score = 0;
    if (r.matched_explicit.length) {
      score += w.explicitGenre;
      reasons.push({ code: 'GENRE_MATCH', genre: r.matched_explicit[0].name });
    } else if (r.matched_inferred.length) {
      score += w.inferredGenre;
      reasons.push({ code: 'INFERRED_GENRE', genre: r.matched_inferred[0].name });
    }
    if (r.followed_promoter && r.promoter_name) {
      score += w.followedPromoter;
      reasons.push({ code: 'FOLLOWED_PROMOTER', name: r.promoter_name });
    }
    if (r.followed_artists.length) {
      score += w.followedArtist;
      reasons.push({ code: 'FOLLOWED_ARTIST', name: r.followed_artists[0] });
    }
    if (r.followed_venue && r.venue_name) {
      score += w.followedVenue;
      reasons.push({ code: 'FOLLOWED_VENUE', name: r.venue_name });
    }
    // A night you would have to fly to is not competing on equal terms with
    // one across town — unless you told us you are travelling there.
    if (!r.is_travel_city && !r.near_my_places) {
      score += r.in_my_country ? w.outsideMyCities : w.otherCountry;
    }
    if (r.is_travel_city && r.city) {
      score += w.travelDestination;
      reasons.push({ code: 'TRAVEL_DESTINATION', city: r.city });
    } else if (r.is_home_city && r.city) {
      score += w.homeCity;
      reasons.push({ code: 'HOME_CITY', city: r.city });
    } else if (r.is_followed_city && r.city) {
      score += w.followedCity;
      reasons.push({ code: 'FOLLOWED_CITY', city: r.city });
    }
    if (r.close_friends_going.length) {
      score += w.closeFriendGoing;
      reasons.push({ code: 'CLOSE_FRIEND_GOING', names: r.close_friends_going, count: r.close_friends_going.length });
    }
    if (r.connections_going.length) {
      score += w.connectionGoing;
      reasons.push({ code: 'CONNECTION_GOING', names: r.connections_going, count: r.connections_going.length });
    }
    if (r.scene_going > 0) {
      score += w.sceneGoing;
      reasons.push({ code: 'SCENE_GOING', count: r.scene_going });
    }
    score += Math.min(r.going_count * w.trendingPerGoing, w.trendingCap);
    if (r.featured) score += w.featured;
    // An event carried only by momentum still gets an honest reason.
    if (reasons.length === 0 && score > 0) {
      reasons.push({ code: 'TRENDING', city: r.city });
    }
    const { matched_explicit, matched_inferred, followed_promoter, followed_venue,
            followed_artists, is_home_city, is_followed_city, is_travel_city,
            near_my_places, in_my_country,
            close_friends_going, connections_going, scene_going, featured, ...event } = r;
    void matched_inferred; void followed_promoter; void followed_venue; void followed_artists;
    void is_home_city; void is_followed_city; void is_travel_city; void connections_going;
    void near_my_places; void in_my_country;
    void close_friends_going; void scene_going; void featured; void matched_explicit;
    return { ...event, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  // Diversity: greedy pick with per-promoter / per-venue / per-parent-genre
  // caps so one crew or one sound can't fill the whole list.
  const picked: RecommendedEvent[] = [];
  const promoterCount = new Map<string, number>();
  const venueCount = new Map<string, number>();
  const genreCount = new Map<string, number>();
  const explorationSlots = ctx.exploration === false ? 0 : w.explorationSlots;
  const mainSlots = Math.max(1, limit - explorationSlots);

  const topGenres = (e: RecommendedEvent) =>
    e.genres.map((g) => g.parent_genre_id ?? g.id);

  for (const e of scored) {
    if (picked.length >= mainSlots) break;
    if (e.score <= 0) break;
    const pOk = !e.promoter_id || (promoterCount.get(e.promoter_id) ?? 0) < w.maxPerPromoter;
    const vOk = !e.venue_name || (venueCount.get(e.venue_name) ?? 0) < w.maxPerVenue;
    const gOk = topGenres(e).every((g) => (genreCount.get(g) ?? 0) < w.maxPerGenre)
      || topGenres(e).length === 0;
    if (!pOk || !vOk || !gOk) continue;
    picked.push(e);
    if (e.promoter_id) promoterCount.set(e.promoter_id, (promoterCount.get(e.promoter_id) ?? 0) + 1);
    if (e.venue_name) venueCount.set(e.venue_name, (venueCount.get(e.venue_name) ?? 0) + 1);
    for (const g of topGenres(e)) genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
  }

  // Exploration: something OUTSIDE the member's taste genres — a related
  // scene, a new promoter, real community activity. Never a filter bubble.
  if (explorationSlots > 0 && picked.length >= 1) {
    const tasteIds = new Set([...taste.explicit, ...taste.inferred]);
    const explore = scored
      .filter((e) => !picked.some((p) => p.id === e.id))
      .filter((e) => !e.genres.some((g) => tasteIds.has(g.id)))
      .sort((a, b) => b.going_count - a.going_count)[0];
    if (explore) {
      picked.push({ ...explore, reasons: [{ code: 'EXPLORE' }, ...explore.reasons] });
    }
  }

  // Backfill with remaining strongest if diversity left slots empty —
  // still respecting the per-promoter cap (the caps are the contract).
  for (const e of scored) {
    if (picked.length >= limit) break;
    if (e.score <= 0) break;
    if (picked.some((p) => p.id === e.id)) continue;
    if (e.promoter_id && (promoterCount.get(e.promoter_id) ?? 0) >= w.maxPerPromoter) continue;
    picked.push(e);
    if (e.promoter_id) promoterCount.set(e.promoter_id, (promoterCount.get(e.promoter_id) ?? 0) + 1);
  }
  return picked.slice(0, limit);
}

// One analytics row per shown recommendation, reason codes in metadata.
export async function trackRecommendationImpressions(
  memberId: string,
  recs: RecommendedEvent[],
  surface: string
): Promise<void> {
  for (const r of recs.slice(0, 20)) {
    await track('recommendation_impression', {
      memberId,
      eventId: r.id,
      metadata: { surface, reasons: r.reasons.map((x) => x.code) },
    });
  }
}

// The upcoming weekend window. Mon–Thu: next Friday 00:00 UTC → Monday
// 06:00 UTC. Fri–Sun: now → the coming Monday 06:00 UTC (late Sunday
// finishes count as the same weekend).
export function weekendWindow(now = new Date()): { from: Date; to: Date } {
  const day = now.getUTCDay(); // 0 Sun … 6 Sat
  const isWeekend = day === 5 || day === 6 || day === 0;
  const from = isWeekend
    ? now
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (5 - day)));
  const daysToMonday = day === 0 ? 1 : 8 - day; // from *now's* weekday
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday, 6, 0, 0));
  return { from, to };
}
