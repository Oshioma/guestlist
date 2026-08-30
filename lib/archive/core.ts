// Archive core: historical events, artefacts, I WAS THERE, dedupe,
// provenance, and the bridges back into present-day Guestlist.
//
// PRIVACY: attendance visibility (public / connections / private) is
// enforced by ONE SQL predicate used by every count, list, and matching
// query — private attendance can never leak through counts, Who Was There,
// people matching, or recommendation copy.

import { query, queryOne } from '../db';
import { slugify } from '../util';
import { countryCodeFor, findOrCreateCity } from '../locations';
import { findOrCreateSceneEntity, normalizeSceneName } from '../scene';
import { connectedSql, notBlockedSql } from '../connections';
import { resolveArchiveDate, type ArchiveDateInput } from './dates';
import type { ArchiveProposal } from './vision';

export type Provenance = Record<string, string>; // field → FLYER_TEXT/ADMIN/AI_INFERENCE/…

// ---------------------------------------------------------------------------
// Attendance privacy predicate. Viewer '$V' sees attendance row alias a
// when it is public, their own, or connections-visible and they are
// connected — and never across a block.
// ---------------------------------------------------------------------------

export function attendanceVisibleSql(viewer: string, a = 'a', m = 'am'): string {
  return `(
    ${a}.member_id = ${viewer}
    or (
      ${notBlockedSql(viewer, m)}
      and coalesce((select mp.profile_public from member_privacy mp where mp.member_id = ${m}.id), true)
      and (
        ${a}.visibility = 'public'
        or (${a}.visibility = 'connections' and ${connectedSql(viewer, m)})
      )
    )
  )`;
}

// Anonymous viewers: public rows from public profiles only.
export const ATTENDANCE_PUBLIC_SQL = (a = 'a', m = 'am') => `(
  ${a}.visibility = 'public'
  and coalesce((select mp.profile_public from member_privacy mp where mp.member_id = ${m}.id), true)
)`;

export async function visibleAttendanceCount(archiveEventId: string, viewerId: string | null): Promise<number> {
  const row = await queryOne<{ n: number }>(
    viewerId
      ? `select count(*)::int as n from archive_attendance a join members am on am.id = a.member_id
          where a.archive_event_id = $1 and ${attendanceVisibleSql('$2')}`
      : `select count(*)::int as n from archive_attendance a join members am on am.id = a.member_id
          where a.archive_event_id = $1 and ${ATTENDANCE_PUBLIC_SQL()}`,
    viewerId ? [archiveEventId, viewerId] : [archiveEventId]
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type ArchiveEventInput = {
  title: string;
  description?: string | null;
  originalLanguage?: string | null;
  date: ArchiveDateInput;
  venueName?: string | null;
  promoterName?: string | null;
  city?: string | null;
  country?: string | null;
  priceNote?: string | null;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
  lineup?: string[];
  genreNames?: string[];      // matched against the existing taxonomy only
  entityIds?: string[];       // pre-selected scene entities
  confidence?: number | null;
  provenance?: Provenance;
  status?: 'pending' | 'needs_review' | 'published';
};

async function uniqueArchiveSlug(title: string, year: number | null): Promise<string> {
  const base = `${slugify(title)}${year ? `-${year}` : ''}` || 'archive-event';
  let candidate = base;
  for (let i = 2; await queryOne(`select 1 from archive_events where slug = $1`, [candidate]); i++) {
    candidate = `${base}-${i}`;
  }
  return candidate;
}

export async function createArchiveEvent(
  input: ArchiveEventInput,
  createdBy: string | null
): Promise<{ id: string; slug: string; error?: never } | { error: string }> {
  const title = input.title?.trim();
  if (!title || title.length < 2) return { error: 'Title required' };
  const date = resolveArchiveDate(input.date);
  if ('error' in date) return { error: date.error };

  const code = countryCodeFor(input.country);
  let locationId: string | null = null;
  if (input.city?.trim()) {
    const loc = await findOrCreateCity({ name: input.city, countryName: input.country ?? null });
    locationId = loc.id;
  }
  const slug = await uniqueArchiveSlug(title, date.year);
  const row = await queryOne<{ id: string }>(
    `insert into archive_events
       (title, slug, description, original_language, date_precision, start_date, end_date,
        year, display_date, venue_name, promoter_name, city, country_code, country_name,
        location_id, price_note, source_url, source_attribution, confidence, provenance,
        status, created_by, published_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             case when $21 = 'published' then now() end)
     returning id`,
    [title, slug, input.description?.trim() || null, input.originalLanguage ?? null,
     date.precision, date.start_date, date.end_date, date.year, date.display_date,
     input.venueName?.trim() || null, input.promoterName?.trim() || null,
     input.city?.trim() || null, code, input.country?.trim() || null, locationId,
     input.priceNote?.trim() || null, input.sourceUrl || null,
     input.sourceAttribution?.trim() || null,
     input.confidence == null ? null : Math.min(100, Math.max(0, Math.round(input.confidence))),
     JSON.stringify(input.provenance ?? {}), input.status ?? 'pending', createdBy]
  );
  const id = row!.id;

  for (const [i, name] of (input.lineup ?? []).slice(0, 40).entries()) {
    if (!name.trim()) continue;
    const artist = await queryOne<{ id: string }>(
      `select id from artists where lower(name) = lower($1)`, [name.trim()]);
    await query(
      `insert into archive_event_artists (archive_event_id, artist_name, artist_id, position)
       values ($1, $2, $3, $4) on conflict do nothing`,
      [id, name.trim(), artist?.id ?? null, i]
    );
  }
  for (const g of input.genreNames ?? []) {
    // Taxonomy only — the archive never invents genres.
    await query(
      `insert into archive_event_genres (archive_event_id, genre_id)
       select $1, id from genres where lower(name) = lower($2) or slug = lower($2)
       on conflict do nothing`,
      [id, g.trim()]
    );
  }
  for (const entityId of input.entityIds ?? []) {
    await query(
      `insert into archive_event_entities (archive_event_id, entity_id, role)
       select $1, se.id, case when se.entity_type in ('club','venue') then 'venue'
                              when se.entity_type = 'promoter' then 'promoter'
                              else se.entity_type end
         from scene_entities se where se.id = $2
       on conflict do nothing`,
      [id, entityId]
    );
  }
  // Auto-link a venue scene entity by name+city (conservative: exact
  // normalized match only; new entity creation stays a deliberate act).
  if (input.venueName?.trim()) {
    const norm = normalizeSceneName(input.venueName);
    await query(
      `insert into archive_event_entities (archive_event_id, entity_id, role)
       select $1, se.id, 'venue' from scene_entities se
        where se.normalized_name = $2 and se.status = 'approved'
          and coalesce(lower(se.city), '') = coalesce(lower($3), '')
       on conflict do nothing`,
      [id, norm, input.city ?? null]
    );
  }
  if (input.promoterName?.trim()) {
    const norm = normalizeSceneName(input.promoterName);
    await query(
      `insert into archive_event_entities (archive_event_id, entity_id, role)
       select $1, se.id, 'promoter' from scene_entities se
        where se.normalized_name = $2 and se.entity_type = 'promoter' and se.status = 'approved'
       on conflict do nothing`,
      [id, norm]
    );
  }
  return { id, slug };
}

// ---------------------------------------------------------------------------
// Deduplication — buckets, never auto-merge on ambiguity.
// ---------------------------------------------------------------------------

export type DuplicateBucket = 'exact' | 'likely' | 'possible' | 'none';

export async function assessArchiveDuplicate(candidate: {
  title: string;
  year?: number | null;
  startDate?: string | null;
  venueName?: string | null;
  city?: string | null;
  lineup?: string[];
  sourceUrl?: string | null;
  excludeId?: string | null;
}): Promise<{ bucket: DuplicateBucket; matchId: string | null; matchTitle: string | null }> {
  if (candidate.sourceUrl) {
    const bySource = await queryOne<{ id: string; title: string }>(
      `select id, title from archive_events
        where source_url = $1 and status <> 'rejected' and ($2::uuid is null or id <> $2)`,
      [candidate.sourceUrl, candidate.excludeId ?? null]);
    if (bySource) return { bucket: 'exact', matchId: bySource.id, matchTitle: bySource.title };
  }
  const rows = await query<{
    id: string; title: string; start_date: string | null; year: number | null;
    venue_name: string | null; city: string | null; lineup: string[];
  }>(
    `select e.id, e.title, e.start_date::text, e.year, e.venue_name, e.city,
            coalesce((select array_agg(lower(artist_name)) from archive_event_artists
                       where archive_event_id = e.id), '{}') as lineup
       from archive_events e
      where e.status <> 'rejected' and ($2::uuid is null or e.id <> $2)
        and ($1::smallint is null or e.year is null or e.year = $1)
      limit 200`,
    [candidate.year ?? null, candidate.excludeId ?? null]
  );
  const normTitle = normalizeSceneName(candidate.title);
  const candLineup = new Set((candidate.lineup ?? []).map((a) => a.toLowerCase()));
  let best: { score: number; id: string; title: string } | null = null;
  for (const r of rows) {
    let score = 0;
    if (normalizeSceneName(r.title) === normTitle) score += 40;
    if (candidate.startDate && r.start_date === candidate.startDate) score += 35;
    else if (candidate.year && r.year === candidate.year) score += 10;
    if (candidate.venueName && r.venue_name
        && normalizeSceneName(r.venue_name) === normalizeSceneName(candidate.venueName)) score += 25;
    if (candidate.city && r.city && r.city.toLowerCase() === candidate.city.toLowerCase()) score += 5;
    const overlap = r.lineup.filter((a) => candLineup.has(a)).length;
    if (overlap >= 2) score += 15;
    else if (overlap === 1) score += 5;
    if (!best || score > best.score) best = { score, id: r.id, title: r.title };
  }
  if (!best || best.score < 30) return { bucket: 'none', matchId: null, matchTitle: null };
  const bucket: DuplicateBucket = best.score >= 90 ? 'exact' : best.score >= 65 ? 'likely' : 'possible';
  return { bucket, matchId: best.id, matchTitle: best.title };
}

// Merge: everything moves to the kept event; the duplicate is rejected
// (admin-only, called from the Archive Desk).
export async function mergeArchiveEvents(keepId: string, dupId: string): Promise<void> {
  await query(`update archive_items set archive_event_id = $1 where archive_event_id = $2`, [keepId, dupId]);
  await query(
    `update archive_attendance a set archive_event_id = $1
      where archive_event_id = $2
        and not exists (select 1 from archive_attendance k
                         where k.member_id = a.member_id and k.archive_event_id = $1)`,
    [keepId, dupId]);
  await query(`delete from archive_attendance where archive_event_id = $1`, [dupId]);
  await query(`update archive_memories set archive_event_id = $1 where archive_event_id = $2`, [keepId, dupId]);
  await query(
    `insert into archive_event_entities (archive_event_id, entity_id, role)
     select $1, entity_id, role from archive_event_entities where archive_event_id = $2
     on conflict do nothing`, [keepId, dupId]);
  await query(
    `insert into archive_event_genres (archive_event_id, genre_id)
     select $1, genre_id from archive_event_genres where archive_event_id = $2
     on conflict do nothing`, [keepId, dupId]);
  await query(
    `insert into archive_event_artists (archive_event_id, artist_name, artist_id, position)
     select $1, artist_name, artist_id, position from archive_event_artists where archive_event_id = $2
     on conflict do nothing`, [keepId, dupId]);
  await query(
    `update archive_events set status = 'rejected', possible_duplicate_of = $1 where id = $2`,
    [keepId, dupId]);
}

// ---------------------------------------------------------------------------
// Proposal → input (AI structuring lands as provenance-tagged suggestions).
// ---------------------------------------------------------------------------

export function proposalToInput(
  p: ArchiveProposal,
  hints: { what?: string | null; when?: string | null; where?: string | null },
  base: { sourceUrl?: string | null; sourceAttribution?: string | null }
): ArchiveEventInput {
  const prov: Provenance = {};
  const mark = (field: string, from: string) => { prov[field] = from; };

  let date: ArchiveDateInput = { precision: 'unknown' };
  if (p.date_iso) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.date_iso)) date = { precision: 'exact', startDate: p.date_iso };
    else if (/^\d{4}-\d{2}$/.test(p.date_iso)) date = { precision: 'month', startDate: `${p.date_iso}-01` };
    else date = { precision: 'year', year: Number(p.date_iso) };
    mark('date', 'FLYER_TEXT');
  } else if (p.date_text) {
    const yearMatch = p.date_text.match(/(19|20)\d{2}/);
    if (yearMatch) {
      date = { precision: 'circa', year: Number(yearMatch[0]), displayDate: p.date_text };
      mark('date', 'FLYER_TEXT');
    }
  } else if (hints.when) {
    const yearMatch = hints.when.match(/(19|20)\d{2}/);
    if (yearMatch) {
      date = { precision: 'circa', year: Number(yearMatch[0]), displayDate: hints.when.slice(0, 60) };
      mark('date', 'MEMBER_SUGGESTION');
    }
  }
  if (p.title) mark('title', 'AI_INFERENCE');
  if (p.venue_name) mark('venue', 'FLYER_TEXT');
  if (p.promoter_name) mark('promoter', 'FLYER_TEXT');
  if (p.artists.length) mark('lineup', 'FLYER_TEXT');
  if (p.genres.length) mark('genres', 'AI_INFERENCE');

  return {
    title: p.title ?? hints.what ?? 'Untitled archive event',
    description: p.description ?? null,
    originalLanguage: p.language ?? null,
    date,
    venueName: p.venue_name ?? null,
    promoterName: p.promoter_name ?? null,
    city: p.city ?? hints.where ?? null,
    country: p.country ?? null,
    priceNote: p.price_text ?? null,
    lineup: p.artists,
    genreNames: p.genres,
    confidence: p.confidence,
    provenance: prov,
    sourceUrl: base.sourceUrl ?? null,
    sourceAttribution: base.sourceAttribution ?? null,
    status: 'pending',
  };
}

// When extraction is unavailable (no API key, or it failed), the member's
// three answers still describe a night — a pending event is built from them
// so the contribution is never invisible-by-default. Publishing requires an
// attached, published event on every public surface.
export function hintsToInput(
  hints: { what?: string | null; when?: string | null; where?: string | null },
  base: { sourceAttribution?: string | null },
  itemType: string
): ArchiveEventInput {
  let date: ArchiveDateInput = { precision: 'unknown' };
  const when = hints.when?.trim() ?? '';
  const yearMatch = when.match(/(19|20)\d{2}/);
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    date = when === yearMatch[0]
      ? { precision: 'year', year }
      : { precision: 'circa', year, displayDate: when.slice(0, 60) };
  }
  return {
    title: hints.what?.trim() || `Archive ${itemType.replace(/_/g, ' ')}`,
    date,
    city: hints.where?.trim() || null,
    provenance: { all: 'MEMBER_SUGGESTION' },
    sourceAttribution: base.sourceAttribution ?? null,
    status: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Who was there — ordered: connections → shared scene history → others.
// ---------------------------------------------------------------------------

export type Attendee = {
  id: string;
  display_name: string;
  slug: string | null;
  avatar_url: string | null;
  certainty: string;
  is_connection: boolean;
  shared_scene: boolean;
};

export async function whoWasThere(
  archiveEventId: string,
  viewerId: string | null,
  limit = 24
): Promise<Attendee[]> {
  if (!viewerId) {
    return query<Attendee>(
      `select am.id, am.display_name, am.slug, am.avatar_url, a.certainty,
              false as is_connection, false as shared_scene
         from archive_attendance a join members am on am.id = a.member_id
        where a.archive_event_id = $1 and ${ATTENDANCE_PUBLIC_SQL()}
        order by a.created_at limit $2`,
      [archiveEventId, limit]
    );
  }
  return query<Attendee>(
    `select am.id, am.display_name, am.slug, am.avatar_url, a.certainty,
            ${connectedSql('$2', 'am')} as is_connection,
            exists (select 1 from member_scene_history ha
                      join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id = am.id
                     where ha.member_id = $2
                       and coalesce((select mp.show_history from member_privacy mp where mp.member_id = am.id), true)
                       and coalesce((select mp.show_history from member_privacy mp where mp.member_id = $2), true)
            ) as shared_scene
       from archive_attendance a join members am on am.id = a.member_id
      where a.archive_event_id = $1 and ${attendanceVisibleSql('$2')}
      order by ${connectedSql('$2', 'am')} desc, shared_scene desc, a.created_at
      limit $3`,
    [archiveEventId, viewerId, limit]
  );
}

// ---------------------------------------------------------------------------
// Archive → NOW. Current live events that people from this night's world
// would care about: shared genres, same city, lineage promoters.
// ---------------------------------------------------------------------------

export async function currentEventsForArchive(archiveEventId: string, limit = 4) {
  return query<{
    id: string; title: string; slug: string; start_at: string; end_at: string | null;
    timezone: string; city: string | null; reason: string;
  }>(
    `with ae as (select * from archive_events where id = $1)
     select distinct on (e.id) e.id, e.title, e.slug, e.start_at::text, e.end_at::text,
            e.timezone, e.city,
            case
              when p.id is not null then 'Linked to this scene'
              when eg2.genre_id is not null then 'Same sound'
              else 'Same city'
            end as reason
       from events e
       left join promoters p on p.id = e.promoter_id and exists (
         select 1 from archive_event_entities aee
           join scene_entities se on se.id = aee.entity_id
          where aee.archive_event_id = $1 and se.promoter_id = p.id)
       left join event_genres eg2 on eg2.event_id = e.id and eg2.genre_id in (
         select genre_id from archive_event_genres where archive_event_id = $1)
      where e.status = 'live' and e.listing_status <> 'cancelled' and e.start_at > now()
        and (
          p.id is not null
          or eg2.genre_id is not null
          or (e.location_id is not null and e.location_id = (select location_id from ae))
        )
      order by e.id, (p.id is not null) desc, (eg2.genre_id is not null) desc
      limit $2`,
    [archiveEventId, limit]
  );
}

// ---------------------------------------------------------------------------
// Discovery + search.
// ---------------------------------------------------------------------------

export async function archiveHighlights() {
  const [onThisWeek, recent, flyers, decades, entities, memories, mixes] = await Promise.all([
    // Exact/month-dated events whose calendar week matches now (any year).
    query(
      `select e.id, e.title, e.slug, e.display_date, e.city, e.year
         from archive_events e
        where e.status = 'published' and e.start_date is not null
          and e.date_precision = 'exact'
          and abs(extract(doy from e.start_date) - extract(doy from now())) <= 7
        order by e.year limit 8`
    ),
    query(
      `select e.id, e.title, e.slug, e.display_date, e.city, e.year
         from archive_events e where e.status = 'published'
        order by e.published_at desc nulls last limit 8`
    ),
    query(
      `select m.id, m.thumb_path, m.display_path, m.storage_path, m.hidden,
              i.archive_event_id, e.title, e.slug, e.display_date, e.city
         from archive_media m
         join archive_items i on i.id = m.item_id and i.status = 'published'
           and i.item_type in ('flyer', 'poster')
         join archive_events e on e.id = i.archive_event_id and e.status = 'published'
        where not m.hidden
        order by m.created_at desc limit 12`
    ),
    query(
      `select (floor(year / 10) * 10)::int as decade, count(*)::int as n
         from archive_events where status = 'published' and year is not null
        group by 1 order by 1`
    ),
    query(
      `select se.id, se.name, se.slug, se.entity_type, se.city, se.country_name,
              se.active_from_year, se.active_to_year,
              (select count(*)::int from member_scene_history h where h.entity_id = se.id) as members,
              (select count(*)::int from archive_event_entities aee
                 join archive_events ae on ae.id = aee.archive_event_id and ae.status = 'published'
                where aee.entity_id = se.id) as archive_events
         from scene_entities se
        where se.status = 'approved'
        order by archive_events desc, members desc
        limit 12`
    ),
    query(
      `select mem.body, mem.created_at::text, m.display_name,
              e.title, e.slug
         from archive_memories mem
         join members m on m.id = mem.member_id
         join archive_events e on e.id = mem.archive_event_id and e.status = 'published'
        where mem.status = 'visible'
        order by mem.created_at desc limit 6`
    ),
    query(
      `select x.id, x.title, x.artist_name, x.platform, x.url, x.credit_contributor,
              m.display_name as contributor,
              e.title as event_title, e.slug as event_slug, e.display_date
         from archive_mixes x
         join archive_events e on e.id = x.archive_event_id and e.status = 'published'
         left join members m on m.id = x.contributed_by
        where x.status = 'published'
        order by x.published_at desc limit 6`
    ),
  ]);
  return { onThisWeek, recent, flyers, decades, entities, memories, mixes };
}

export async function searchArchive(q: string, viewerId: string | null) {
  const term = normalizeSceneName(q);
  if (!term) return { entities: [], events: [], flyers: [] };
  const like = `%${term}%`;
  const [entities, events, flyers] = await Promise.all([
    query(
      `select se.id, se.name, se.slug, se.entity_type, se.city, se.country_name,
              se.active_from_year, se.active_to_year
         from scene_entities se
        where se.status = 'approved' and se.normalized_name like $1
        order by se.name limit 8`,
      [like]
    ),
    query(
      `select e.id, e.title, e.slug, e.display_date, e.city, e.venue_name, e.year
         from archive_events e
        where e.status = 'published'
          and (lower(e.title) like $1 or lower(coalesce(e.venue_name, '')) like $1
               or lower(coalesce(e.promoter_name, '')) like $1
               or exists (select 1 from archive_event_artists aa
                           where aa.archive_event_id = e.id and lower(aa.artist_name) like $1))
        order by e.year nulls last limit 12`,
      [like]
    ),
    query(
      `select m.id, m.thumb_path, m.storage_path, e.title, e.slug, e.display_date
         from archive_media m
         join archive_items i on i.id = m.item_id and i.status = 'published'
           and i.item_type in ('flyer', 'poster')
         join archive_events e on e.id = i.archive_event_id and e.status = 'published'
        where not m.hidden and lower(coalesce(e.title, '')) like $1
        limit 8`,
      [like]
    ),
  ]);
  void viewerId;
  return { entities, events, flyers };
}
