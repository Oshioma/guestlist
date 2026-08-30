import { notFound } from 'next/navigation';
import { query, queryOne } from '@/lib/db';
import { EventForm, type EventFormValues } from '@/components/admin/EventForm';

export const dynamic = 'force-dynamic';

// Render a timestamptz as a datetime-local value in the event's timezone.
function toLocalInput(iso: string | null, timezone: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await queryOne<{
    id: string; title: string; short_description: string | null; description: string | null;
    start_at: string; end_at: string | null; timezone: string; venue_id: string | null;
    promoter_id: string | null; city: string | null; country: string | null;
    event_type: string; ticket_url: string | null; price_from: string | null;
    price_to: string | null; currency: string | null; primary_image_url: string | null;
    source_url: string | null; worth_travelling: boolean; featured: boolean; status: string;
    genre_slugs: string[]; lineup: string[];
  }>(
    `select e.*, coalesce(gs.slugs, '{}') as genre_slugs, coalesce(lu.names, '{}') as lineup
       from events e
       left join lateral (
         select array_agg(g.slug) as slugs
           from event_genres eg join genres g on g.id = eg.genre_id where eg.event_id = e.id
       ) gs on true
       left join lateral (
         select array_agg(a.name order by ea.position) as names
           from event_artists ea join artists a on a.id = ea.artist_id where ea.event_id = e.id
       ) lu on true
      where e.id = $1`,
    [id]
  );
  if (!event) notFound();

  const [genres, venues, promoters] = await Promise.all([
    query<{ slug: string; name: string; parent_name: string | null }>(
      `select g.slug, g.name, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.sort_order`
    ),
    query<{ id: string; name: string }>(`select id, name from venues order by name`),
    query<{ id: string; name: string }>(`select id, name from promoters order by name`),
  ]);

  // NOTE: datetime-local values are interpreted server-side as being in the
  // event's timezone when saved (the form submits an ISO string built from
  // the browser's locale) — acceptable for V1 admin tooling.
  const initial: EventFormValues = {
    id: event.id,
    title: event.title,
    shortDescription: event.short_description ?? '',
    description: event.description ?? '',
    startAt: toLocalInput(event.start_at, event.timezone),
    endAt: toLocalInput(event.end_at, event.timezone),
    timezone: event.timezone,
    venueId: event.venue_id ?? '',
    promoterId: event.promoter_id ?? '',
    city: event.city ?? '',
    country: event.country ?? '',
    eventType: event.event_type,
    ticketUrl: event.ticket_url ?? '',
    priceFrom: event.price_from ?? '',
    priceTo: event.price_to ?? '',
    currency: event.currency ?? '',
    primaryImageUrl: event.primary_image_url ?? '',
    sourceUrl: event.source_url ?? '',
    worthTravelling: event.worth_travelling,
    featured: event.featured,
    status: event.status,
    genreSlugs: event.genre_slugs,
    lineup: event.lineup.join('\n'),
  };

  return (
    <main>
      <h1 className="adminTitle">Edit event</h1>
      <EventForm initial={initial} genres={genres} venues={venues} promoters={promoters} />
    </main>
  );
}
