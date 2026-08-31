// The Archive Desk API: publish / edit / merge / link / reject / research,
// media rights + takedown, corrections, memory moderation, bulk import.
// Publishing an item linked to an event notifies its attendees (in-app,
// preference-gated) via the V2D notification centre.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { createArchiveEvent, hintsToInput, mergeArchiveEvents } from '@/lib/archive/core';
import { runBulkImport } from '@/lib/archive/bulk';
import { resolveArchiveDate } from '@/lib/archive/dates';

async function notifyAttendees(archiveEventId: string, message: string) {
  await query(
    `insert into notifications (member_id, type, archive_event_id, payload)
     select a.member_id, 'archive_activity', $1, $2
       from archive_attendance a
       join member_email_prefs p on p.member_id = a.member_id and p.archive_updates
      where a.archive_event_id = $1
        and not exists (select 1 from notifications n
                         where n.member_id = a.member_id and n.type = 'archive_activity'
                           and n.archive_event_id = $1
                           and n.created_at > now() - interval '3 days')`,
    [archiveEventId, JSON.stringify({ message })]
  );
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'publish_event' || action === 'reject_event' || action === 'needs_research') {
      const status = action === 'publish_event' ? 'published'
        : action === 'reject_event' ? 'rejected' : 'needs_research';
      const row = await queryOne<{ id: string }>(
        `update archive_events set status = $2,
                published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end
          where id = $1 returning id`,
        [String(body.eventId ?? ''), status]);
      if (!row) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      if (status === 'published') {
        // Items already attached publish alongside their event.
        await query(
          `update archive_items set status = 'published', published_at = coalesce(published_at, now())
            where archive_event_id = $1 and status = 'pending'`, [row.id]);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'publish_item' || action === 'reject_item') {
      const row = await queryOne<{
        id: string; archive_event_id: string | null; item_type: string;
        title: string | null; contributor_note: string | null; contributed_by: string | null;
      }>(
        `update archive_items set
            status = $2, published_at = case when $2 = 'published' then now() end
          where id = $1 returning id, archive_event_id, item_type, title, contributor_note, contributed_by`,
        [String(body.itemId ?? ''), action === 'publish_item' ? 'published' : 'rejected']);
      if (!row) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (action === 'publish_item') {
        // A published item is only visible when its night is published too
        // — so publishing an item drags its night along, creating one from
        // the contribution when nothing was ever attached.
        let eventId = row.archive_event_id;
        if (!eventId) {
          const created = await createArchiveEvent(
            hintsToInput(
              { what: row.title, when: row.contributor_note, where: null },
              { sourceAttribution: 'Member contribution' },
              row.item_type),
            row.contributed_by ?? admin.id);
          if (!('error' in created)) {
            eventId = created.id;
            await query(`update archive_items set archive_event_id = $2 where id = $1`, [row.id, eventId]);
          }
        }
        if (eventId) {
          await query(
            `update archive_events set status = 'published', published_at = coalesce(published_at, now())
              where id = $1 and status in ('pending', 'needs_review', 'needs_research')`, [eventId]);
          await notifyAttendees(eventId, 'New material was added to a night you were at');
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'publish_mix' || action === 'reject_mix') {
      const row = await queryOne<{ id: string; archive_event_id: string | null }>(
        `update archive_mixes set status = $2,
                published_at = case when $2 = 'published' then coalesce(published_at, now()) end
          where id = $1 returning id, archive_event_id`,
        [String(body.mixId ?? ''), action === 'publish_mix' ? 'published' : 'rejected']);
      if (!row) return NextResponse.json({ error: 'Mix not found' }, { status: 404 });
      if (action === 'publish_mix' && row.archive_event_id) {
        await notifyAttendees(row.archive_event_id, 'A mix from a night you were at is now playable');
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_mix') {
      // Hard removal — for mixes that shouldn't exist at all (wrong link,
      // rights problem). Rejection keeps the row; delete does not.
      const row = await queryOne<{ id: string }>(
        `delete from archive_mixes where id = $1 returning id`,
        [String(body.mixId ?? '')]);
      if (!row) return NextResponse.json({ error: 'Mix not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'merge_events') {
      const keep = String(body.keepId ?? '');
      const dup = String(body.dupId ?? '');
      if (!keep || !dup || keep === dup) return NextResponse.json({ error: 'Invalid merge' }, { status: 400 });
      const both = await query(`select id from archive_events where id in ($1, $2)`, [keep, dup]);
      if (both.length !== 2) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      await mergeArchiveEvents(keep, dup);
      return NextResponse.json({ ok: true });
    }

    if (action === 'edit_event') {
      const eventId = String(body.eventId ?? '');
      const patch = body.patch ?? {};
      const sets: string[] = [];
      const args: unknown[] = [eventId];
      const add = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = $${args.length}`); };
      if (typeof patch.title === 'string' && patch.title.trim()) add('title', patch.title.trim());
      if (typeof patch.venueName === 'string') add('venue_name', patch.venueName.trim() || null);
      if (typeof patch.promoterName === 'string') add('promoter_name', patch.promoterName.trim() || null);
      if (typeof patch.description === 'string') add('description', patch.description.trim() || null);
      if (typeof patch.sourceAttribution === 'string') add('source_attribution', patch.sourceAttribution.trim() || null);
      if (patch.date) {
        const date = resolveArchiveDate(patch.date);
        if ('error' in date) return NextResponse.json({ error: date.error }, { status: 400 });
        add('date_precision', date.precision);
        add('start_date', date.start_date);
        add('end_date', date.end_date);
        add('year', date.year);
        add('display_date', date.display_date);
      }
      if (!sets.length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
      // Every admin edit is provenance-tagged.
      args.push(JSON.stringify(Object.fromEntries(
        Object.keys(patch).map((k) => [k, 'ADMIN']))));
      sets.push(`provenance = provenance || $${args.length}`);
      const row = await queryOne(
        `update archive_events set ${sets.join(', ')} where id = $1 returning id`, args);
      if (!row) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'link_entity') {
      const row = await queryOne(
        `insert into archive_event_entities (archive_event_id, entity_id, role)
         select $1, se.id, coalesce($3, case when se.entity_type in ('club','venue') then 'venue'
                                             when se.entity_type = 'promoter' then 'promoter'
                                             else se.entity_type end)
           from scene_entities se where se.id = $2
         on conflict do nothing returning archive_event_id`,
        [String(body.eventId ?? ''), String(body.entityId ?? ''),
         typeof body.role === 'string' ? body.role : null]);
      return NextResponse.json({ ok: !!row });
    }

    if (action === 'link_entities_lineage') {
      const relation = ['renamed_to', 'became', 'moved_to', 'merged_into', 'successor_of', 'related']
        .includes(body.relation) ? body.relation : 'related';
      await query(
        `insert into scene_entity_links (from_entity, to_entity, relation, note, created_by)
         values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [String(body.fromEntity ?? ''), String(body.toEntity ?? ''), relation,
         typeof body.note === 'string' ? body.note.slice(0, 300) : null, admin.id]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'set_media_rights' || action === 'hide_media' || action === 'show_media') {
      const mediaId = String(body.mediaId ?? '');
      if (action !== 'set_media_rights') {
        const row = await queryOne(
          `update archive_media set hidden = $2 where id = $1 returning id`,
          [mediaId, action === 'hide_media']);
        return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const rights = ['unknown', 'guestlist_owned', 'contributor_granted', 'licensed',
        'external_reference', 'restricted'].includes(body.rights) ? body.rights : 'unknown';
      const row = await queryOne(
        `update archive_media set rights = $2, rights_note = $3 where id = $1 returning id`,
        [mediaId, rights, typeof body.note === 'string' ? body.note.slice(0, 300) : null]);
      return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (action === 'resolve_correction') {
      const row = await queryOne(
        `update archive_corrections set status = $2, resolved_by = $3, resolved_at = now()
          where id = $1 and status = 'open' returning id`,
        [String(body.correctionId ?? ''), body.applied === true ? 'applied' : 'rejected', admin.id]);
      return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (action === 'remove_memory' || action === 'restore_memory') {
      const row = await queryOne(
        `update archive_memories set status = $2, removed_by = $3 where id = $1 returning id`,
        [String(body.memoryId ?? ''), action === 'remove_memory' ? 'removed' : 'visible',
         action === 'remove_memory' ? admin.id : null]);
      return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (action === 'bulk_import') {
      const format = body.format === 'csv' ? 'csv' : 'json';
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) return NextResponse.json({ error: 'Nothing to import' }, { status: 400 });
      const report = await runBulkImport(text, format, {
        dryRun: body.dryRun !== false, // DRY RUN unless explicitly disabled
        sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : 'admin-bulk',
        adminId: admin.id,
      });
      if ('error' in report) return NextResponse.json({ error: report.error }, { status: 400 });
      return NextResponse.json({ ok: true, report });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
