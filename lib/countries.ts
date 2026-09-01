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

// ISO 3166-1 alpha-2 codes. Scraped pages and feeds sometimes give the code
// where a country name belongs, and /explore falls back to a location's
// country_code when it has no country_name — so a bare "IT" was reaching the
// screen as its own country. Two letters is never a country's real name.
const ISO_CODES: Record<string, string> = {
  gb: 'United Kingdom', ie: 'Ireland', fr: 'France', de: 'Germany', it: 'Italy',
  es: 'Spain', pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', lu: 'Luxembourg',
  ch: 'Switzerland', at: 'Austria', cz: 'Czechia', pl: 'Poland', hu: 'Hungary',
  ro: 'Romania', bg: 'Bulgaria', gr: 'Greece', hr: 'Croatia', si: 'Slovenia',
  sk: 'Slovakia', rs: 'Serbia', me: 'Montenegro', al: 'Albania', mt: 'Malta',
  cy: 'Cyprus', se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland',
  is: 'Iceland', ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania', ua: 'Ukraine',
  tr: 'Turkey', il: 'Israel', ae: 'United Arab Emirates', sa: 'Saudi Arabia',
  eg: 'Egypt', ma: 'Morocco', tn: 'Tunisia', za: 'South Africa', ng: 'Nigeria',
  gh: 'Ghana', ke: 'Kenya', tz: 'Tanzania', ug: 'Uganda', sn: 'Senegal',
  ci: "Côte d'Ivoire", us: 'United States', ca: 'Canada', mx: 'Mexico',
  br: 'Brazil', ar: 'Argentina', cl: 'Chile', co: 'Colombia', pe: 'Peru',
  uy: 'Uruguay', au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  cn: 'China', hk: 'Hong Kong', tw: 'Taiwan', sg: 'Singapore', th: 'Thailand',
  vn: 'Vietnam', id: 'Indonesia', my: 'Malaysia', ph: 'Philippines', in: 'India',
  jm: 'Jamaica', tt: 'Trinidad and Tobago', bb: 'Barbados', cu: 'Cuba', do: 'Dominican Republic',
};

export function canonicalCountry(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const alias = ALIASES[lower] ?? ISO_CODES[lower];
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

// The SQL form of the same maps, for migrations and one-off cleanups.
export const COUNTRY_ALIAS_SQL_PAIRS: [string, string][] =
  [...Object.entries(ALIASES), ...Object.entries(ISO_CODES)].map(([from, to]) => [from, to]);

// A country's own page lives at /netherlands, /united-kingdom, /cote-d-ivoire.
// Diacritics and apostrophes are folded out so the URL is typeable.
export function countrySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
