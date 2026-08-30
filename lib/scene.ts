// Rave history + People From Your Scene.
//
// Historical culture is first-class: scene_entities (clubs, promoters,
// parties, festivals, scenes) with moderated creation and conservative
// dedupe. "I was there" = member_scene_history.
//
// PRIVACY: matching and explanations use MUTUALLY VISIBLE signals only.
// If either member hides rave history, that history is excluded from both
// the score and the explanation — a hidden signal can never leak through a
// "you both went to X" line. Never a public compatibility percentage.

import { query, queryOne } from './db';
import { getPrivacy } from './privacy';
import { discoverableSql } from './privacy';
import { notBlockedSql, connectedSql } from './connections';

export const SCENE_WEIGHTS = {
  sharedEntity: 10,   // same club / party / festival / promoter era
  yearOverlap: 5,     // bonus when the years actually overlap
  sharedGenre: 2,     // explicit taste in common (both visible)
  sameHomeCity: 3,
} as const;

export function normalizeSceneName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(the)\s+/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SceneEntity = {
  id: string;
  name: string;
  entity_type: string;
  city: string | null;
  country_code: string | null;
  country_name: string | null;
  active_from_year: number | null;
  active_to_year: number | null;
  status: string;
  attendee_count?: number;
};

export async function searchSceneEntities(q: string, viewerId: string | null, limit = 10): Promise<SceneEntity[]> {
  const term = normalizeSceneName(q);
  if (!term) return [];
  return query<SceneEntity>(
    `select se.id, se.name, se.entity_type, se.city, se.country_code, se.country_name,
            se.active_from_year, se.active_to_year, se.status,
            (select count(*)::int from member_scene_history h where h.entity_id = se.id) as attendee_count
       from scene_entities se
      where (se.status = 'approved' or se.created_by = $2)
        and (se.normalized_name like $1 || '%' or se.normalized_name like '% ' || $1 || '%')
      order by (se.normalized_name = $1) desc, attendee_count desc, se.name
      limit $3`,
    [term, viewerId, limit]
  );
}

// Conservative dedupe: same normalized name + type + city + country is the
// same entity. Same name in a different country is a different place.
export async function findOrCreateSceneEntity(
  input: {
    name: string;
    entityType: string;
    city?: string | null;
    countryCode?: string | null;
    countryName?: string | null;
    activeFromYear?: number | null;
    activeToYear?: number | null;
  },
  createdBy: string,
  autoApprove = false
): Promise<{ entity: SceneEntity; created: boolean }> {
  const normalized = normalizeSceneName(input.name);
  const code = input.countryCode?.toUpperCase() ?? null;
  const existing = await queryOne<SceneEntity>(
    `select id, name, entity_type, city, country_code, country_name,
            active_from_year, active_to_year, status
       from scene_entities
      where normalized_name = $1 and entity_type = $2
        and coalesce(lower(city), '') = coalesce(lower($3), '')
        and coalesce(country_code, '--') = coalesce($4, '--')`,
    [normalized, input.entityType, input.city ?? null, code]
  );
  if (existing) return { entity: existing, created: false };
  const entity = await queryOne<SceneEntity>(
    `insert into scene_entities
       (name, normalized_name, entity_type, city, country_code, country_name,
        active_from_year, active_to_year, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id, name, entity_type, city, country_code, country_name,
               active_from_year, active_to_year, status`,
    [input.name.trim(), normalized, input.entityType, input.city?.trim() ?? null, code,
     input.countryName?.trim() ?? null, input.activeFromYear ?? null, input.activeToYear ?? null,
     autoApprove ? 'approved' : 'pending', createdBy]
  );
  return { entity: entity!, created: true };
}

export type HistoryRow = {
  id: string;
  entity_id: string;
  name: string;
  entity_type: string;
  city: string | null;
  country_name: string | null;
  from_year: number | null;
  to_year: number | null;
  genres: { id: string; name: string }[];
};

export async function myHistory(memberId: string): Promise<HistoryRow[]> {
  return query<HistoryRow>(
    `select h.id, se.id as entity_id, se.name, se.entity_type, se.city, se.country_name,
            h.from_year, h.to_year,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name))
                        from member_scene_history_genres hg join genres g on g.id = hg.genre_id
                       where hg.history_id = h.id), '[]'::json) as genres
       from member_scene_history h
       join scene_entities se on se.id = h.entity_id
      where h.member_id = $1
      order by coalesce(h.from_year, 3000), se.name`,
    [memberId]
  );
}

export async function addHistory(
  memberId: string,
  entityId: string,
  fromYear: number | null,
  toYear: number | null,
  genreIds: string[]
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into member_scene_history (member_id, entity_id, from_year, to_year)
     values ($1, $2, $3, $4)
     on conflict (member_id, entity_id) do update set from_year = $3, to_year = $4
     returning id`,
    [memberId, entityId, fromYear, toYear]
  );
  await query(`delete from member_scene_history_genres where history_id = $1`, [row!.id]);
  if (genreIds.length) {
    await query(
      `insert into member_scene_history_genres (history_id, genre_id)
       select $1, g.id from genres g where g.id = any($2)
       on conflict do nothing`,
      [row!.id, genreIds.slice(0, 10)]
    );
  }
  return row!.id;
}

// "43 members were there" — counts only members whose history is visible.
export async function entityAttendance(entityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n
       from member_scene_history h
       join members m on m.id = h.member_id
      where h.entity_id = $1
        and coalesce((select mp.profile_public and mp.show_history
                        from member_privacy mp where mp.member_id = m.id), true)`,
    [entityId]
  );
  return row?.n ?? 0;
}

export type SharedHistoryItem = {
  name: string;
  entity_type: string;
  city: string | null;
  overlap_from: number | null; // null when either member hides years
  overlap_to: number | null;
};

// Mutually visible shared history between two members. Empty if either
// hides rave history. Years null unless both share them.
export async function sharedHistory(viewerId: string, otherId: string): Promise<SharedHistoryItem[]> {
  const [vp, op] = await Promise.all([getPrivacy(viewerId), getPrivacy(otherId)]);
  if (!vp.show_history || !op.show_history || !op.profile_public) return [];
  const showYears = vp.show_history_years && op.show_history_years;
  const rows = await query<SharedHistoryItem & { a_from: number | null; a_to: number | null; b_from: number | null; b_to: number | null }>(
    `select se.name, se.entity_type, se.city,
            ha.from_year as a_from, ha.to_year as a_to,
            hb.from_year as b_from, hb.to_year as b_to
       from member_scene_history ha
       join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id = $2
       join scene_entities se on se.id = ha.entity_id and se.status = 'approved'
      where ha.member_id = $1
      order by se.name`,
    [viewerId, otherId]
  );
  return rows.map((r) => {
    let from: number | null = null;
    let to: number | null = null;
    if (showYears && r.a_from != null && r.b_from != null) {
      const oFrom = Math.max(r.a_from, r.b_from);
      const oTo = Math.min(r.a_to ?? r.a_from, r.b_to ?? r.b_from);
      if (oFrom <= oTo) { from = oFrom; to = oTo; }
    }
    return { name: r.name, entity_type: r.entity_type, city: r.city, overlap_from: from, overlap_to: to };
  });
}

export type ScenePerson = {
  id: string;
  display_name: string;
  slug: string | null;
  avatar_url: string | null;
  home_city: string | null; // null when hidden
  score: number;
  shared_entities: { name: string; overlap_from: number | null; overlap_to: number | null }[];
  shared_genres: string[];
  same_home_city: boolean;
  is_connected: boolean;
};

// People From Your Scene. Deterministic score from mutually visible
// signals; the number itself is never shown publicly — only readable
// reasons ("Both went to Space", "Same Jungle scene").
export async function peopleFromScene(
  viewerId: string,
  opts: { limit?: number; includeConnected?: boolean } = {}
): Promise<ScenePerson[]> {
  const limit = Math.min(opts.limit ?? 12, 40);
  const viewer = await getPrivacy(viewerId);
  const w = SCENE_WEIGHTS;
  // Viewer's own hidden facets exclude those signals for everyone (mutual
  // visibility cuts both ways).
  const useHistory = viewer.show_history;
  const useTaste = viewer.show_taste;
  const useCity = viewer.show_home_city;

  const rows = await query<ScenePerson & { shared_entities: ScenePerson['shared_entities']; shared_genres: string[] }>(
    `with candidates as (
       ${useHistory ? `
       select hb.member_id as id
         from member_scene_history ha
         join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id <> $1
         join scene_entities se on se.id = ha.entity_id and se.status = 'approved'
        where ha.member_id = $1` : `select null::uuid as id where false`}
       ${useTaste ? `
       union
       select mgb.member_id
         from member_genres mga
         join member_genres mgb on mgb.genre_id = mga.genre_id and mgb.member_id <> $1
        where mga.member_id = $1` : ''}
       ${useCity ? `
       union
       select mb.id
         from members ma join members mb
           on mb.home_location_id = ma.home_location_id and mb.id <> ma.id
        where ma.id = $1 and ma.home_location_id is not null` : ''}
     )
     select m.id, m.display_name, m.slug, m.avatar_url,
            case when coalesce(mp.show_home_city, true) then m.home_city else null end as home_city,
            ${connectedSql('$1', 'm')} as is_connected,
            ${useHistory ? `coalesce((
              select json_agg(json_build_object(
                       'name', se.name,
                       'overlap_from', case when coalesce(mp.show_history_years, true) and $2
                                            and ha.from_year is not null and hb.from_year is not null
                                            and greatest(ha.from_year, hb.from_year)
                                                <= least(coalesce(ha.to_year, ha.from_year), coalesce(hb.to_year, hb.from_year))
                                       then greatest(ha.from_year, hb.from_year) end,
                       'overlap_to', case when coalesce(mp.show_history_years, true) and $2
                                            and ha.from_year is not null and hb.from_year is not null
                                            and greatest(ha.from_year, hb.from_year)
                                                <= least(coalesce(ha.to_year, ha.from_year), coalesce(hb.to_year, hb.from_year))
                                       then least(coalesce(ha.to_year, ha.from_year), coalesce(hb.to_year, hb.from_year)) end))
                from member_scene_history ha
                join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id = m.id
                join scene_entities se on se.id = ha.entity_id and se.status = 'approved'
               where ha.member_id = $1 and coalesce(mp.show_history, true)
            ), '[]'::json)` : `'[]'::json`} as shared_entities,
            ${useTaste ? `coalesce((
              select json_agg(g.name)
                from member_genres mga
                join member_genres mgb on mgb.genre_id = mga.genre_id and mgb.member_id = m.id
                join genres g on g.id = mga.genre_id
               where mga.member_id = $1 and coalesce(mp.show_taste, true)
            ), '[]'::json)` : `'[]'::json`} as shared_genres,
            ${useCity ? `(m.home_location_id is not null and m.home_location_id =
              (select home_location_id from members where id = $1)
              and coalesce(mp.show_home_city, true))` : 'false'} as same_home_city
       from (select distinct id from candidates where id is not null) c
       join members m on m.id = c.id
       left join member_privacy mp on mp.member_id = m.id
      where ${discoverableSql('m')}
        and ${notBlockedSql('$1', 'm')}
        and m.id <> $1`,
    [viewerId, viewer.show_history_years]
  );

  const scored = rows
    .map((r) => {
      const entityScore = r.shared_entities.reduce(
        (acc, e) => acc + w.sharedEntity + (e.overlap_from != null ? w.yearOverlap : 0),
        0
      );
      const score =
        entityScore +
        r.shared_genres.length * w.sharedGenre +
        (r.same_home_city ? w.sameHomeCity : 0);
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .filter((r) => (opts.includeConnected ? true : !r.is_connected))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// The standout module: strongest shared-history matches with the era.
export type DancedWith = {
  id: string;
  display_name: string;
  slug: string | null;
  avatar_url: string | null;
  entity_name: string;
  overlap_from: number | null;
  overlap_to: number | null;
};

export async function peopleYouMayHaveDancedWith(viewerId: string, limit = 6): Promise<DancedWith[]> {
  const people = await peopleFromScene(viewerId, { limit: 30, includeConnected: false });
  const out: DancedWith[] = [];
  for (const p of people) {
    // Strongest = an entity with a real year overlap, else any shared one.
    const best =
      p.shared_entities.find((e) => e.overlap_from != null) ?? p.shared_entities[0];
    if (!best) continue;
    out.push({
      id: p.id, display_name: p.display_name, slug: p.slug, avatar_url: p.avatar_url,
      entity_name: best.name, overlap_from: best.overlap_from, overlap_to: best.overlap_to,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Human explanations from a ScenePerson — reasons, never scores.
export function sceneReasons(p: ScenePerson): string[] {
  const reasons: string[] = [];
  for (const e of p.shared_entities.slice(0, 2)) {
    reasons.push(
      e.overlap_from != null
        ? `Both went to ${e.name} (${e.overlap_from}–${e.overlap_to})`
        : `Both went to ${e.name}`
    );
  }
  if (p.shared_entities.length > 2) {
    reasons.push(`${p.shared_entities.length} places in common`);
  }
  if (p.shared_genres.length) {
    reasons.push(`Same ${p.shared_genres.slice(0, 2).join(' · ')} scene`);
  }
  if (p.same_home_city && p.home_city) reasons.push(`Both in ${p.home_city}`);
  return reasons.slice(0, 3);
}

// Social context for an event page: counts a viewer may see, computed from
// mutually visible signals only.
export type EventSocialContext = {
  connections_going: number;
  scene_going: number;
  taste_going: number;
};

export async function eventSocialContext(viewerId: string, eventId: string): Promise<EventSocialContext> {
  const viewer = await getPrivacy(viewerId);
  const row = await queryOne<EventSocialContext>(
    `with going as (
       select m.id from member_event_actions mea
         join members m on m.id = mea.member_id
         left join member_privacy mp on mp.member_id = m.id
        where mea.event_id = $2 and mea.rsvp = 'going' and m.id <> $1
          and coalesce(mp.show_going, true) and coalesce(mp.profile_public, true)
          and ${notBlockedSql('$1', 'm')}
     )
     select
       (select count(*)::int from going g join members m on m.id = g.id
         where ${connectedSql('$1', 'm')}) as connections_going,
       (select count(*)::int from going g
         where $3 and exists (
           select 1 from member_scene_history ha
             join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id = g.id
             join scene_entities se on se.id = ha.entity_id and se.status = 'approved'
            where ha.member_id = $1
              and coalesce((select mp.show_history from member_privacy mp where mp.member_id = g.id), true))
       ) as scene_going,
       (select count(*)::int from going g
         where $4 and exists (
           select 1 from member_genres mga
             join member_genres mgb on mgb.genre_id = mga.genre_id and mgb.member_id = g.id
            where mga.member_id = $1
              and coalesce((select mp.show_taste from member_privacy mp where mp.member_id = g.id), true))
       ) as taste_going`,
    [viewerId, eventId, viewer.show_history, viewer.show_taste]
  );
  return row ?? { connections_going: 0, scene_going: 0, taste_going: 0 };
}
