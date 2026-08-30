// ADMIN → EVENTS → GENRE SUGGESTIONS: unknown genre terms proposed by the
// classifier, grouped by term, resolved by an explicit admin decision.

import Link from 'next/link';
import { query } from '@/lib/db';
import { GenreSuggestionRow } from '@/components/admin/GenreSuggestionRow';

export const dynamic = 'force-dynamic';

export default async function GenreSuggestionsPage() {
  const [groups, genres] = await Promise.all([
    query<{
      term: string; occurrences: number; avg_confidence: string | null;
      events: { title: string; slug: string | null }[];
    }>(
      `select lower(gs.suggested_name) as term,
              count(*)::int as occurrences,
              round(avg(gs.confidence), 0)::text as avg_confidence,
              coalesce(json_agg(distinct jsonb_build_object('title', e.title, 'slug', e.slug))
                       filter (where e.id is not null), '[]'::json) as events
         from genre_suggestions gs
         left join events e on e.id = gs.event_id
        where gs.status = 'pending'
        group by lower(gs.suggested_name)
        order by occurrences desc, term`
    ),
    query<{ slug: string; name: string; parent_name: string | null }>(
      `select g.slug, g.name, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.sort_order`
    ),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Genre suggestions</h1>
      <p className="adminSub">
        Terms the classifier couldn’t map to the taxonomy. Map them to an
        existing genre, dismiss them, or — as an explicit decision — create a
        new genre. AI never creates genres on its own.
      </p>

      {groups.length === 0 ? (
        <p className="adminSub">Nothing pending. <Link href="/admin/supply" style={{ textDecoration: 'underline' }}>Supply log →</Link></p>
      ) : (
        groups.map((g) => (
          <GenreSuggestionRow
            key={g.term}
            term={g.term}
            occurrences={g.occurrences}
            avgConfidence={g.avg_confidence}
            events={g.events}
            genres={genres}
          />
        ))
      )}
    </main>
  );
}
