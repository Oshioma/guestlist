import { query } from './db';

export type AnalyticsEventType =
  | 'event_viewed'
  | 'event_saved'
  | 'event_unsaved'
  | 'interested'
  | 'going'
  | 'rsvp_cleared'
  | 'ticket_clicked'
  | 'event_shared'
  | 'promoter_viewed'
  | 'genre_selected'
  | 'location_selected'
  | 'event_submitted';

export async function track(
  type: AnalyticsEventType,
  opts: {
    memberId?: string | null;
    anonId?: string | null;
    eventId?: string | null;
    promoterId?: string | null;
    genreId?: string | null;
    path?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await query(
      `insert into analytics_events
         (event_type, member_id, anon_id, event_id, promoter_id, genre_id, path, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        type,
        opts.memberId ?? null,
        opts.anonId ?? null,
        opts.eventId ?? null,
        opts.promoterId ?? null,
        opts.genreId ?? null,
        opts.path ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ]
    );
  } catch (err) {
    // Analytics must never break a user-facing flow.
    console.error('analytics track failed', err);
  }
}
