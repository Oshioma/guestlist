// One country, one name.
//
// Country text arrives from three directions — event pages we scrape, admins
// typing into forms, and members choosing a home country — so the same place
// turns up as "UK", "England", "U.S.", "USA". Left alone that splits a
// country across several headings on /explore and several sections on the
// sources page, and makes a network look smaller and messier than it is.
//
// This is display-and-storage normalisation, not geography: England is folded
// into the United Kingdom because that is the country a listing means when it
// says it, and the alternative is two headings for one place.

const ALIASES: Record<string, string> = {
  // United Kingdom
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  gb: 'United Kingdom',
  gbr: 'United Kingdom',
  britain: 'United Kingdom',
  'great britain': 'United Kingdom',
  england: 'United Kingdom',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'united kingdom of great britain and northern ireland': 'United Kingdom',

  // United States
  us: 'United States',
  'u.s.': 'United States',
  usa: 'United States',
  'u.s.a.': 'United States',
  america: 'United States',
  'united states of america': 'United States',

  // A few more that show up in listings with more than one spelling.
  holland: 'Netherlands',
  'the netherlands': 'Netherlands',
  nl: 'Netherlands',
  deutschland: 'Germany',
  de: 'Germany',
  italia: 'Italy',
  espana: 'Spain',
  'españa': 'Spain',
  es: 'Spain',
  fr: 'France',
  ie: 'Ireland',
  'republic of ireland': 'Ireland',
  'czech republic': 'Czechia',
  'south africa (rsa)': 'South Africa',
  'united republic of tanzania': 'Tanzania',

  // Names whose correct casing no general rule gets right — an apostrophe or
  // a lowercase particle in the middle. The list of countries is finite, so
  // naming them is more honest than a clever algorithm that still slips.
  "cote d'ivoire": "Côte d'Ivoire",
  "côte d'ivoire": "Côte d'Ivoire",
  'ivory coast': "Côte d'Ivoire",
  'guinea-bissau': 'Guinea-Bissau',
  'timor-leste': 'Timor-Leste',
  'papua new guinea': 'Papua New Guinea',
  'trinidad and tobago': 'Trinidad and Tobago',
  'bosnia and herzegovina': 'Bosnia and Herzegovina',
  'dr congo': 'Democratic Republic of the Congo',
  'drc': 'Democratic Republic of the Congo',
  uae: 'United Arab Emirates',
};

export function canonicalCountry(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  // Not an alias: keep what was written, but with a consistent shape so
  // "united kingdom" and "United Kingdom" do not become two countries.
  // Title case with the REST of each word lowercased, so "ITALY", "italy"
  // and "Italy" are one country rather than three.
  return trimmed
    .split(' ')
    .map((word, i) =>
      i > 0 && /^(and|of|the|de|du|la|le|el)$/i.test(word)
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(' ');
}

// The SQL form of the same map, for migrations and one-off cleanups.
export const COUNTRY_ALIAS_SQL_PAIRS: [string, string][] =
  Object.entries(ALIASES).map(([from, to]) => [from, to]);
