// Public profile data for promoters, venues and artists.

import { query, queryOne } from './db';

export type PromoterProfile = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  image_url: string | null;
  hero_image_url: string | null;
  city: string | null;
  country: string | null;
  verified: boolean;
  claim_status: string;
  socials: Record<string, string>;
  genres: { name: string; slug: string }[];
  follower_count: number;
  event_count: number;
};

export async function getPromoterBySlug(slug: string): Promise<PromoterProfile | null> {
  return queryOne<PromoterProfile>(
    `select p.id, p.name, p.slug, p.description, p.website, p.image_url, p.hero_image_url,
            p.city, p.country, p.verified, p.claim_status, p.socials,
            coalesce(g.genres, '[]'::json) as genres,
            (select count(*)::int from member_follows f
              where f.entity_type = 'promoter' and f.entity_id = p.id) as follower_count,
            (select count(*)::int from events e
              where e.promoter_id = p.id and e.status = 'live') as event_count
       from promoters p
       left join lateral (
         select json_agg(json_build_object('name', g2.name, 'slug', g2.slug) order by g2.sort_order) as genres
           from promoter_genres pg join genres g2 on g2.id = pg.genre_id where pg.promoter_id = p.id
       ) g on true
      where p.slug = $1`,
    [slug]
  );
}

export type VenueProfile = {
  id: string; name: string; slug: string; description: string | null;
  hero_image_url: string | null; address: string | null; city: string | null;
  country: string | null; latitude: number | null; longitude: number | null;
  website: string | null; follower_count: number; event_count: number;
  common_genres: { name: string; slug: string; n: number }[];
};

export async function getVenueBySlug(slug: string): Promise<VenueProfile | null> {
  return queryOne<VenueProfile>(
    `select v.id, v.name, v.slug, v.description, v.hero_image_url, v.address, v.city,
            v.country, v.latitude, v.longitude, v.website,
            (select count(*)::int from member_follows f
              where f.entity_type = 'venue' and f.entity_id = v.id) as follower_count,
            (select count(*)::int from events e
              where e.venue_id = v.id and e.status = 'live') as event_count,
            coalesce(cg.genres, '[]'::json) as common_genres
       from venues v
       left join lateral (
         select json_agg(json_build_object('name', name, 'slug', gslug, 'n', n) order by n desc) as genres
           from (
             select g.name, g.slug as gslug, count(*)::int as n
               from events e
               join event_genres eg on eg.event_id = e.id
               join genres g on g.id = eg.genre_id
              where e.venue_id = v.id and e.status = 'live'
              group by g.name, g.slug order by n desc limit 6
           ) top
       ) cg on true
      where v.slug = $1`,
    [slug]
  );
}

export type ArtistProfile = {
  id: string; name: string; slug: string; image_url: string | null;
  website: string | null; follower_count: number;
  genres: { name: string; slug: string }[];
};

export async function getArtistBySlug(slug: string): Promise<ArtistProfile | null> {
  return queryOne<ArtistProfile>(
    `select a.id, a.name, a.slug, a.image_url, a.website,
            (select count(*)::int from member_follows f
              where f.entity_type = 'artist' and f.entity_id = a.id) as follower_count,
            coalesce(gg.genres, '[]'::json) as genres
       from artists a
       left join lateral (
         select json_agg(json_build_object('name', name, 'slug', gslug)) as genres
           from (
             select distinct g.name, g.slug as gslug
               from event_artists ea
               join event_genres eg on eg.event_id = ea.event_id
               join genres g on g.id = eg.genre_id
              where ea.artist_id = a.id limit 6
           ) x
       ) gg on true
      where a.slug = $1`,
    [slug]
  );
}

export async function isFollowing(
  memberId: string | null | undefined,
  entityType: 'promoter' | 'venue' | 'artist',
  entityId: string
): Promise<boolean> {
  if (!memberId) return false;
  const row = await queryOne(
    `select 1 from member_follows where member_id = $1 and entity_type = $2 and entity_id = $3`,
    [memberId, entityType, entityId]
  );
  return !!row;
}

export type PromoterDirectoryRow = {
  id: string; name: string; slug: string; image_url: string | null;
  city: string | null; country: string | null; verified: boolean;
  description: string | null;
  follower_count: number; upcoming_count: number;
  genres: { name: string; slug: string }[];
};

export async function listPromoters(opts: {
  genreSlug?: string | null;
  memberId?: string | null;
  sort: 'popular' | 'for-you';
  limit?: number;
}): Promise<PromoterDirectoryRow[]> {
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const where: string[] = [
    // Only promoters with at least one live event, or verified ones —
    // empty shells stay out of the directory.
    `(p.verified or exists (select 1 from events e where e.promoter_id = p.id and e.status = 'live'))`,
  ];
  if (opts.genreSlug) {
    where.push(`(
      exists (select 1 from promoter_genres pg join genres g on g.id = pg.genre_id
               left join genres pgp on pgp.id = g.parent_genre_id
              where pg.promoter_id = p.id and (g.slug = ${arg(opts.genreSlug)} or pgp.slug = ${arg(opts.genreSlug)}))
      or exists (select 1 from events e join event_genres eg on eg.event_id = e.id
                  join genres g on g.id = eg.genre_id
                  left join genres pgp on pgp.id = g.parent_genre_id
                 where e.promoter_id = p.id and e.status = 'live'
                   and (g.slug = ${arg(opts.genreSlug)} or pgp.slug = ${arg(opts.genreSlug)}))
    )`);
  }

  let affinity = '(select 0)';
  if (opts.sort === 'for-you' && opts.memberId) {
    affinity = `(
      3 * (select count(*) from member_follows mf
            where mf.member_id = ${arg(opts.memberId)} and mf.entity_type = 'promoter' and mf.entity_id = p.id)
      + (select count(*) from events e join event_genres eg on eg.event_id = e.id
           join member_genres mg on mg.genre_id = eg.genre_id and mg.member_id = ${arg(opts.memberId)}
          where e.promoter_id = p.id and e.status = 'live')
    )`;
  }

  return query<PromoterDirectoryRow>(
    `select p.id, p.name, p.slug, p.image_url, p.city, p.country, p.verified, p.description,
            (select count(*)::int from member_follows f
              where f.entity_type = 'promoter' and f.entity_id = p.id) as follower_count,
            (select count(*)::int from events e
              where e.promoter_id = p.id and e.status = 'live'
                and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
                and e.listing_status <> 'cancelled') as upcoming_count,
            coalesce(gj.genres, '[]'::json) as genres
       from promoters p
       left join lateral (
         select json_agg(json_build_object('name', g.name, 'slug', g.slug) order by g.sort_order) as genres
           from promoter_genres pg join genres g on g.id = pg.genre_id where pg.promoter_id = p.id
       ) gj on true
      where ${where.join(' and ')}
      order by ${affinity} desc,
        (select count(*) from member_follows f where f.entity_type = 'promoter' and f.entity_id = p.id)
        + (select count(*) from member_event_actions mea join events e on e.id = mea.event_id
            where e.promoter_id = p.id and mea.rsvp is not null) desc,
        p.name
      limit ${Math.min(opts.limit ?? 48, 96)}`,
    args
  );
}
