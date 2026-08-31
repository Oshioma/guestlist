// A place in the culture: THE END · London · 1995–2009. The historical
// scene leading straight back into the present social network — members
// who went, what they're going to now, the archived nights and flyers.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { discoverableSql } from '@/lib/privacy';
import { notBlockedSql } from '@/lib/connections';
import { fmtEventDate } from '@/lib/util';
import { AddToHistoryButton } from '@/components/archive/AddToHistoryButton';
import { AddMixForm } from '@/components/archive/AddMixForm';
import { MixCard, type MixRow } from '@/components/archive/MixCard';

export const dynamic = 'force-dynamic';

export default async function SceneEntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await getCurrentMember();

  const entity = await queryOne<{
    id: string; name: string; entity_type: string; city: string | null;
    country_name: string | null; active_from_year: number | null;
    active_to_year: number | null; description: string | null; status: string;
  }>(
    `select id, name, entity_type, city, country_name, active_from_year,
            active_to_year, description, status
       from scene_entities where slug = $1`,
    [slug]
  );
  if (!entity || (entity.status !== 'approved' && member?.role !== 'admin')) notFound();

  const [memberCount, myHistory, genres, events, flyers, people, lineage, nowEvents, mixes] = await Promise.all([
    queryOne<{ n: number }>(
      `select count(*)::int as n from member_scene_history h
         join members m on m.id = h.member_id
        where h.entity_id = $1
          and coalesce((select mp.profile_public and mp.show_history
                          from member_privacy mp where mp.member_id = m.id), true)`,
      [entity.id]
    ).then((r) => r?.n ?? 0),
    member
      ? queryOne(`select 1 from member_scene_history where member_id = $1 and entity_id = $2`,
          [member.id, entity.id]).then((r) => !!r)
      : Promise.resolve(false),
    query<{ name: string }>(
      `select distinct g.name from member_scene_history h
         join member_scene_history_genres hg on hg.history_id = h.id
         join genres g on g.id = hg.genre_id
        where h.entity_id = $1 limit 6`,
      [entity.id]
    ),
    query<{ id: string; title: string; slug: string; display_date: string; year: number | null }>(
      `select e.id, e.title, e.slug, e.display_date, e.year
         from archive_event_entities aee
         join archive_events e on e.id = aee.archive_event_id and e.status = 'published'
        where aee.entity_id = $1
        order by e.year nulls last, e.start_date nulls last limit 30`,
      [entity.id]
    ),
    query<{ id: string; thumb_path: string | null; storage_path: string; slug: string; title: string }>(
      `select m.id, m.thumb_path, m.storage_path, e.slug, e.title
         from archive_media m
         join archive_items i on i.id = m.item_id and i.status = 'published'
         join archive_event_entities aee on aee.archive_event_id = i.archive_event_id
         join archive_events e on e.id = i.archive_event_id and e.status = 'published'
        where aee.entity_id = $1 and not m.hidden
        limit 8`,
      [entity.id]
    ),
    member
      ? query<{ id: string; display_name: string; slug: string | null; avatar_url: string | null; from_year: number | null; to_year: number | null }>(
          `select m.id, m.display_name, m.slug, m.avatar_url, h.from_year, h.to_year
             from member_scene_history h join members m on m.id = h.member_id
            where h.entity_id = $1 and m.id <> $2
              and ${discoverableSql('m')} and ${notBlockedSql('$2', 'm')}
              and coalesce((select mp.show_history from member_privacy mp where mp.member_id = m.id), true)
            order by h.from_year nulls last limit 12`,
          [entity.id, member.id]
        )
      : Promise.resolve([]),
    query<{ name: string; slug: string | null; relation: string }>(
      `select se.name, se.slug, l.relation from scene_entity_links l
         join scene_entities se on se.id = l.to_entity
        where l.from_entity = $1
       union all
       select se.name, se.slug, 'predecessor' from scene_entity_links l
         join scene_entities se on se.id = l.from_entity
        where l.to_entity = $1`,
      [entity.id]
    ),
    // What people from this scene are going to now (aggregate, privacy-safe).
    query<{ id: string; title: string; slug: string; start_at: string; end_at: string | null; timezone: string; city: string | null; n: number }>(
      `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city,
              count(distinct mea.member_id)::int as n
         from member_scene_history h
         join member_event_actions mea on mea.member_id = h.member_id and mea.rsvp = 'going'
         join events e on e.id = mea.event_id
         join members m on m.id = h.member_id
        where h.entity_id = $1 and e.status = 'live'
          and e.listing_status <> 'cancelled' and e.start_at > now()
          and coalesce((select mp.show_going and mp.profile_public
                          from member_privacy mp where mp.member_id = m.id), true)
        group by e.id order by n desc, e.start_at limit 4`,
      [entity.id]
    ),
    // Mixes: attached to this scene directly, plus every mix from its
    // archived nights — the scene page becomes a listening page.
    query<MixRow>(
      `select x.id, x.title, x.artist_name, x.platform, x.url, x.credit_contributor,
              m.display_name as contributor,
              e.title as event_title, e.slug as event_slug, e.display_date
         from archive_mixes x
         left join members m on m.id = x.contributed_by
         left join archive_events e on e.id = x.archive_event_id and e.status = 'published'
        where x.status = 'published'
          and (x.scene_entity_id = $1
               or x.archive_event_id in (
                 select aee.archive_event_id from archive_event_entities aee
                   join archive_events ae on ae.id = aee.archive_event_id and ae.status = 'published'
                  where aee.entity_id = $1))
        order by x.published_at desc limit 12`,
      [entity.id]
    ),
  ]);

  const era = entity.active_from_year
    ? `${entity.active_from_year}–${entity.active_to_year ?? 'present'}`
    : null;

  return (
    <main className="wrap archiveWrap">
      <Link href="/archive" className="clubBack">← The Archive</Link>
      <div className="homeKicker" style={{ marginTop: 8 }}>
        {[entity.entity_type, entity.city, entity.country_name].filter(Boolean).join(' · ')}
      </div>
      <h1 className="archiveTitle">{entity.name}</h1>
      {era && <div className="archiveDate">{era}</div>}
      {genres.length > 0 && (
        <div className="archiveMeta">{genres.map((g) => g.name).join(' · ')}</div>
      )}
      <div className="iwtCount" style={{ marginTop: 10 }}>
        {memberCount > 0
          ? `${memberCount} Guestlist member${memberCount === 1 ? '' : 's'} went here`
          : 'Be the first to claim this place in your history'}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <AddToHistoryButton entityId={entity.id} added={myHistory} isSignedIn={!!member} />
        {member && (
          <Link href={`/archive/add?scene=${encodeURIComponent(entity.name)}`} className="btnGhost">
            {`+ Add a night at ${entity.name}`}
          </Link>
        )}
      </div>
      {entity.description && <p className="prose" style={{ marginTop: 14 }}>{entity.description}</p>}

      {lineage.length > 0 && (
        <div className="chipRow" style={{ marginTop: 10 }}>
          {lineage.map((l, i) => (
            <Link key={i} href={`/archive/clubs/${l.slug}`} className="chip">
              {l.relation.replace(/_/g, ' ')}: {l.name}
            </Link>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <div className="sectionLabel">Nights in the archive</div>
          {events.map((e) => (
            <div className="youHistoryRow" key={e.id}>
              <Link href={`/archive/events/${e.slug}`}>
                <strong>{e.title}</strong>
                <span className="youHistoryMeta"> {e.display_date}</span>
              </Link>
            </div>
          ))}
        </section>
      )}

      {flyers.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <div className="sectionLabel">Flyers</div>
          <div className="flyerGrid">
            {flyers.map((f) => (
              <Link key={f.id} href={`/archive/events/${f.slug}`} className="flyerCard">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.thumb_path ?? f.storage_path} alt={f.title} loading="lazy" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 20 }}>
        <div className="sectionLabel">The mixes</div>
        {mixes.length > 0 ? (
          <div className="mixGrid">
            {mixes.map((x) => <MixCard key={x.id} mix={x} />)}
          </div>
        ) : (
          <p className="youPanelSub" style={{ marginTop: 0 }}>
            {`No mixes from ${entity.name} yet — got one?`}
          </p>
        )}
        <div style={{ marginTop: 10 }}>
          <AddMixForm sceneEntityId={entity.id} label={`+ Add a ${entity.name} mix`} isSignedIn={!!member} />
        </div>
      </section>

      {people.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <div className="sectionLabel">People from this scene</div>
          <div className="peopleGrid">
            {people.map((p) => (
              <Link key={p.id} href={`/members/${p.slug}`} className="personCard">
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="personAvatar" src={p.avatar_url} alt="" />
                ) : (
                  <span className="personAvatar personAvatarFallback">{p.display_name[0]}</span>
                )}
                <span className="personCardBody">
                  <span className="personName">{p.display_name}</span>
                  {p.from_year && (
                    <span className="personReason">
                      {entity.name} · {p.from_year}{p.to_year && p.to_year !== p.from_year ? `–${p.to_year}` : ''}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {nowEvents.length > 0 && (
        <section className="archiveNow">
          <div className="dancedTitle">What they’re going to now</div>
          <div className="recGrid">
            {nowEvents.map((e) => (
              <Link key={e.id} href={`/events/${e.slug}?src=archive`} className="recCard recCardLink">
                <div className="recCardBody" style={{ padding: '12px 14px' }}>
                  <div className="recCardTitle">{e.title}</div>
                  <div className="recCardMeta">
                    {fmtEventDate(e.start_at, e.end_at, e.timezone)}{e.city && ` · ${e.city}`}
                  </div>
                  <div className="recReasons">
                    <span className="recReason">{`${e.n} from this scene going`}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
