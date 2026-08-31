// A night in the archive: the artefacts, the lineup, who was there, the
// memories — and the road back into present-day Guestlist ("Still your
// sound?"). Attendance counts and lists respect per-member visibility.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import {
  currentEventsForArchive, visibleAttendanceCount, whoWasThere,
} from '@/lib/archive/core';
import { fmtEventDate } from '@/lib/util';
import { IWasThere } from '@/components/archive/IWasThere';
import { AddMixForm } from '@/components/archive/AddMixForm';
import { MixCard, type MixRow } from '@/components/archive/MixCard';
import { MemoryPanel } from '@/components/archive/MemoryPanel';
import { KnowMore } from '@/components/archive/KnowMore';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';

export const dynamic = 'force-dynamic';

export default async function ArchiveEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await getCurrentMember();

  const event = await queryOne<{
    id: string; title: string; description: string | null; display_date: string;
    date_precision: string; year: number | null; venue_name: string | null;
    promoter_name: string | null; city: string | null; country_name: string | null;
    price_note: string | null; source_url: string | null; source_attribution: string | null;
    original_language: string | null; status: string;
  }>(
    `select id, title, description, display_date, date_precision, year, venue_name,
            promoter_name, city, country_name, price_note, source_url, source_attribution,
            original_language, status
       from archive_events where slug = $1`,
    [slug]
  );
  if (!event || (event.status !== 'published' && member?.role !== 'admin')) notFound();

  const [media, lineup, genres, entities, attendance, attendees, memories, related, nowEvents, count, mixes] =
    await Promise.all([
      query<{ id: string; display_path: string | null; storage_path: string; thumb_path: string | null; kind: string; rights_note: string | null; hidden: boolean }>(
        `select m.id, m.display_path, m.storage_path, m.thumb_path, m.kind, m.rights_note, m.hidden
           from archive_media m
           join archive_items i on i.id = m.item_id and i.status = 'published'
          where i.archive_event_id = $1 and not m.hidden
          order by m.created_at limit 8`,
        [event.id]
      ),
      query<{ artist_name: string; slug: string | null }>(
        `select aa.artist_name, ar.slug from archive_event_artists aa
           left join artists ar on ar.id = aa.artist_id
          where aa.archive_event_id = $1 order by aa.position`,
        [event.id]
      ),
      query<{ name: string; slug: string }>(
        `select g.name, g.slug from archive_event_genres aeg
           join genres g on g.id = aeg.genre_id where aeg.archive_event_id = $1`,
        [event.id]
      ),
      query<{ id: string; name: string; slug: string | null; entity_type: string; role: string }>(
        `select se.id, se.name, se.slug, se.entity_type, aee.role
           from archive_event_entities aee join scene_entities se on se.id = aee.entity_id
          where aee.archive_event_id = $1`,
        [event.id]
      ),
      member
        ? queryOne<{ certainty: string; visibility: string }>(
            `select certainty, visibility from archive_attendance
              where member_id = $1 and archive_event_id = $2`,
            [member.id, event.id]
          )
        : Promise.resolve(null),
      whoWasThere(event.id, member?.id ?? null),
      query<{ id: string; body: string; display_name: string; member_id: string; created_at: string }>(
        `select mem.id, mem.body, m.display_name, mem.member_id, mem.created_at::text
           from archive_memories mem join members m on m.id = mem.member_id
          where mem.archive_event_id = $1 and mem.status = 'visible'
          order by mem.created_at limit 20`,
        [event.id]
      ),
      query<{ title: string; slug: string; display_date: string; city: string | null }>(
        `select distinct e2.title, e2.slug, e2.display_date, e2.city
           from archive_event_entities a1
           join archive_event_entities a2 on a2.entity_id = a1.entity_id
           join archive_events e2 on e2.id = a2.archive_event_id
          where a1.archive_event_id = $1 and e2.id <> $1 and e2.status = 'published'
          limit 6`,
        [event.id]
      ),
      currentEventsForArchive(event.id),
      visibleAttendanceCount(event.id, member?.id ?? null),
      query<MixRow>(
        `select x.id, x.title, x.artist_name, x.platform, x.url, x.credit_contributor,
                m.display_name as contributor
           from archive_mixes x
           left join members m on m.id = x.contributed_by
          where x.archive_event_id = $1 and x.status = 'published'
          order by x.published_at limit 12`,
        [event.id]
      ),
    ]);

  const flyer = media.find((m) => m.kind === 'front') ?? media[0];

  return (
    <main className="wrap archiveWrap">
      <ClubTrack type="archive_item_viewed" />
      <Link href="/archive" className="clubBack">← The Archive</Link>

      <div className="archiveEventGrid">
        <div>
          <div className="homeKicker">
            {[event.city, event.country_name].filter(Boolean).join(' · ') || 'The Archive'}
          </div>
          <h1 className="archiveTitle">{event.title}</h1>
          <div className="archiveDate">
            {event.display_date}
            {event.date_precision === 'circa' && <span className="archiveCirca"> (approximate)</span>}
          </div>
          {(event.venue_name || event.promoter_name) && (
            <div className="archiveMeta">
              {[event.venue_name, event.promoter_name].filter(Boolean).join(' · ')}
              {event.price_note && ` · ${event.price_note}`}
            </div>
          )}
          {genres.length > 0 && (
            <div className="tagRow" style={{ marginTop: 12 }}>
              {genres.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>
              ))}
            </div>
          )}

          <IWasThere
            archiveEventId={event.id}
            initialState={attendance ? { set: true, ...attendance } : null}
            initialCount={count}
            isSignedIn={!!member}
          />

          {lineup.length > 0 && (
            <>
              <div className="sectionLabel" style={{ marginTop: 20 }}>Lineup</div>
              <div className="lineupList">
                {lineup.map((a) => (
                  <div className="act" key={a.artist_name}>
                    {a.slug ? <Link href={`/artists/${a.slug}`}>{a.artist_name}</Link> : a.artist_name}
                  </div>
                ))}
              </div>
            </>
          )}

          {event.description && (
            <>
              <div className="sectionLabel" style={{ marginTop: 20 }}>The night</div>
              <p className="prose">{event.description}</p>
            </>
          )}
          {(event.source_attribution || event.source_url) && (
            <p className="archiveSource">
              Source: {event.source_attribution ?? 'external'}
              {event.source_url && (
                <> · <a href={event.source_url} target="_blank" rel="noopener noreferrer">original ↗</a></>
              )}
            </p>
          )}

          {entities.length > 0 && (
            <div className="chipRow" style={{ marginTop: 14 }}>
              {entities.map((e) => (
                <Link key={e.id} href={`/archive/clubs/${e.slug}`} className="chip">
                  {e.name}
                </Link>
              ))}
            </div>
          )}

          <KnowMore archiveEventId={event.id} isSignedIn={!!member} />
        </div>

        <aside>
          {flyer && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="archiveFlyer" src={flyer.display_path ?? flyer.storage_path} alt={`${event.title} flyer`} />
          )}
          {flyer?.rights_note && <div className="archiveRights">{flyer.rights_note}</div>}
          {media.length > 1 && (
            <div className="archiveThumbRow">
              {media.slice(1).map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.id} src={m.thumb_path ?? m.storage_path} alt="" />
              ))}
            </div>
          )}
        </aside>
      </div>

      {attendees.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="sectionLabel">Who was there</div>
          <div className="peopleGrid">
            {attendees.map((a) => (
              <Link key={a.id} href={`/members/${a.slug}`} className="personCard">
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="personAvatar" src={a.avatar_url} alt="" />
                ) : (
                  <span className="personAvatar personAvatarFallback">{a.display_name[0]}</span>
                )}
                <span className="personCardBody">
                  <span className="personName">
                    {a.display_name}
                    {a.is_connection && <span className="friendMark"> ✦</span>}
                  </span>
                  <span className="personReason">
                    {a.certainty === 'unsure' ? 'Thinks they were there' : 'Was there'}
                    {a.shared_scene && ' · You may have crossed paths'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <div className="sectionLabel">The mixes</div>
        {mixes.length > 0 && (
          <div className="mixGrid">
            {mixes.map((x) => <MixCard key={x.id} mix={x} canDelete={member?.role === 'admin'} />)}
          </div>
        )}
        {mixes.length === 0 && (
          <p className="youPanelSub" style={{ marginTop: 0 }}>
            No mixes from this night yet — got one?
          </p>
        )}
        <div style={{ marginTop: 10 }}>
          <AddMixForm archiveEventId={event.id} isSignedIn={!!member} />
        </div>
      </section>

      <MemoryPanel
        archiveEventId={event.id}
        memories={memories}
        meId={member?.id ?? null}
        isSignedIn={!!member}
      />

      {related.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="sectionLabel">From this scene</div>
          <div className="chipRow">
            {related.map((r) => (
              <Link key={r.slug} href={`/archive/events/${r.slug}`} className="chip">
                {r.title} · {r.display_date}
              </Link>
            ))}
          </div>
        </section>
      )}

      {nowEvents.length > 0 && (
        <section className="archiveNow">
          <div className="dancedTitle">Still your sound?</div>
          <div className="recGrid">
            {nowEvents.map((e) => (
              <Link key={e.id} href={`/events/${e.slug}?src=archive`} className="recCard recCardLink">
                <div className="recCardBody" style={{ padding: '12px 14px' }}>
                  <div className="recCardTitle">{e.title}</div>
                  <div className="recCardMeta">
                    {fmtEventDate(e.start_at, e.end_at, e.timezone)}
                    {e.city && ` · ${e.city}`}
                  </div>
                  <div className="recReasons"><span className="recReason">{e.reason}</span></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
