// Map AI genre proposals onto the controlled V1 taxonomy. AI never creates
// genres: unmapped proposals become genre_suggestions for admin review.

import { query } from '@/lib/db';

export type GenreRow = { id: string; name: string; slug: string; parent_genre_id: string | null };

// Aliases → taxonomy slug. Lowercased, punctuation-stripped keys.
const GENRE_ALIASES: Record<string, string> = {
  'dnb': 'drum-and-bass', 'd n b': 'drum-and-bass', 'drum n bass': 'drum-and-bass',
  'drum and bass': 'drum-and-bass', 'drumandbass': 'drum-and-bass', 'dandb': 'drum-and-bass',
  'jungle dnb': 'jungle', 'junglist': 'jungle',
  'liquid funk': 'liquid', 'liquid dnb': 'liquid', 'liquid drum and bass': 'liquid',
  'jump up dnb': 'jump-up', 'jumpup': 'jump-up',
  'neuro': 'neurofunk',
  'ukg': 'uk-garage', 'uk garage': 'uk-garage', 'garage house': 'garage',
  '2 step': '2-step', 'two step': '2-step', 'speed garage': 'speed-garage',
  'tech house': 'house', 'afro house': 'house', 'organic house': 'deep-house',
  'deep house': 'deep-house', 'vocal house': 'vocal-house', 'classic house': 'classic-house',
  'funky house': 'funky-house', 'progressive house': 'progressive-house',
  'piano house': 'classic-house', 'soulful house': 'vocal-house',
  'melodic techno': 'melodic-techno', 'hard techno': 'hard-techno',
  'industrial techno': 'hard-techno', 'minimal techno': 'techno', 'minimal': 'techno',
  'acid techno': 'techno', 'acid': 'techno',
  'nu disco': 'disco', 'nu-disco': 'disco', 'italo disco': 'disco', 'italo': 'disco',
  'boogie': 'disco', 'funk': 'disco', 'funk and soul': 'disco',
  'psytrance': 'trance', 'psy trance': 'trance', 'goa': 'trance', 'hard trance': 'trance',
  'uplifting trance': 'trance', 'progressive trance': 'trance',
  'happy hardcore': 'hardcore', 'gabber': 'hardcore', 'uk hardcore': 'hardcore',
  'rave': 'hardcore', 'old skool': 'old-school-jungle', 'old school': 'old-school-jungle',
  'oldskool jungle': 'old-school-jungle', 'ragga': 'ragga-jungle', 'ragga jungle': 'ragga-jungle',
  'dub': 'reggae-and-dub', 'reggae': 'reggae-and-dub', 'roots': 'reggae-and-dub',
  'dub reggae': 'reggae-and-dub', 'steppers': 'reggae-and-dub', 'dancehall': 'reggae-and-dub',
  'ska': 'reggae-and-dub', 'sound system': 'reggae-and-dub', 'soundsystem': 'reggae-and-dub',
  'dubstep': 'bass', '140': 'bass', 'bass music': 'bass', 'bassline': 'bass',
  'grime': 'bass', 'uk bass': 'bass', 'future bass': 'bass',
  'breakbeat': 'breaks', 'breakbeats': 'breaks', 'big beat': 'breaks', 'electro breaks': 'breaks',
  'nu skool breaks': 'breaks',
  'balearic beat': 'balearic', 'chill out': 'balearic', 'chillout': 'balearic',
  'downtempo': 'balearic', 'ambient': 'balearic', 'sunset': 'balearic',
  'electro': 'techno', 'ebm': 'techno',
  'electronic': '', 'electronica': '', 'dance': '', 'edm': '', 'dj set': '', 'club': '',
};

export function normalizeGenreName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type GenreMapping = {
  matched: { genre: GenreRow; confidence: number }[];
  unknown: { name: string; confidence: number }[];
};

export async function loadGenres(): Promise<GenreRow[]> {
  return query<GenreRow>(
    `select id, name, slug, parent_genre_id from genres where active order by sort_order`
  );
}

export function mapGenreProposals(
  proposals: { name: string; confidence: number }[],
  taxonomy: GenreRow[]
): GenreMapping {
  const bySlug = new Map(taxonomy.map((g) => [g.slug, g]));
  const byNorm = new Map(taxonomy.map((g) => [normalizeGenreName(g.name), g]));

  const matched = new Map<string, { genre: GenreRow; confidence: number }>();
  const unknown: { name: string; confidence: number }[] = [];

  for (const p of proposals) {
    const norm = normalizeGenreName(p.name);
    if (!norm) continue;

    let genre: GenreRow | undefined =
      byNorm.get(norm) ?? bySlug.get(norm.replace(/\s+/g, '-'));
    if (!genre && norm in GENRE_ALIASES) {
      const slug = GENRE_ALIASES[norm];
      if (slug === '') continue; // deliberately ignored (too generic: "electronic")
      genre = bySlug.get(slug);
    }
    // "liquid funk drum and bass" style compounds: try each known token group.
    if (!genre) {
      for (const [alias, slug] of Object.entries(GENRE_ALIASES)) {
        if (slug && norm.includes(alias)) {
          genre = bySlug.get(slug);
          if (genre) break;
        }
      }
    }

    if (genre) {
      const prev = matched.get(genre.id);
      if (!prev || prev.confidence < p.confidence) {
        matched.set(genre.id, { genre, confidence: p.confidence });
      }
      // A matched subgenre implies its parent, at slightly lower confidence.
      if (genre.parent_genre_id) {
        const parent = taxonomy.find((g) => g.id === genre!.parent_genre_id);
        if (parent && !matched.has(parent.id)) {
          matched.set(parent.id, { genre: parent, confidence: Math.max(1, p.confidence - 5) });
        }
      }
    } else {
      unknown.push({ name: p.name.trim().slice(0, 80), confidence: p.confidence });
    }
  }

  return { matched: [...matched.values()], unknown };
}
