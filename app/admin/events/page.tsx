import Link from 'next/link';
import { query } from '@/lib/db';
import { ReviewCard, type AdminEventRow } from '@/components/admin/ReviewCard';

export const dynamic = 'force-dynamic';

const STATES = [
  { key: 'new', label: 'New' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'live', label: 'Live' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'past', label: 'Past' },
] as const;

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const sp = await searchParams;
  const state = STATES.some((s) => s.key === sp.state) ? sp.state! : 'new';

  // "Past" is derived (live + finished); the stored states exclude finished
  // events from LIVE so the working queues stay clean.
  const pastCond = `e.status = 'live' and coalesce(e.end_at, e.start_at + interval '6 hours') <= now()`;
  const cond =
    state === 'past'
      ? pastCond
      : state === 'live'
        ? `e.status = 'live' and coalesce(e.end_at, e.start_at + interval '6 hours') > now()`
        : `e.status = '${state}'`;

  const [events, counts] = await Promise.all([
    query<AdminEventRow>(
      `select e.id, e.title, e.slug, e.start_at, e.end_at, e.timezone, e.city, e.country,
              e.event_type, e.ticket_url, e.price_from, e.price_to, e.currency,
              e.primary_image_url, e.source_url, e.source_type, e.status,
              e.confidence_score, e.featured, e.possible_duplicate_of,
              v.name as venue_name, p.name as promoter_name,
              dup.title as duplicate_of_title, dup.slug as duplicate_of_slug,
              coalesce(gj.genres, '[]'::json) as genres,
              coalesce(lu.lineup, '[]'::json) as lineup
         from events e
         left join venues v on v.id = e.venue_id
         left join promoters p on p.id = e.promoter_id
         left join events dup on dup.id = e.possible_duplicate_of
         left join lateral (
           select json_agg(g.name order by g.sort_order) as genres
             from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = e.id
         ) gj on true
         left join lateral (
           select json_agg(a.name order by ea.position) as lineup
             from event_artists ea join artists a on a.id = ea.artist_id where ea.event_id = e.id
         ) lu on true
        where ${cond}
        order by e.created_at desc
        limit 200`
    ),
    query<{ status: string; n: number; past: number }>(
      `select e.status::text, count(*)::int as n,
              count(*) filter (where ${pastCond})::int as past
         from events e group by e.status`
    ),
  ]);

  const countFor = (key: string) => {
    if (key === 'past') return counts.find((c) => c.status === 'live')?.past ?? 0;
    const row = counts.find((c) => c.status === key);
    if (!row) return 0;
    return key === 'live' ? row.n - row.past : row.n;
  };

  return (
    <main>
      <h1 className="adminTitle">Events</h1>
      <p className="adminSub">
        Review incoming events, publish the good ones, keep the graph clean.
      </p>

      <div className="statePills">
        {STATES.map((s) => (
          <Link
            key={s.key}
            href={`/admin/events?state=${s.key}`}
            className={`statePill${state === s.key ? ' active' : ''}`}
          >
            {s.label}
            <span className="n">{countFor(s.key)}</span>
          </Link>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="adminSub">Nothing in this queue.</p>
      ) : (
        events.map((e) => <ReviewCard key={e.id} event={e} />)
      )}
    </main>
  );
}
