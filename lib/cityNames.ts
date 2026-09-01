// ONE CITY, ONE SPELLING.
//
// City names are typed by people — into the signup box, into their profile,
// into an event form — and they arrive as "dar es salaam", "LONDON",
// "Dar es salaam". On a page of members that reads as carelessness, and it is
// the kind of carelessness people notice before they notice anything else.
//
// This is a casing pass, not a gazetteer. It never changes which city is
// meant, and it never invents a spelling: a name we have no rule for comes
// back tidied, not corrected.

// Words that stay lowercase inside a name, in the languages our cities are
// actually in. First word is always capitalised regardless — "De Pijp" is a
// place, "es" alone is not.
const SMALL = new Set([
  // Arabic / Swahili
  'es', 'el', 'al', 'ad', 'ar', 'as', 'bin', 'ibn',
  // Romance
  'de', 'del', 'della', 'di', 'da', 'das', 'dos', 'do', 'la', 'le', 'les',
  'lo', 'los', 'las', 'du', 'des', 'e', 'y',
  // Dutch / German / Scandinavian
  'van', 'von', 'der', 'den', 'ter', 'te', 'op', 'aan', 'auf', 'am', 'an',
  'bei', 'im', 'ob', 'zu', 'zur',
  // English
  'of', 'the', 'on', 'upon', 'in', 'under', 'by', 'and', 'at',
  // French
  'sur', 'sous', 'lès', 'aux',
]);

// Names no general rule gets right. Every entry is the SAME place spelled
// differently — never a nickname resolved to a city, because deciding that
// "LA" means Los Angeles and not somewhere else is guessing about where
// somebody lives, and this file does not guess.
const ALIASES: Record<string, string> = {
  'dar es salaam': 'Dar es Salaam',
  'dar-es-salaam': 'Dar es Salaam',
  'daressalaam': 'Dar es Salaam',
  'dar es-salaam': 'Dar es Salaam',
  "n'djamena": "N'Djamena",
  "s-hertogenbosch": "'s-Hertogenbosch",
  "'s-hertogenbosch": "'s-Hertogenbosch",
  'sao paulo': 'São Paulo',
  'são paulo': 'São Paulo',
  'san jose': 'San José',
  'malmo': 'Malmö',
  'zurich': 'Zürich',
  'dusseldorf': 'Düsseldorf',
  'koln': 'Köln',
  'goteborg': 'Göteborg',
  'medellin': 'Medellín',
  'bogota': 'Bogotá',
  'brasilia': 'Brasília',
  'reykjavik': 'Reykjavík',
  'nimes': 'Nîmes',
  'orleans': 'Orléans',
  'quebec city': 'Québec City',
};

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const capitalise = (word: string): string => {
  if (!word) return word;
  // Hyphens keep their small words small — "Stoke-on-Trent", not
  // "Stoke-On-Trent". Apostrophes never do: the letter after one is part of
  // the name, so "o'fallon" is "O'Fallon".
  return word
    .split('-')
    .map((part, i) => {
      const lower = part.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.split("'").map(upperFirst).join("'");
    })
    .join('-');
};

export function canonicalCity(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  // A name that already carries unusual capitals inside a word — McCarthy,
  // DeSoto, O'Connor — was written deliberately. Tidying it would be us
  // being wrong about somebody's home town.
  const hasInnerCapital = /[a-z][A-Z]/.test(trimmed);
  if (hasInnerCapital) return trimmed;

  return trimmed
    .split(' ')
    .map((word, i) => (i > 0 && SMALL.has(word.toLowerCase()) ? word.toLowerCase() : capitalise(word)))
    .join(' ');
}

// True when a stored name is already the shape we would write it in. Used by
// the cleanup migration's counterpart in tests, and anywhere we want to know
// whether a value needs touching before we touch it.
export function isCanonicalCity(raw: string | null | undefined): boolean {
  if (!raw) return true;
  return canonicalCity(raw) === raw.trim().replace(/\s+/g, ' ');
}
