import { notFound } from 'next/navigation';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { PromoterEventForm, type PromoterEventValues } from '@/components/promoter/PromoterEventForm';
import { roleAtLeast } from '@/lib/promoterAuth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

function toLocalInput(iso: string | null, timezone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export default async function EditPromoterEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const [{ eventId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/events">{null}</DashShell>;
  }
  if (!roleAtLeast(ctx.active.role, 'editor')) {
    return (
      <DashShell ctx={ctx} tab="/events">
        <p className="adminSub">Your role can’t edit events — ask a team admin.</p>
      </DashShell>
    );
  }

  // Ownership check happens here for the page and again in the API.
  const event = await queryOne<{
    id: string; title: string; short_description: string | null; description: string | null;
    start_at: string; end_at: string | null; timezone: string; venue_id: string | null;
    city: string | null; country: string | null; event_type: string; ticket_url: string | null;
    price_from: string | null; price_to: string | null; currency: string | null;
    primary_image_url: string | null;
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
      where e.id = $1 and e.promoter_id = $2`,
    [eventId, ctx.active.id]
  );
  if (!event) notFound();

  const [genres, venues] = await Promise.all([
    query<{ slug: string; name: string; parent_name: string | null }>(
      `select g.slug, g.name, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.sort_order`
    ),
    query<{ id: string; name: string }>(`select id, name from venues order by name`),
  ]);

  const initial: PromoterEventValues = {
    id: event.id,
    title: event.title,
    shortDescription: event.short_description ?? '',
    description: event.description ?? '',
    startAt: toLocalInput(event.start_at, event.timezone),
    endAt: toLocalInput(event.end_at, event.timezone),
    timezone: event.timezone,
    venueId: event.venue_id ?? '',
    city: event.city ?? '',
    country: event.country ?? '',
    eventType: event.event_type,
    ticketUrl: event.ticket_url ?? '',
    priceFrom: event.price_from ?? '',
    priceTo: event.price_to ?? '',
    currency: event.currency ?? '',
    primaryImageUrl: event.primary_image_url ?? '',
    genreSlugs: event.genre_slugs,
    lineup: event.lineup.join('\n'),
  };

  return (
    <DashShell ctx={ctx} tab="/events">
      <div className="sectionLabel">Edit event</div>
      <PromoterEventForm promoterId={ctx.active.id} initial={initial} genres={genres} venues={venues} />
    </DashShell>
  );
}
