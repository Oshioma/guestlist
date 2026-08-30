// ADD TO THE ARCHIVE — member contributions.
//
// Flyer/photo upload (multipart): the member answers three light questions
// (what / roughly when / where); the system stores the media safely,
// attempts extraction, checks for an existing historical event, and queues
// everything for the Archive Desk. Members never auto-publish history.
// "Add an old event" (JSON) creates a pending event the same way.

import { NextRequest, NextResponse } from 'next/server';

// Uploads do real work (image variants, storage writes, extraction) — the
// serverless default of 10s is too tight for a large flyer.
export const maxDuration = 60;
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';
import { MediaError, storeArchiveImage } from '@/lib/archive/media';
import { defaultVisionClient, type ArchiveVisionClient } from '@/lib/archive/vision';
import {
  assessArchiveDuplicate, createArchiveEvent, hintsToInput, proposalToInput,
} from '@/lib/archive/core';

// Test hook: verify suites can inject a deterministic vision client via a
// header only honoured outside production.
function visionClient(req: NextRequest): ArchiveVisionClient {
  const fixture = req.headers.get('x-vision-fixture');
  if (fixture && process.env.NODE_ENV !== 'production') {
    try {
      const proposal = JSON.parse(fixture);
      return { extract: async () => ({ proposal }) };
    } catch {
      /* fall through to real client */
    }
  }
  return defaultVisionClient();
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const contentType = req.headers.get('content-type') ?? '';

    // ---- JSON path: "add an old event" (no media) -------------------------
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title.length < 2) return NextResponse.json({ error: 'Give the night a name' }, { status: 400 });
      const yearNum = Number(body.year);
      const created = await createArchiveEvent({
        title,
        description: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')
          ? { precision: 'exact', startDate: body.date }
          : Number.isInteger(yearNum) && yearNum >= 1950 && yearNum <= 2100
            ? (typeof body.circa === 'string' && body.circa.trim()
               ? { precision: 'circa', year: yearNum, displayDate: body.circa.trim() }
               : { precision: 'year', year: yearNum })
            : { precision: 'unknown' },
        venueName: typeof body.venue === 'string' ? body.venue : null,
        promoterName: typeof body.promoter === 'string' ? body.promoter : null,
        city: typeof body.city === 'string' ? body.city : null,
        country: typeof body.country === 'string' ? body.country : null,
        provenance: { all: 'MEMBER_SUGGESTION' },
        sourceAttribution: `Member contribution`,
        status: 'pending',
      }, member.id);
      if ('error' in created) return NextResponse.json({ error: created.error }, { status: 400 });
      await track('archive_contribution', { memberId: member.id, metadata: { kind: 'event', id: created.id } });
      return NextResponse.json({
        ok: true, archiveEventId: created.id,
        note: 'Thanks — the Guestlist team reviews every addition before it appears.',
      });
    }

    // ---- Multipart path: flyer/photo upload -------------------------------
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Image required' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await storeArchiveImage(buf); // validates + safe paths

    const hints = {
      what: String(form.get('what') ?? '').slice(0, 200) || null,
      when: String(form.get('when') ?? '').slice(0, 80) || null,
      where: String(form.get('where') ?? '').slice(0, 120) || null,
    };
    const itemType = ['flyer', 'photo', 'poster', 'ticket_stub', 'memorabilia'].includes(String(form.get('itemType')))
      ? String(form.get('itemType')) : 'flyer';
    const credit = form.get('credit') === 'true';

    const ingestion = await queryOne<{ id: string }>(
      `insert into archive_ingestions (kind, source_ref, created_by)
       values ('upload', $1, $2) returning id`,
      [`member-upload:${itemType}`, member.id]);

    // Extraction (one signal; without an API key the item simply waits for
    // admin with the member's hints attached).
    const vision = visionClient(req);
    const extraction = await vision.extract({
      imageBase64: buf.length < 4 * 1024 * 1024 ? buf.toString('base64') : null,
      imageMime: stored.mime,
      hints,
    });

    // A night is ALWAYS attached: from the extraction when available, and
    // from the member's own answers when not — public surfaces only show
    // items whose night is published, so an unattached item can never
    // become visible.
    let archiveEventId: string | null = null;
    let attachedToExisting = false;
    {
      const attribution = credit ? `Contributed by ${member.display_name}` : 'Member contribution';
      const input = extraction.proposal
        ? proposalToInput(extraction.proposal, hints, { sourceAttribution: attribution })
        : hintsToInput(hints, { sourceAttribution: attribution }, itemType);
      const dup = await assessArchiveDuplicate({
        title: input.title,
        year: input.date.year ?? (input.date.startDate ? Number(input.date.startDate.slice(0, 4)) : null),
        startDate: input.date.precision === 'exact' ? input.date.startDate : null,
        venueName: input.venueName,
        city: input.city,
        lineup: input.lineup,
      });
      if (dup.bucket === 'exact' || dup.bucket === 'likely') {
        // Same historical night: attach the new artefact, never a second event.
        archiveEventId = dup.matchId;
        attachedToExisting = true;
      } else {
        const created = await createArchiveEvent({ ...input, status: 'pending' }, member.id);
        if (!('error' in created)) archiveEventId = created.id;
      }
    }

    const item = await queryOne<{ id: string }>(
      `insert into archive_items
         (item_type, title, archive_event_id, contributed_by, credit_contributor,
          contributor_note, provenance, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'pending') returning id`,
      [itemType, hints.what, archiveEventId, member.id, credit,
       [hints.when, hints.where, String(form.get('notes') ?? '').slice(0, 500)].filter(Boolean).join(' · ') || null,
       JSON.stringify({ media: 'MEMBER_SUGGESTION', extraction: extraction.proposal ? 'AI_INFERENCE' : 'NONE' })]
    );
    await query(
      `insert into archive_media
         (item_id, kind, storage_path, display_path, thumb_path, mime, bytes, width, height,
          ocr_text, rights, rights_note)
       values ($1, 'front', $2, $3, $4, $5, $6, $7, $8, $9, 'contributor_granted', $10)`,
      [item!.id, stored.storagePath, stored.displayPath, stored.thumbPath, stored.mime,
       stored.bytes, stored.width, stored.height,
       extraction.proposal?.raw_text ?? null,
       credit ? `Contributed by ${member.display_name}` : 'Contributed by a Guestlist member']
    );
    await query(
      `update archive_ingestions set status = 'completed', completed_at = now(), stats = $2 where id = $1`,
      [ingestion!.id, JSON.stringify({
        extracted: !!extraction.proposal, attached_to_existing: attachedToExisting,
        archive_event_id: archiveEventId,
      })]);
    await track('archive_contribution', {
      memberId: member.id,
      metadata: { kind: itemType, item_id: item!.id, attached_to_existing: attachedToExisting },
    });
    return NextResponse.json({
      ok: true,
      itemId: item!.id,
      attachedToExisting,
      note: attachedToExisting
        ? 'We think this matches a night already in the archive — the team will confirm and attach it.'
        : 'Thanks — the Guestlist team reviews every addition before it appears.',
    });
  } catch (err) {
    if (err instanceof AuthError || err instanceof MediaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
