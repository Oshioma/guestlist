// Event queries for discovery, detail and admin surfaces.

import { unstable_cache } from 'next/cache';
import { query, queryOne } from './db';
import { placeAnchorsFor, proximityTierSql, DEFAULT_HOME } from './proximity';
import { londonWeekend } from './dateWindows';

// The city and genre lists are the same for everybody, yet every visit to a
// force-dynamic page (/events, the homepage, /promoters) re-ran them — the city
// count alone had been run ~9 million times. They are now kept in Next's shared
// data cache for a few minutes: a new city or genre shows up within that, and
// the database answers once per window instead of once per page view.
const SHARED_LIST_SECONDS = 300;

export type GenreTag = { id: string; name: string; slug: string; parent_genre_id: string | null };

export type EventCard = {
  id: string;
  title: string;
  slug: string;
  short_description: string | null;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  country: string | null;
  event_type: string;
  price_from: string | null;
  price_to: string | null;
  currency: string | null;
  primary_image_url: string | null;
  featured: boolean;
  listing_status: string;
  venue_name: string | null;
  going_count: number;
  interested_count: number;
  genres: { name: string; slug: string }[];
  going_avatars: { display_name: string; avatar_url: string | null }[];
};

// How far from a chosen city still counts as "near" it. Wide enough for the
// places people actually travel to for a night out (Dar es Salaam →
// Zanzibar, London → Brighton), tight enough that another country never
// qualifies by accident.
export { NEAR_KM } from './proximity';

export type BrowseTab =
  | 'for-you'
  | 'this-weekend'
  | 'day-parties'
  | 'nightlife'
  | 'festivals'
  | 'travel';

export type BrowseParams = {
  tab: BrowseTab;
  genreSlug?: string | null;
  // Any of these (each including its subgenres). Combined with genreSlug.
  genreSlugs?: string[];
  eventType?: string | null;
  city?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  maxPrice?: number | null;
  freeOnly?: boolean;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  sort: 'recommended' | 'soonest' | 'popular' | 'newest';
  member?: { id: string; home_country: string | null } | null;
  // The member's country as their PLACE knows it, when the text field on
  // their profile is empty. Resolved by the caller so this stays one query.
  homeCountry?: string | null;
  /** Free text: the night's name, its venue, its city, its promoter, its line-up. */
  q?: string | null;
  limit?: number;
  /** Rows to skip, for ?page=2 and on. */
  offset?: number;
};

/** One page of /events and /events/past. */
export const BROWSE_PAGE_SIZE = 60;
// Deep offsets make Postgres sort and throw away everything before them; past
// a few thousand rows nobody is paging, they are a crawler. 100 pages of 60.
export const MAX_BROWSE_OFFSET = 6000;

export function clampOffset(offset: number | null | undefined): number {
  const n = Math.floor(Number(offset) || 0);
  return Math.min(Math.max(n, 0), MAX_BROWSE_OFFSET);
}

// Upcoming = not yet finished (events with no end time get a 6h grace window).
const UPCOMING_SQL = `coalesce(e.end_at, e.start_at + interval '6 hours') > now()`;
// Cancelled events stay on their own pages (clearly marked) but leave the
// browse grid; sold out / postponed remain listed with badges.
const LISTABLE_SQL = `e.listing_status <> 'cancelled'`;

export async function browseEvents(params: BrowseParams): Promise<EventCard[]> {
  const where: string[] = [`e.status = 'live'`, UPCOMING_SQL, LISTABLE_SQL];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };

  switch (params.tab) {
    case 'this-weekend': {
      // Friday to Monday morning in London, whatever the server's clock says
      // (lib/dateWindows).
      const { from, to } = londonWeekend();
      // Any overlap with the weekend window (multi-day festivals included).
      where.push(
        `e.start_at < ${arg(to)} and coalesce(e.end_at, e.start_at + interval '6 hours') > ${arg(from)}`
      );
      break;
    }
    case 'day-parties':
      where.push(`e.event_type in ('day_party', 'beach_party', 'boat_party')`);
      break;
    case 'nightlife':
      where.push(`e.event_type = 'club_night'`);
      break;
    case 'festivals':
      where.push(`e.event_type in ('festival', 'weekender')`);
      break;
    case 'travel': {
      // Away from home. Two things were quietly making this tab lie:
      //
      // 1. It read only members.home_country, a free-text field that is empty
      //    for anyone who set their city rather than typing a country — so
      //    the tab fell back to "flagged worth travelling" alone, and a real
      //    Paris night nobody had flagged was invisible.
      // 2. `e.country <> home` drops every event with NO country recorded.
      //    An event whose country we never captured is not thereby at home.
      // Nobody we cannot place is at home in the UK (lib/proximity), so
      // "away" means outside the United Kingdom for them.
      const home = params.member?.home_country ?? params.homeCountry ?? DEFAULT_HOME.country;
      const eventCountry =
        `coalesce(e.country, (select l.country_name from locations l where l.id = e.location_id))`;
      where.push(`(e.worth_travelling or ${eventCountry} is distinct from ${arg(home)})`);
      break;
    }
  }

  const genreSlugs = [...new Set([...(params.genreSlugs ?? []), ...(params.genreSlug ? [params.genreSlug] : [])])];
  if (genreSlugs.length) {
    // ANY of the chosen genres; a parent genre includes all of its subgenres.
    const slugs = arg(genreSlugs);
    where.push(`exists (
      select 1 from event_genres eg
        join genres g on g.id = eg.genre_id
        left join genres pg on pg.id = g.parent_genre_id
       where eg.event_id = e.id and (g.slug = any(${slugs}::text[]) or pg.slug = any(${slugs}::text[]))
    )`);
  }
  if (params.q) {
    // Searching a listings site means "I half-remember something": a name, a
    // room, a DJ. So it looks in all of them at once rather than making
    // somebody choose which field their memory belongs to. ILIKE with a
    // wildcard both ends — a prefix index would not help a search for
    // "warehouse" inside "The Old Warehouse", and these are small tables.
    const like = `%${params.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(`(
      e.title ilike ${arg(like)} escape '\\'
      or e.city ilike ${arg(like)} escape '\\'
      or exists (select 1 from venues v2 where v2.id = e.venue_id and v2.name ilike ${arg(like)} escape '\\')
      or exists (select 1 from promoters p2 where p2.id = e.promoter_id and p2.name ilike ${arg(like)} escape '\\')
      or exists (
        select 1 from event_artists ea2 join artists a2 on a2.id = ea2.artist_id
         where ea2.event_id = e.id and a2.name ilike ${arg(like)} escape '\\'
      )
    )`);
  }
  if (params.eventType) where.push(`e.event_type = ${arg(params.eventType)}::event_type`);
  if (params.city) where.push(`lower(e.city) = lower(${arg(params.city)})`);
  if (params.dateFrom) where.push(`coalesce(e.end_at, e.start_at + interval '6 hours') > ${arg(params.dateFrom)}`);
  if (params.dateTo) where.push(`e.start_at < ${arg(params.dateTo)}`);
  if (params.freeOnly) where.push(`e.price_from = 0`);
  else if (params.maxPrice != null) where.push(`(e.price_from is null or e.price_from <= ${arg(params.maxPrice)})`);

  let distanceSelect = 'null::float as distance_km';
  if (params.lat != null && params.lng != null) {
    const latP = arg(params.lat);
    const lngP = arg(params.lng);
    // Haversine, km.
    distanceSelect = `(6371 * acos(least(1, greatest(-1,
        cos(radians(${latP})) * cos(radians(e.latitude)) *
        cos(radians(e.longitude) - radians(${lngP})) +
        sin(radians(${latP})) * sin(radians(e.latitude))
      )))) as distance_km`;
    if (params.radiusKm != null) {
      where.push(`e.latitude is not null and e.longitude is not null and
        (6371 * acos(least(1, greatest(-1,
          cos(radians(${latP})) * cos(radians(e.latitude)) *
          cos(radians(e.longitude) - radians(${lngP})) +
          sin(radians(${latP})) * sin(radians(e.latitude))
        )))) <= ${arg(params.radiusKm)}`);
    }
  }

  // Where a member's life actually is. Events near one of their chosen
  // cities rank above events merely in the same country, which rank above
  // the rest of the world — so someone in London is not shown Ibiza and
  // Zanzibar ahead of what is on this weekend. Distance, not country, is
  // what decides "near": Dar es Salaam picks up Zanzibar (~65km) while
  // London never picks up Spain.
  // Worth Travelling For is *about* leaving home, so it never gets the
  // near-home tier applied to it.
  // Where a member's life actually is — near one of their cities, then their
  // country, then the rest of the world. One definition, shared with the
  // Tonight list (lib/proximity), so the two surfaces cannot disagree about
  // where somebody lives.
  // Worth Travelling For is *about* leaving home, so it never gets the
  // near-home tier applied to it.
  // Anyone we cannot place — signed out, or a member who never set a city —
  // is placed in London (lib/proximity): London first, then the rest of the
  // UK, then the world. A UK guide by default.
  // Both of these only feed the RECOMMENDED order. Built for any other sort,
  // their parameters were bound but never used — and Postgres refuses a query
  // that is handed more parameters than it reads, so Soonest, Most Popular and
  // Recently Added failed outright.
  const recommended = params.sort === 'recommended';
  let proximityTier = '(select 0)';
  if (recommended && params.tab !== 'travel') {
    proximityTier = proximityTierSql(await placeAnchorsFor(params.member?.id), arg);
  }

  // Recommended ranking: near home first, then featured, then follow +
  // explicit-genre affinity for signed-in members (a followed
  // promoter/venue/artist counts double), then soonest.
  let genreAffinity = '(select 0)';
  if (recommended && params.member?.id) {
    const memberParam = arg(params.member.id);
    genreAffinity = `(
      (select count(*) from event_genres eg2
         join member_genres mg on mg.genre_id = eg2.genre_id
        where eg2.event_id = e.id and mg.member_id = ${memberParam})
      + 2 * (select count(*) from member_follows mf
        where mf.member_id = ${memberParam} and (
          (mf.entity_type = 'promoter' and mf.entity_id = e.promoter_id) or
          (mf.entity_type = 'venue' and mf.entity_id = e.venue_id) or
          (mf.entity_type = 'artist' and mf.entity_id in
            (select ea3.artist_id from event_artists ea3 where ea3.event_id = e.id))
        ))
    )`;
  }

  // Every order ends on the id. Two nights starting at the same minute (and
  // on a Saturday at 22:00 there are dozens) otherwise come back in whatever
  // order Postgres likes that time, and with paging that means a night can
  // appear on page one and again on page two while another is never shown.
  const orderBy = {
    recommended: `${proximityTier} asc, e.featured desc, ${genreAffinity} desc, e.start_at asc, e.id`,
    soonest: `e.start_at asc, e.id`,
    popular: `(pop.going_count * 2 + pop.interested_count) desc, e.start_at asc, e.id`,
    newest: `coalesce(e.published_at, e.created_at) desc, e.id`,
  }[params.sort];

  const rows = await query<EventCard & { distance_km: number | null }>(
    `select e.id, e.title, e.slug, e.short_description, e.start_at, e.end_at, e.timezone,
            e.city, e.country, e.event_type, e.price_from, e.price_to, e.currency,
            e.primary_image_url, e.featured, e.listing_status,
            v.name as venue_name,
            pop.going_count, pop.interested_count,
            coalesce(gj.genres, '[]'::json) as genres,
            coalesce(av.going_avatars, '[]'::json) as going_avatars,
            ${distanceSelect}
       from events e
       left join venues v on v.id = e.venue_id
       cross join lateral (
         select count(*) filter (where mea.rsvp = 'going')::int as going_count,
                count(*) filter (where mea.rsvp = 'interested')::int as interested_count
           from member_event_actions mea where mea.event_id = e.id
       ) pop
       left join lateral (
         select json_agg(json_build_object('name', g.name, 'slug', g.slug) order by g.sort_order) as genres
           from event_genres eg join genres g on g.id = eg.genre_id
          where eg.event_id = e.id
       ) gj on true
       left join lateral (
         select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url)) as going_avatars
           from (
             select m2.display_name, m2.avatar_url
               from member_event_actions mea join members m2 on m2.id = mea.member_id
              where mea.event_id = e.id and mea.rsvp = 'going'
              order by mea.rsvp_at asc limit 4
           ) m
       ) av on true
      where ${where.join(' and ')}
      order by ${orderBy}
      limit ${Math.min(params.limit ?? BROWSE_PAGE_SIZE, 121)} offset ${clampOffset(params.offset)}`,
    args
  );
  return rows;
}

// Event cards for an entity page (promoter / venue / artist).
export async function eventsForEntity(
  entity: { promoterId?: string; venueId?: string; artistId?: string },
  when: 'upcoming' | 'past',
  limit = 24
): Promise<EventCard[]> {
  const where: string[] = [`e.status = 'live'`];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (entity.promoterId) where.push(`e.promoter_id = ${arg(entity.promoterId)}`);
  if (entity.venueId) where.push(`e.venue_id = ${arg(entity.venueId)}`);
  if (entity.artistId) {
    where.push(`exists (select 1 from event_artists ea where ea.event_id = e.id and ea.artist_id = ${arg(entity.artistId)})`);
  }
  if (when === 'upcoming') {
    where.push(UPCOMING_SQL, LISTABLE_SQL);
  } else {
    where.push(`coalesce(e.end_at, e.start_at + interval '6 hours') <= now()`);
  }
  return query<EventCard>(
    `select e.id, e.title, e.slug, e.short_description, e.start_at, e.end_at, e.timezone,
            e.city, e.country, e.event_type, e.price_from, e.price_to, e.currency,
            e.primary_image_url, e.featured, e.listing_status,
            v.name as venue_name,
            pop.going_count, pop.interested_count,
            coalesce(gj.genres, '[]'::json) as genres,
            coalesce(av.going_avatars, '[]'::json) as going_avatars
       from events e
       left join venues v on v.id = e.venue_id
       cross join lateral (
         select count(*) filter (where mea.rsvp = 'going')::int as going_count,
                count(*) filter (where mea.rsvp = 'interested')::int as interested_count
           from member_event_actions mea where mea.event_id = e.id
       ) pop
       left join lateral (
         select json_agg(json_build_object('name', g.name, 'slug', g.slug) order by g.sort_order) as genres
           from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = e.id
       ) gj on true
       left join lateral (
         select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url)) as going_avatars
           from (
             select m2.display_name, m2.avatar_url
               from member_event_actions mea join members m2 on m2.id = mea.member_id
              where mea.event_id = e.id and mea.rsvp = 'going'
              order by mea.rsvp_at asc limit 4
           ) m
       ) av on true
      where ${where.join(' and ')}
      order by e.start_at ${when === 'upcoming' ? 'asc' : 'desc'}
      limit ${Math.min(limit, 60)}`,
    args
  );
}

// The columns and joins an EventCard is built from, for the lists below.
// browseEvents and eventsForEntity predate this and spell it out themselves.
const CARD_SELECT = `
    select e.id, e.title, e.slug, e.short_description, e.start_at, e.end_at, e.timezone,
           e.city, e.country, e.event_type, e.price_from, e.price_to, e.currency,
           e.primary_image_url, e.featured, e.listing_status,
           v.name as venue_name,
           pop.going_count, pop.interested_count,
           coalesce(gj.genres, '[]'::json) as genres,
           coalesce(av.going_avatars, '[]'::json) as going_avatars`;
const CARD_JOINS = `
      left join venues v on v.id = e.venue_id
      cross join lateral (
        select count(*) filter (where mea.rsvp = 'going')::int as going_count,
               count(*) filter (where mea.rsvp = 'interested')::int as interested_count
          from member_event_actions mea where mea.event_id = e.id
      ) pop
      left join lateral (
        select json_agg(json_build_object('name', g.name, 'slug', g.slug) order by g.sort_order) as genres
          from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = e.id
      ) gj on true
      left join lateral (
        select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url)) as going_avatars
          from (
            select m2.display_name, m2.avatar_url
              from member_event_actions mea join members m2 on m2.id = mea.member_id
             where mea.event_id = e.id and mea.rsvp = 'going'
             order by mea.rsvp_at asc limit 4
          ) m
      ) av on true`;

const FINISHED_SQL = `coalesce(e.end_at, e.start_at + interval '6 hours') <= now()`;

/**
 * MORE LIKE THIS.
 *
 * Somebody on a night's page has already told us what they are into — that
 * night. Whether it suits them or not, the next thing they want is the same
 * sound, ideally in the same city, so that is the order: shares a genre and
 * is in the same city, then shares a genre anywhere. A genre counts as shared
 * through its family (jungle sits under drum & bass), because that difference
 * matters to a promoter tagging a night far more than to somebody looking for
 * one. Upcoming, live and not cancelled only — and never the night itself.
 *
 * A night with no genres has nothing to be like, and gets nothing rather than
 * a list of whatever happens to be on.
 */
export async function relatedEvents(
  event: { id: string; city: string | null },
  limit = 6
): Promise<EventCard[]> {
  return query<EventCard>(
    `with fam as (
       select distinct coalesce(g.parent_genre_id, g.id) as family_id
         from event_genres eg join genres g on g.id = eg.genre_id
        where eg.event_id = $1
     )
     ${CARD_SELECT}
       from events e
       ${CARD_JOINS}
      where e.status = 'live' and ${UPCOMING_SQL} and ${LISTABLE_SQL}
        and e.id <> $1
        and exists (
          select 1 from event_genres eg2 join genres g2 on g2.id = eg2.genre_id
           where eg2.event_id = e.id
             and coalesce(g2.parent_genre_id, g2.id) in (select family_id from fam)
        )
      order by ($2::text is not null and lower(e.city) = lower($2::text)) desc nulls last,
               e.start_at asc, e.id
      limit ${Math.min(Math.max(Math.floor(limit), 1), 24)}`,
    [event.id, event.city]
  );
}

export type MemberEventCard = EventCard & {
  saved: boolean;
  rsvp: 'interested' | 'going' | null;
};

/**
 * Everything a member has put their hand up for — saved, interested or
 * going — split into what is still to come and what has just happened.
 *
 * Cancelled nights stay in the upcoming list, unlike everywhere else: this is
 * the one place somebody finds out the night they were going to has been
 * called off, and the card says so. The past is the last 90 days; anything
 * older is history, which lives on the profile (lib/scene).
 */
export async function memberEvents(memberId: string): Promise<{
  upcoming: MemberEventCard[];
  past: MemberEventCard[];
}> {
  const list = (when: string, order: string, limit: number) =>
    query<MemberEventCard>(
      `${CARD_SELECT},
              (mine.saved_at is not null) as saved, mine.rsvp
         from member_event_actions mine
         join events e on e.id = mine.event_id
         ${CARD_JOINS}
        where mine.member_id = $1 and e.status = 'live'
          and (mine.saved_at is not null or mine.rsvp is not null)
          and ${when}
        order by ${order}
        limit ${limit}`,
      [memberId]
    );
  const [upcoming, past] = await Promise.all([
    list(UPCOMING_SQL, 'e.start_at asc, e.id', 120),
    list(`${FINISHED_SQL} and e.start_at > now() - interval '90 days'`, 'e.start_at desc, e.id', 24),
  ]);
  return { upcoming, past };
}

/**
 * The archive of nights that have happened: live listings that finished,
 * newest first, a page at a time (/events/past). Cancelled ones are left out
 * — they never happened, and their own pages still say so.
 */
export async function pastEvents(opts: { offset?: number; limit?: number } = {}): Promise<EventCard[]> {
  return query<EventCard>(
    `${CARD_SELECT}
       from events e
       ${CARD_JOINS}
      where e.status = 'live' and ${FINISHED_SQL} and ${LISTABLE_SQL}
      order by e.start_at desc, e.id
      limit ${Math.min(Math.max(Math.floor(opts.limit ?? BROWSE_PAGE_SIZE), 1), 121)} offset ${clampOffset(opts.offset)}`
  );
}

export type EventDetail = EventCard & {
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  ticket_url: string | null;
  source_url: string | null;
  status: string;
  venue: {
    name: string; slug: string; address: string | null; city: string | null;
    country: string | null; latitude: number | null; longitude: number | null; website: string | null;
  } | null;
  promoter: {
    id: string; name: string; slug: string; description: string | null;
    website: string | null; image_url: string | null; verified: boolean;
  } | null;
  lineup: { name: string; slug: string; position: number; billing: string | null }[];
  images: { url: string; alt: string | null }[];
};

export async function getEventBySlug(slug: string, includeUnpublished = false): Promise<EventDetail | null> {
  return queryOne<EventDetail>(
    `select e.*, v.name as venue_name,
            pop.going_count, pop.interested_count,
            coalesce(gj.genres, '[]'::json) as genres,
            coalesce(av.going_avatars, '[]'::json) as going_avatars,
            case when v.id is not null then json_build_object(
              'name', v.name, 'slug', v.slug, 'address', v.address, 'city', v.city,
              'country', v.country, 'latitude', v.latitude, 'longitude', v.longitude,
              'website', v.website) end as venue,
            case when p.id is not null then json_build_object(
              'id', p.id, 'name', p.name, 'slug', p.slug, 'description', p.description,
              'website', p.website, 'image_url', p.image_url, 'verified', p.verified) end as promoter,
            coalesce(lu.lineup, '[]'::json) as lineup,
            coalesce(im.images, '[]'::json) as images
       from events e
       left join venues v on v.id = e.venue_id
       left join promoters p on p.id = e.promoter_id
       cross join lateral (
         select count(*) filter (where mea.rsvp = 'going')::int as going_count,
                count(*) filter (where mea.rsvp = 'interested')::int as interested_count
           from member_event_actions mea where mea.event_id = e.id
       ) pop
       left join lateral (
         select json_agg(json_build_object('name', g.name, 'slug', g.slug) order by g.sort_order) as genres
           from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = e.id
       ) gj on true
       left join lateral (
         select json_agg(json_build_object('display_name', m.display_name, 'avatar_url', m.avatar_url)) as going_avatars
           from (
             select m2.display_name, m2.avatar_url
               from member_event_actions mea join members m2 on m2.id = mea.member_id
              where mea.event_id = e.id and mea.rsvp = 'going'
              order by mea.rsvp_at asc limit 6
           ) m
       ) av on true
       left join lateral (
         select json_agg(json_build_object('name', a.name, 'slug', a.slug,
                  'position', ea.position, 'billing', ea.billing) order by ea.position) as lineup
           from event_artists ea join artists a on a.id = ea.artist_id where ea.event_id = e.id
       ) lu on true
       left join lateral (
         select json_agg(json_build_object('url', i.url, 'alt', i.alt) order by i.sort_order) as images
           from event_images i where i.event_id = e.id
       ) im on true
      where e.slug = $1 ${includeUnpublished ? '' : `and e.status = 'live'`}`,
    [slug]
  );
}

export const getTopLevelGenres = unstable_cache(
  async (): Promise<GenreTag[]> =>
    query<GenreTag>(
      `select id, name, slug, parent_genre_id from genres
        where parent_genre_id is null and active
        order by sort_order, name`
    ),
  ['events:top-level-genres'],
  { revalidate: SHARED_LIST_SECONDS }
);

/** Every active genre with its parent's name, for the /events genre filter. */
export const getFilterGenres = unstable_cache(
  async (): Promise<{ name: string; slug: string; parent_name: string | null }[]> =>
    query<{ name: string; slug: string; parent_name: string | null }>(
      `select g.name, g.slug, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.parent_genre_id nulls first, g.sort_order`
    ),
  ['events:filter-genres'],
  { revalidate: SHARED_LIST_SECONDS }
);

export const getLiveCities = unstable_cache(
  async (): Promise<{ city: string; country: string | null; n: number }[]> =>
    query<{ city: string; country: string | null; n: number }>(
      `select e.city, min(e.country) as country, count(*)::int as n
         from events e
        where e.status = 'live' and e.city is not null and ${UPCOMING_SQL}
        group by e.city order by n desc, e.city`
    ),
  ['events:live-cities'],
  { revalidate: SHARED_LIST_SECONDS }
);

export async function getMemberAction(
  memberId: string,
  eventId: string
): Promise<{ saved: boolean; rsvp: 'interested' | 'going' | null }> {
  const row = await queryOne<{ saved_at: string | null; rsvp: 'interested' | 'going' | null }>(
    `select saved_at, rsvp from member_event_actions where member_id = $1 and event_id = $2`,
    [memberId, eventId]
  );
  return { saved: !!row?.saved_at, rsvp: row?.rsvp ?? null };
}

export async function getGoingMembers(eventId: string): Promise<{
  going: { id: string; display_name: string; avatar_url: string | null; home_city: string | null; slug: string | null }[];
  interested: { id: string; display_name: string; avatar_url: string | null; home_city: string | null; slug: string | null }[];
}> {
  const rows = await query<{
    id: string; display_name: string; avatar_url: string | null;
    home_city: string | null; slug: string | null; rsvp: 'interested' | 'going';
  }>(
    `select m.id, m.display_name, m.avatar_url, m.home_city, m.slug, mea.rsvp
       from member_event_actions mea join members m on m.id = mea.member_id
      where mea.event_id = $1 and mea.rsvp is not null
      order by mea.rsvp_at asc`,
    [eventId]
  );
  return {
    going: rows.filter((r) => r.rsvp === 'going'),
    interested: rows.filter((r) => r.rsvp === 'interested'),
  };
}
