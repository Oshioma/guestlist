'use client';

// Multi-select genre chips shared by the source forms. Parent genres are
// listed first (the page query orders parents before subgenres).

export type GenreOpt = { id: string; name: string; slug: string; parent_genre_id: string | null };

export function GenrePicker({
  genres, selected, onChange, wrap = false,
}: {
  genres: GenreOpt[];
  selected: string[];
  onChange: (ids: string[]) => void;
  // Where the genres ARE the query — the discovery search — they all have to
  // be on screen; a hidden horizontal scroll would bury half the taxonomy.
  wrap?: boolean;
}) {
  const chosen = new Set(selected);
  return (
    <div
      className="chipRow"
      style={wrap
        ? { flexWrap: 'wrap', overflowX: 'visible', padding: '2px 0' }
        : { maxHeight: 132, overflowY: 'auto', padding: '2px 0' }}
    >
      {genres.map((g) => (
        <button
          key={g.id}
          type="button"
          className={`chip${chosen.has(g.id) ? ' active' : ''}`}
          style={g.parent_genre_id ? { fontSize: 11 } : { fontWeight: 600 }}
          onClick={() => {
            const next = new Set(chosen);
            if (next.has(g.id)) next.delete(g.id);
            else next.add(g.id);
            onChange([...next]);
          }}
        >
          {g.name}
        </button>
      ))}
    </div>
  );
}
