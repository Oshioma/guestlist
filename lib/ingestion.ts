// URL ingestion service boundary.
//
// A member (or, later, an automated source monitor) hands us a URL; an
// extractor turns it into a structured draft event. V1 ships the service
// boundary and pipeline with a stub extractor — no scraping, no fabricated
// data. When a real extractor (fetch + AI classification) lands, it
// implements EventExtractor and everything downstream (dedupe, review
// queue, publishing rules) already works.

import { query, queryOne } from './db';
import { checkForDuplicate } from './dedupe';
import { normalizeTitle, slugify } from './util';

export interface ExtractedEvent {
  title: string | null;
  shortDescription?: string | null;
  description?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  timezone?: string | null;
  venueName?: string | null;
  city?: string | null;
  country?: string | null;
  lineup?: string[];
  promoterName?: string | null;
  genreSlugs?: string[];
  imageUrl?: string | null;
  ticketUrl?: string | null;
  priceFrom?: number | null;
  priceTo?: number | null;
  currency?: string | null;
  // 0–100; null when the extractor cannot judge. Drafts never go live
  // automatically below the publish threshold.
  confidence?: number | null;
}

export interface EventExtractor {
  name: string;
  extract(url: string): Promise<ExtractedEvent>;
}

// Confidence at or above this could allow auto-publish in future; the stub
// never reaches it, so every submission lands in the admin review queue.
export const AUTO_PUBLISH_CONFIDENCE = 90;

// V1 extractor: records what we genuinely know from the URL itself (the
// source), nothing more. Title/date/venue stay null — an admin completes
// the draft in review. No invented data, no fake confidence.
const stubExtractor: EventExtractor = {
  name: 'stub-v1',
  async extract(url: string): Promise<ExtractedEvent> {
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* invalid URL is handled by the caller */
    }
    return {
      title: host ? `Submitted event — ${host}` : null,
      ticketUrl: url,
      confidence: null,
    };
  },
};

let activeExtractor: EventExtractor = stubExtractor;

export function setExtractor(extractor: EventExtractor) {
  activeExtractor = extractor;
}

export type SubmissionResult =
  | { status: 'created'; submissionId: string; eventId: string }
  | { status: 'duplicate'; submissionId: string; existingEventId: string }
  | { status: 'invalid'; message: string };

export async function processUrlSubmission(
  url: string,
  submittedBy: string | null
): Promise<SubmissionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return { status: 'invalid', message: 'That doesn’t look like a valid link.' };
  }
  const cleanUrl = parsed.toString();

  const submission = await queryOne<{ id: string }>(
    `insert into event_submissions (url, submitted_by) values ($1, $2) returning id`,
    [cleanUrl, submittedBy]
  );
  const submissionId = submission!.id;

  // Same URL already submitted / imported → don't create another draft.
  const existing = await queryOne<{ id: string }>(
    `select id from events where source_url = $1 and status <> 'rejected' limit 1`,
    [cleanUrl]
  );
  if (existing) {
    await query(
      `update event_submissions
          set status = 'duplicate', event_id = $2, processed_at = now(),
              note = 'URL already known'
        where id = $1`,
      [submissionId, existing.id]
    );
    return { status: 'duplicate', submissionId, existingEventId: existing.id };
  }

  const extracted = await activeExtractor.extract(cleanUrl);
  const title = extracted.title ?? `Submitted event`;
  const startAt = extracted.startAt ?? null;

  // Dedupe on extracted details when the extractor produced any.
  let possibleDuplicateOf: string | null = null;
  if (startAt) {
    const dup = await checkForDuplicate({
      title,
      startAt,
      city: extracted.city,
      sourceUrl: cleanUrl,
    });
    if (dup.kind === 'exact_source') {
      await query(
        `update event_submissions
            set status = 'duplicate', event_id = $2, processed_at = now()
          where id = $1`,
        [submissionId, dup.eventId]
      );
      return { status: 'duplicate', submissionId, existingEventId: dup.eventId };
    }
    if (dup.kind === 'possible') possibleDuplicateOf = dup.eventId;
  }

  // Placeholder start date far enough out to be obviously unset; drafts are
  // never publicly visible until an admin completes and publishes them.
  const slugBase = slugify(title) || 'submitted-event';
  const event = await queryOne<{ id: string }>(
    `insert into events
       (title, slug, short_description, description, start_at, end_at, timezone,
        city, country, ticket_url, price_from, price_to, currency,
        primary_image_url, source_url, source_type, status,
        confidence_score, possible_duplicate_of, title_normalized, created_by)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, 'Europe/London'),
             $8, $9, $10, $11, $12, $13,
             $14, $15, 'member_submission', $16,
             $17, $18, $19, $20)
     returning id`,
    [
      title,
      `${slugBase}-${Math.random().toString(36).slice(2, 8)}`,
      extracted.shortDescription ?? null,
      extracted.description ?? null,
      startAt ?? new Date(Date.now() + 365 * 86400 * 1000),
      extracted.endAt ?? null,
      extracted.timezone ?? null,
      extracted.city ?? null,
      extracted.country ?? null,
      extracted.ticketUrl ?? cleanUrl,
      extracted.priceFrom ?? null,
      extracted.priceTo ?? null,
      extracted.currency ?? null,
      extracted.imageUrl ?? null,
      cleanUrl,
      possibleDuplicateOf ? 'needs_review' : 'new',
      extracted.confidence ?? null,
      possibleDuplicateOf,
      normalizeTitle(title),
      submittedBy,
    ]
  );

  await query(
    `update event_submissions
        set status = 'processed', event_id = $2, processed_at = now()
      where id = $1`,
    [submissionId, event!.id]
  );

  return { status: 'created', submissionId, eventId: event!.id };
}
