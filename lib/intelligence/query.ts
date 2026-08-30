// queryGuestlist — the grounded question-answering boundary that Ask
// @guestlist (V2H) and the concierge (V2J) will build on. A structured
// request in, REAL events + a fact pack out. No AI in this layer at all.

import { query } from '../db';
import { weekendWindow } from '../recommend';
import { buildEvidencePack } from './evidence';
import type { EvidencePack } from './types';

export type GuestlistQuery = {
  city?: string | null;
  date?: 'tonight' | 'weekend' | string | null; // ISO date also accepted
  genre?: string | null;        // matched against genre names + slugs (incl. subgenres)
  lateNight?: boolean;          // starts 23:00+ local
  daytime?: boolean;            // starts before 18:00 local
  limit?: number;
};

export type GuestlistQueryResult = {
  matched: number;
  eventIds: string[];
  evidence: EvidencePack;
};

export async function queryGuestlist(q: GuestlistQuery): Promise<GuestlistQueryResult> {
  const limit = Math.min(q.limit ?? 5, 10);
  let from = new Date();
  let to = new Date(Date.now() + 14 * 86400_000);
  if (q.date === 'tonight') {
    to = new Date(Date.now() + 24 * 3600_000);
  } else if (q.date === 'weekend') {
    ({ from, to } = weekendWindow());
  } else if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
    from = new Date(`${q.date}T00:00:00Z`);
    to = new Date(`${q.date}T23:59:59Z`);
  }

  const rows = await query<{ id: string }>(
    `select distinct e.id, e.start_at
       from events e
       left join event_genres eg on eg.event_id = e.id
       left join genres g on g.id = eg.genre_id
      where e.status = 'live' and e.listing_status <> 'cancelled'
        and coalesce(e.end_at, e.start_at + interval '6 hours') > now()
        and e.start_at between $1 and $2
        and ($3::text is null or lower(e.city) = lower($3))
        and ($4::text is null or exists (
              select 1 from event_genres eg2 join genres g2 on g2.id = eg2.genre_id
               where eg2.event_id = e.id
                 and (lower(g2.name) = lower($4) or g2.slug = lower($4)
                      or exists (select 1 from genres parent
                                  where parent.id = g2.parent_genre_id
                                    and (lower(parent.name) = lower($4) or parent.slug = lower($4))))))
        and ($5::boolean is not true or extract(hour from e.start_at at time zone e.timezone) >= 23
             or extract(hour from e.start_at at time zone e.timezone) < 5)
        and ($6::boolean is not true or extract(hour from e.start_at at time zone e.timezone) between 8 and 17)
      order by e.start_at
      limit $7`,
    [from, to, q.city ?? null, q.genre ?? null, q.lateNight ?? null, q.daytime ?? null, limit]
  );
  const eventIds = rows.map((r) => r.id);
  const evidence = await buildEvidencePack({
    eventIds,
    aggregates: {
      query_city: q.city ?? null, query_date: q.date ?? null,
      query_genre: q.genre ?? null, matched: eventIds.length,
    },
  });
  return { matched: eventIds.length, eventIds, evidence };
}
