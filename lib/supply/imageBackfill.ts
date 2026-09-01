// FILLING IN THE MISSING FLYERS.
//
// Improving the extractor only helps events we have not imported yet. The
// ones already sitting in the review queue with an empty tile need somebody to
// go back and look at their page again — which is all this does: fetch the
// event's own source page and read the artwork off it.
//
// It only ever fills a BLANK. An image an admin chose, or one an earlier scan
// found, is never overwritten by a guess made later.

import { query, queryOne } from '@/lib/db';
import { safeFetch } from './safeFetch';
import { findPageImages, type FoundImage } from './images';
import { supplyConfig } from './config';

export type ImageBackfillResult =
  | { ok: true; url: string; source: FoundImage['source']; why: string; alternatives: string[] }
  | { ok: false; reason: 'no_source_url' | 'already_has_image' | 'fetch_failed' | 'no_image_found'; detail?: string };

const SCANNER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9';

export async function findImageForEvent(
  eventId: string,
  opts: { replace?: boolean } = {}
): Promise<ImageBackfillResult> {
  const event = await queryOne<{ source_url: string | null; canonical_url: string | null; primary_image_url: string | null }>(
    `select source_url, canonical_url, primary_image_url from events where id = $1`,
    [eventId]
  );
  if (!event) return { ok: false, reason: 'no_source_url' };
  if (event.primary_image_url && !opts.replace) return { ok: false, reason: 'already_has_image' };

  const target = event.source_url ?? event.canonical_url;
  if (!target) return { ok: false, reason: 'no_source_url' };

  const fetched = await safeFetch(target, { accept: SCANNER_ACCEPT });
  if (!fetched.ok) {
    return { ok: false, reason: 'fetch_failed', detail: fetched.detail ?? fetched.code ?? String(fetched.status ?? '') };
  }

  const candidates = findPageImages(fetched.body, fetched.finalUrl);
  const best = candidates[0];
  if (!best) return { ok: false, reason: 'no_image_found' };

  await query(
    `update events set primary_image_url = $2, updated_at = now() where id = $1`,
    [eventId, best.url]
  );
  await query(
    `insert into event_images (event_id, url, sort_order)
     select $1, $2, 0 where not exists (select 1 from event_images where event_id = $1 and url = $2)`,
    [eventId, best.url]
  );
  return {
    ok: true,
    url: best.url,
    source: best.source,
    why: best.why,
    alternatives: candidates.slice(1, 5).map((c) => c.url),
  };
}

export type BulkImageResult = { looked: number; found: number; remaining: number };

// Events in one review queue that have no picture. Capped per press: each one
// is a real fetch of somebody else's website, and the delay between fetches is
// the same courtesy the scanner shows.
export const IMAGE_BACKFILL_LIMIT = 25;

export async function findImagesForQueue(
  state: 'new' | 'needs_review' | 'live',
  limit = IMAGE_BACKFILL_LIMIT
): Promise<BulkImageResult> {
  const missing = await query<{ id: string }>(
    `select id from events
      where status = $1::event_status
        and primary_image_url is null
        and coalesce(source_url, canonical_url) is not null
        and coalesce(end_at, start_at + interval '6 hours') > now()
      order by created_at desc`,
    [state]
  );
  const batch = missing.slice(0, limit);
  let found = 0;
  for (const [i, e] of batch.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
    const result = await findImageForEvent(e.id);
    if (result.ok) found++;
  }
  return { looked: batch.length, found, remaining: missing.length - batch.length };
}
