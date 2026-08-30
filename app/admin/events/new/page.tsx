import { query } from '@/lib/db';
import { EventForm, EMPTY_EVENT } from '@/components/admin/EventForm';

export const dynamic = 'force-dynamic';

export default async function NewEventPage() {
  const [genres, venues, promoters] = await Promise.all([
    query<{ slug: string; name: string; parent_name: string | null }>(
      `select g.slug, g.name, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.sort_order`
    ),
    query<{ id: string; name: string }>(`select id, name from venues order by name`),
    query<{ id: string; name: string }>(`select id, name from promoters order by name`),
  ]);

  return (
    <main>
      <h1 className="adminTitle">New event</h1>
      <EventForm initial={EMPTY_EVENT} genres={genres} venues={venues} promoters={promoters} />
    </main>
  );
}
