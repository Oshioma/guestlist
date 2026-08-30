// Member music taste. EXPLICIT (member_genres — "I like Jungle") and
// INFERRED (behaviour: views, saves, RSVPs, ticket clicks, follows) are
// stored and computed separately; inferred taste never overwrites what a
// member told us. All weights live here — nowhere else.

import { query } from './db';

export const TASTE_SIGNAL_WEIGHTS = {
  explicit: 100,      // stable anchor — always outranks behaviour
  going: 8,
  ticket_click: 8,
  interested: 5,
  save: 4,
  follow: 6,          // followed promoter/artist whose events carry the genre
  view: 1,
  hide: -8,
  not_for_me: -12,
} as const;

export type TasteGenre = {
  genre_id: string;
  name: string;
  slug: string;
  parent_genre_id: string | null;
  explicit: boolean;
  inferred_score: number;
};

export type TasteProfile = {
  explicit: TasteGenre[];
  inferred: TasteGenre[]; // behaviour-only genres, strongest first
};

// One batched query: behaviour signals joined through event_genres, plus
// follow signals through the followed entity's live events' genres.
export async function tasteProfile(memberId: string, inferredLimit = 8): Promise<TasteProfile> {
  const w = TASTE_SIGNAL_WEIGHTS;
  const rows = await query<TasteGenre & { inferred_score: number }>(
    `with behaviour as (
       select eg.genre_id,
              sum(case
                    when mea.rsvp = 'going' then ${w.going}
                    when mea.rsvp = 'interested' then ${w.interested}
                    else 0 end
                + case when mea.saved_at is not null then ${w.save} else 0 end) as score
         from member_event_actions mea
         join event_genres eg on eg.event_id = mea.event_id
        where mea.member_id = $1
        group by eg.genre_id
     ),
     activity as (
       select eg.genre_id,
              sum(case a.event_type
                    when 'event_viewed' then ${w.view}
                    when 'ticket_clicked' then ${w.ticket_click}
                    when 'event_hidden' then ${w.hide}
                    when 'event_not_for_me' then ${w.not_for_me}
                    else 0 end) as score
         from analytics_events a
         join event_genres eg on eg.event_id = a.event_id
        where a.member_id = $1
          and a.event_type in ('event_viewed', 'ticket_clicked', 'event_hidden', 'event_not_for_me')
        group by eg.genre_id
     ),
     follows as (
       select eg.genre_id, count(distinct f.entity_id) * ${w.follow} as score
         from member_follows f
         join events e on (f.entity_type = 'promoter' and e.promoter_id = f.entity_id)
                       or (f.entity_type = 'venue' and e.venue_id = f.entity_id)
         join event_genres eg on eg.event_id = e.id
        where f.member_id = $1 and f.entity_type in ('promoter', 'venue')
        group by eg.genre_id
     ),
     artist_follows as (
       select eg.genre_id, count(distinct f.entity_id) * ${w.follow} as score
         from member_follows f
         join event_artists ea on f.entity_type = 'artist' and ea.artist_id = f.entity_id
         join event_genres eg on eg.event_id = ea.event_id
        where f.member_id = $1 and f.entity_type = 'artist'
        group by eg.genre_id
     ),
     history as (
       select hg.genre_id, count(*) * ${w.follow} as score
         from member_scene_history h
         join member_scene_history_genres hg on hg.history_id = h.id
        where h.member_id = $1
        group by hg.genre_id
     ),
     combined as (
       select genre_id, sum(score) as score from (
         select * from behaviour union all select * from activity
         union all select * from follows union all select * from artist_follows
         union all select * from history
       ) s group by genre_id
     )
     select g.id as genre_id, g.name, g.slug, g.parent_genre_id,
            exists (select 1 from member_genres mg
                     where mg.member_id = $1 and mg.genre_id = g.id) as explicit,
            coalesce(c.score, 0)::float as inferred_score
       from genres g
       left join combined c on c.genre_id = g.id
      where g.active
        and (c.score is not null or exists
             (select 1 from member_genres mg where mg.member_id = $1 and mg.genre_id = g.id))
      order by explicit desc, inferred_score desc`,
    [memberId]
  );
  return {
    explicit: rows.filter((r) => r.explicit),
    inferred: rows
      .filter((r) => !r.explicit && r.inferred_score > 0)
      .slice(0, inferredLimit),
  };
}

// The genre ids used for recommendation matching: explicit always, plus the
// strongest inferred (a member with no explicit taste still gets matches).
export async function tasteGenreIds(memberId: string): Promise<{
  explicit: Set<string>;
  inferred: Set<string>;
}> {
  const profile = await tasteProfile(memberId, 5);
  return {
    explicit: new Set(profile.explicit.map((g) => g.genre_id)),
    inferred: new Set(profile.inferred.map((g) => g.genre_id)),
  };
}

export async function setExplicitGenres(memberId: string, genreIds: string[]): Promise<void> {
  const clean = [...new Set(genreIds)].slice(0, 30);
  await query(`delete from member_genres where member_id = $1`, [memberId]);
  if (clean.length) {
    await query(
      `insert into member_genres (member_id, genre_id)
       select $1, g.id from genres g where g.id = any($2) and g.active
       on conflict do nothing`,
      [memberId, clean]
    );
  }
}
