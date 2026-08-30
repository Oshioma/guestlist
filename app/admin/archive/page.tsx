// ADMIN → ARCHIVE DESK: review queue with provenance + duplicate context,
// member submissions, corrections, memories under report, health metrics,
// bulk import.

import { query } from '@/lib/db';
import {
  ArchiveEventActions, ArchiveItemActions, BulkImportPanel,
  CorrectionActions, MediaRightsControl, MemoryModAction,
} from '@/components/admin/ArchiveDesk';

export const dynamic = 'force-dynamic';

export default async function AdminArchivePage() {
  const [pendingEvents, pendingItems, corrections, reportedMemories, health] = await Promise.all([
    query<{
      id: string; title: string; display_date: string; date_precision: string;
      venue_name: string | null; promoter_name: string | null; city: string | null;
      country_name: string | null; confidence: number | null; provenance: Record<string, string>;
      source_attribution: string | null; status: string; possible_duplicate_of: string | null;
      dup_title: string | null; lineup: string[]; genres: string[]; entities: string[];
      contributor: string | null; thumb: string | null;
    }>(
      `select e.id, e.title, e.display_date, e.date_precision, e.venue_name, e.promoter_name,
              e.city, e.country_name, e.confidence, e.provenance, e.source_attribution,
              e.status, e.possible_duplicate_of, d.title as dup_title,
              coalesce((select array_agg(artist_name order by position)
                          from archive_event_artists where archive_event_id = e.id), '{}') as lineup,
              coalesce((select array_agg(g.name) from archive_event_genres aeg
                          join genres g on g.id = aeg.genre_id
                         where aeg.archive_event_id = e.id), '{}') as genres,
              coalesce((select array_agg(se.name) from archive_event_entities aee
                          join scene_entities se on se.id = aee.entity_id
                         where aee.archive_event_id = e.id), '{}') as entities,
              cm.display_name as contributor,
              (select m.thumb_path from archive_media m
                 join archive_items i on i.id = m.item_id
                where i.archive_event_id = e.id limit 1) as thumb
         from archive_events e
         left join archive_events d on d.id = e.possible_duplicate_of
         left join members cm on cm.id = e.created_by
        where e.status in ('pending', 'needs_review', 'needs_research')
        order by e.created_at limit 40`
    ),
    query<{
      id: string; item_type: string; title: string | null; contributor: string | null;
      contributor_note: string | null; event_title: string | null; event_status: string | null;
      media_id: string | null; thumb: string | null; rights: string | null; hidden: boolean | null;
      ocr: string | null;
    }>(
      `select i.id, i.item_type, i.title, m2.display_name as contributor, i.contributor_note,
              e.title as event_title, e.status as event_status,
              m.id as media_id, coalesce(m.thumb_path, m.storage_path) as thumb,
              m.rights, m.hidden, left(m.ocr_text, 200) as ocr
         from archive_items i
         left join members m2 on m2.id = i.contributed_by
         left join archive_events e on e.id = i.archive_event_id
         left join archive_media m on m.item_id = i.id
        where i.status = 'pending'
        order by i.created_at limit 40`
    ),
    query<{ id: string; field: string; suggestion: string; member: string; event_title: string; created_at: string }>(
      `select c.id, c.field, c.suggestion, m.display_name as member, e.title as event_title, c.created_at::text
         from archive_corrections c
         join members m on m.id = c.member_id
         join archive_events e on e.id = c.archive_event_id
        where c.status = 'open' order by c.created_at limit 30`
    ),
    query<{ id: string; body: string; member: string; event_title: string; report_count: number }>(
      `select mem.id, mem.body, m.display_name as member, e.title as event_title, mem.report_count
         from archive_memories mem
         join members m on m.id = mem.member_id
         join archive_events e on e.id = mem.archive_event_id
        where mem.status = 'visible' and mem.report_count > 0
        order by mem.report_count desc limit 20`
    ),
    query<{ k: string; n: number }>(
      `select 'published events' as k, count(*)::int as n from archive_events where status = 'published'
       union all select 'pending review', count(*)::int from archive_events where status in ('pending','needs_review','needs_research')
       union all select 'unresolved duplicates', count(*)::int from archive_events where possible_duplicate_of is not null and status <> 'rejected'
       union all select 'uncertain dates', count(*)::int from archive_events where status = 'published' and date_precision in ('circa','year','unknown')
       union all select 'unmatched venues', count(*)::int from archive_events where status = 'published' and venue_name is not null
         and not exists (select 1 from archive_event_entities aee where aee.archive_event_id = archive_events.id)
       union all select 'published items', count(*)::int from archive_items where status = 'published'
       union all select 'I Was There marks', count(*)::int from archive_attendance
       union all select 'contributing members', count(distinct contributed_by)::int from archive_items where contributed_by is not null
       union all select 'memories', count(*)::int from archive_memories where status = 'visible'`
    ),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Archive Desk</h1>
      <p className="adminSub">
        {health.map((h) => `${h.n} ${h.k}`).join(' · ')}
      </p>

      <BulkImportPanel />

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>{`Needs review (${pendingEvents.length})`}</h2>
      {pendingEvents.length === 0 && <p className="adminSub">Queue clear.</p>}
      {pendingEvents.map((e) => (
        <div className="adminRow" key={e.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {e.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.thumb} alt="" style={{ width: 72, borderRadius: 8 }} />
          )}
          <div style={{ flex: 1, minWidth: 260 }}>
            <strong>{e.title}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {e.display_date} ({e.date_precision})
              {e.venue_name && ` · ${e.venue_name}`}
              {e.promoter_name && ` · ${e.promoter_name}`}
              {e.city && ` · ${e.city}${e.country_name ? `, ${e.country_name}` : ''}`}
            </span>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
              {e.lineup.length > 0 && <>Lineup: {e.lineup.slice(0, 6).join(', ')}{e.lineup.length > 6 && '…'} · </>}
              {e.genres.length > 0 && <>Genres: {e.genres.join(', ')} · </>}
              {e.entities.length > 0 && <>Entities: {e.entities.join(', ')} · </>}
              {e.confidence != null && <>Confidence {e.confidence} · </>}
              Provenance: {Object.entries(e.provenance ?? {}).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}
              {e.source_attribution && ` · Source: ${e.source_attribution}`}
              {e.contributor && ` · By ${e.contributor}`}
            </div>
            {e.dup_title && (
              <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 4 }}>
                Possible duplicate of “{e.dup_title}”
              </div>
            )}
          </div>
          <ArchiveEventActions eventId={e.id} duplicateOf={e.possible_duplicate_of} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>{`Member submissions (${pendingItems.length})`}</h2>
      {pendingItems.length === 0 && <p className="adminSub">Nothing waiting.</p>}
      {pendingItems.map((i) => (
        <div className="adminRow" key={i.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {i.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.thumb} alt="" style={{ width: 72, borderRadius: 8, opacity: i.hidden ? 0.3 : 1 }} />
          )}
          <div style={{ flex: 1, minWidth: 260 }}>
            <strong>{i.title ?? i.item_type}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {i.item_type}
              {i.contributor && ` · from ${i.contributor}`}
              {i.contributor_note && ` · “${i.contributor_note}”`}
              {i.event_title && ` · matched: ${i.event_title} (${i.event_status})`}
            </span>
            {i.ocr && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                Extracted: {i.ocr}…
              </div>
            )}
            {i.media_id && (
              <div style={{ marginTop: 6 }}>
                <MediaRightsControl mediaId={i.media_id} rights={i.rights ?? 'unknown'} hidden={!!i.hidden} />
              </div>
            )}
          </div>
          <ArchiveItemActions itemId={i.id} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>{`Corrections (${corrections.length})`}</h2>
      {corrections.length === 0 && <p className="adminSub">No open corrections.</p>}
      {corrections.map((c) => (
        <div className="adminRow" key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <strong>{c.event_title}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.field} · {c.member}</span>
            <div style={{ fontSize: 13, marginTop: 3 }}>“{c.suggestion}”</div>
          </div>
          <CorrectionActions correctionId={c.id} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>{`Reported memories (${reportedMemories.length})`}</h2>
      {reportedMemories.length === 0 && <p className="adminSub">Nothing reported.</p>}
      {reportedMemories.map((m) => (
        <div className="adminRow" key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            “{m.body}” <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              — {m.member} on {m.event_title} · {m.report_count} report{m.report_count === 1 ? '' : 's'}
            </span>
          </div>
          <MemoryModAction memoryId={m.id} />
        </div>
      ))}
    </main>
  );
}
