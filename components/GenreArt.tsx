// Default artwork when an event has no image but known genres: a genre in
// big white letters on the house gradient — "D&B" beats an empty box.

const ABBREV: Record<string, string> = {
  'drum & bass': 'D&B',
  'drum and bass': 'D&B',
  'reggae & dub': 'DUB',
  'latin electronic': 'LATIN',
};

// The best label across the event's genres: a known abbreviation first
// (D&B), then the shortest name that fits whole (JUNGLE beats the first
// word of "Old School Jungle"), then the first word as a last resort.
export function pickGenreLabel(genres: string[]): string | null {
  const clean = genres.map((g) => g.trim()).filter(Boolean);
  if (!clean.length) return null;
  const mapped = clean.map((g) => ABBREV[g.toLowerCase()]).find(Boolean);
  if (mapped) return mapped;
  const fits = clean.filter((g) => g.length <= 12).sort((a, b) => a.length - b.length)[0];
  if (fits) return fits.toUpperCase();
  return clean[0].split(/\s+/)[0].slice(0, 12).toUpperCase();
}

export function GenreArt({ genres, compact = false }: { genres: string[]; compact?: boolean }) {
  const label = pickGenreLabel(genres);
  if (!label) return null;
  const base = label.length <= 4 ? 46 : label.length <= 7 ? 36 : 26;
  return (
    <div className="genreArt" style={{ fontSize: compact ? base * 0.7 : base }}>
      {label}
    </div>
  );
}
