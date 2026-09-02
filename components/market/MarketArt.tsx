// Default artwork for a business with no photo: the category and the name's
// initials on the Market purple. An imperfect listing still looks meant.

const STOP = new Set(['the', 'a', 'an', 'of', 'and', '&']);

export function marketInitials(name: string): string {
  const words = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w && !STOP.has(w.toLowerCase()));
  const picked = (words.length ? words : name.split(/\s+/)).slice(0, 3).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return picked || name.slice(0, 2).toUpperCase();
}

export function MarketArt({ name, category, compact = false }: { name: string; category: string | null; compact?: boolean }) {
  return (
    <div className={`marketArt${compact ? ' compact' : ''}`} aria-hidden="true">
      <span className="marketArtCategory">{category ?? 'Independent'}</span>
      <span className="marketArtInitials">{marketInitials(name)}</span>
    </div>
  );
}
