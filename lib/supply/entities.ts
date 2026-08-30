// Conservative entity matching: reuse existing venues/promoters/artists when
// confidence is high, create (with a review warning) when uncertain, and
// never aggressively merge.

import { query, queryOne } from '@/lib/db';
import { slugify } from '@/lib/util';

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|club|nightclub)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Motion Bristol" and "Motion, Bristol" normalise to "motion" when the city
// is known and appears as a trailing token.
function stripTrailingCity(normName: string, city: string | null): string {
  if (!city) return normName;
  const normCity = normalizeEntityName(city);
  if (normCity && normName.endsWith(' ' + normCity)) {
    return normName.slice(0, -normCity.length - 1).trim();
  }
  return normName;
}

async function uniqueSlugFor(table: 'venues' | 'promoters' | 'artists', name: string): Promise<string> {
  const base = slugify(name) || table.slice(0, -1);
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const clash = await queryOne(`select 1 from ${table} where slug = $1`, [candidate]);
    if (!clash) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export type EntityMatch = {
  id: string;
  created: boolean;
  matchKind: 'exact' | 'normalized' | 'created';
  warning: string | null;
};

export async function matchOrCreateVenue(input: {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
}): Promise<EntityMatch> {
  const candidates = await query<{
    id: string; name: string; city: string | null; country: string | null;
  }>(`select id, name, city, country from venues`);

  const inputNorm = stripTrailingCity(normalizeEntityName(input.name), input.city);
  const inputCity = input.city?.trim().toLowerCase() ?? null;

  let normalizedHit: typeof candidates[number] | null = null;
  for (const v of candidates) {
    const vNorm = stripTrailingCity(normalizeEntityName(v.name), v.city);
    if (vNorm !== inputNorm || !vNorm) continue;
    const vCity = v.city?.trim().toLowerCase() ?? null;
    if (inputCity && vCity && inputCity === vCity) {
      // Same normalised name + same city → confident reuse.
      return { id: v.id, created: false, matchKind: 'exact', warning: null };
    }
    if (!inputCity || !vCity) normalizedHit = v;
  }

  if (normalizedHit) {
    // Name matches but city unconfirmed on one side: reuse, but tell the
    // moderator to double-check rather than silently splitting the venue.
    return {
      id: normalizedHit.id,
      created: false,
      matchKind: 'normalized',
      warning: `Venue matched by name only ("${normalizedHit.name}") — confirm city`,
    };
  }

  const slug = await uniqueSlugFor('venues', input.name);
  const row = await queryOne<{ id: string }>(
    `insert into venues (name, slug, address, city, country) values ($1,$2,$3,$4,$5) returning id`,
    [input.name.trim(), slug, input.address, input.city, input.country]
  );
  return { id: row!.id, created: true, matchKind: 'created', warning: null };
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export async function matchOrCreatePromoter(input: {
  name: string;
  website: string | null;
}): Promise<EntityMatch> {
  const inputDomain = domainOf(input.website);
  if (inputDomain) {
    const byDomain = await queryOne<{ id: string }>(
      `select id from promoters where website ilike '%' || $1 || '%' limit 1`,
      [inputDomain]
    );
    if (byDomain) return { id: byDomain.id, created: false, matchKind: 'exact', warning: null };
  }

  const candidates = await query<{ id: string; name: string }>(`select id, name from promoters`);
  const inputNorm = normalizeEntityName(input.name);
  const hit = candidates.find((p) => normalizeEntityName(p.name) === inputNorm && inputNorm);
  if (hit) return { id: hit.id, created: false, matchKind: 'normalized', warning: null };

  const slug = await uniqueSlugFor('promoters', input.name);
  const row = await queryOne<{ id: string }>(
    `insert into promoters (name, slug, website) values ($1,$2,$3) returning id`,
    [input.name.trim(), slug, input.website]
  );
  return { id: row!.id, created: true, matchKind: 'created', warning: null };
}

export async function matchOrCreateArtist(name: string): Promise<EntityMatch> {
  const trimmed = name.trim();
  // Case/punctuation-insensitive reuse only; anything fuzzier stays separate
  // (two artists with similar names are not the same artist).
  const inputNorm = normalizeEntityName(trimmed);
  const hit = await queryOne<{ id: string }>(
    `select id from artists
      where lower(regexp_replace(name, '[^a-zA-Z0-9 ]', ' ', 'g')) =
            lower(regexp_replace($1, '[^a-zA-Z0-9 ]', ' ', 'g'))
      limit 1`,
    [trimmed]
  );
  if (hit && inputNorm) return { id: hit.id, created: false, matchKind: 'normalized', warning: null };

  const slug = await uniqueSlugFor('artists', trimmed);
  const row = await queryOne<{ id: string }>(
    `insert into artists (name, slug) values ($1,$2) returning id`,
    [trimmed, slug]
  );
  return { id: row!.id, created: true, matchKind: 'created', warning: null };
}
