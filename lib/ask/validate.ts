// CLAIM VALIDATOR — the deterministic gate between the AI and the user.
// V2G locked numbers; V2H also locks ENTITIES: the AI cannot introduce an
// unknown proper noun as fact. Anything unsupported → the whole commentary
// is rejected and the engine falls back to a deterministic template.

export type AskAllowlist = {
  names: Set<string>;    // lowercased entity names: events, artists, venues, promoters, cities, archive titles
  numbers: Set<string>;  // every permitted digit string (counts, years, prices, times)
};

export function buildAllowlist(input: {
  names: (string | null | undefined)[];
  numbers: (string | number | null | undefined)[];
}): AskAllowlist {
  const names = new Set<string>();
  for (const n of input.names) {
    if (!n) continue;
    names.add(n.toLowerCase());
    // Each word of a known name is also allowed (punctuation-stripped), so
    // "Corsica Studios" covers "Corsica" and "Test:" covers "Test".
    for (const raw of n.split(/\s+/)) {
      const w = raw.replace(/[^\w'&-]/g, '');
      if (w.length > 2) names.add(w.toLowerCase());
    }
  }
  const numbers = new Set<string>();
  for (let i = 0; i <= 12; i++) numbers.add(String(i)); // list ordinals stay natural
  for (const n of input.numbers) {
    if (n == null) continue;
    const s = String(n);
    numbers.add(s);
    numbers.add(s.replace(/\.\d+$/, '')); // "15.00" → "15"
    for (const part of s.split(/[:.\-]/)) if (part) numbers.add(part);
  }
  return { names, numbers };
}

// Common words that look like proper nouns at sentence starts / in titles.
const COMMON = new Set([
  'the', 'a', 'an', 'i', "i'd", "i'll", 'if', 'it', 'its', 'this', 'that', 'these', 'those',
  'there', 'nothing', 'no', 'not', 'none', 'one', 'two', 'three', 'both', 'want', 'looks',
  'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'tonight', 'today', 'tomorrow', 'weekend', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'going', 'jungle', 'house', 'techno', 'garage', 'disco', 'trance', 'hardcore', 'bass',
  'breaks', 'balearic', 'amapiano', 'afrobeats', 'dancehall', 'drum', 'and', 'or', 'with',
  'guestlist', 'archive', 'close', 'friends', 'friend', 'loosen', 'worth', 'daytime',
  'smaller', 'they', 'you', 'your', 'people', 'from', 'scene', 'strong', 'strongest',
  'for', 'but', 'try', 'also', 'still', 'more', 'most', 'both', 'picks', 'pick',
]);

export type ClaimValidation = { ok: true } | { ok: false; problems: string[] };

export function validateClaims(text: string, allow: AskAllowlist): ClaimValidation {
  const problems: string[] = [];

  // Numbers: every digit sequence must be evidenced (or a small ordinal).
  for (const m of text.matchAll(/\d[\d,.:]*\d|\d/g)) {
    const raw = m[0].replace(/[,.:]+$/, '');
    const variants = [raw, raw.replace(/,/g, ''), ...raw.split(/[:.]/)];
    if (!variants.some((v) => v && allow.numbers.has(v))) {
      problems.push(`unsupported number "${raw}"`);
    }
  }

  // Entities: any capitalised multi-word run (or distinctive single
  // capitalised word mid-sentence) must resolve to the evidence.
  const runs = text.matchAll(/\b([A-Z][\w'&-]*(?:\s+(?:of|the|at|&)?\s*[A-Z][\w'&-]*)*)\b/g);
  for (const m of runs) {
    const run = m[1];
    const words = run.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
    const meaningful = words.filter((w) => !COMMON.has(w.toLowerCase()));
    if (!meaningful.length) continue;
    const midSentence = m.index !== undefined && m.index > 0 && !/[.!?]\s*$/.test(text.slice(0, m.index).trimEnd()) && m.index !== 0;
    // Single capitalised word at a sentence start is prose, not a claim.
    if (meaningful.length === 1 && words.length === 1 && !midSentence) continue;
    const lower = run.toLowerCase();
    const known = allow.names.has(lower) || meaningful.every((w) => allow.names.has(w.toLowerCase()));
    if (!known) problems.push(`unsupported name "${run}"`);
  }

  return problems.length ? { ok: false, problems } : { ok: true };
}
