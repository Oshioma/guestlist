// INTENT + CONSTRAINT EXTRACTION — deterministic first. Cities and genres
// come from the canonical tables (longest match wins, same approach as the
// V2G mention classifier), time words carry small multilingual sets so the
// parser is not architected English-only. An AI parse can refine this
// later; facts never depend on it.

import { query } from '../db';
import type { AskDate, AskIntent } from './types';

const TONIGHT_WORDS = ['tonight', 'esta noche', 'ce soir', 'heute abend', 'stasera', 'hoje à noite'];
const TOMORROW_WORDS = ['tomorrow', 'mañana', 'demain', 'morgen', 'domani'];
const WEEKEND_WORDS = ['this weekend', 'weekend', 'fin de semana', 'ce week-end', 'wochenende', 'fim de semana'];
const NEXT_WEEKEND_WORDS = ['next weekend', 'próximo fin de semana'];
const NEXT_MONTH_WORDS = ['next month', 'próximo mes', 'le mois prochain'];
const DOW: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, sábado: 6, samedi: 6, dimanche: 0, samstag: 6, sonntag: 0,
};

const SMALL_WORDS = ['smaller', 'small', 'intimate', 'not massive', 'no massive', 'somewhere small', 'tiny', 'basement'];
const BIG_WORDS = ['big room', 'massive', 'festival', 'huge'];
const CHEAP_WORDS = ['cheap', 'barato', 'pas cher'];
const FREE_WORDS = ['free entry', 'for free', ' free'];
const DAYTIME_WORDS = ['daytime', 'day party', 'afternoon', 'day time', 'de día'];
const MOMENTUM_WORDS = ['heating up', 'picking up', 'blowing up', 'getting attention', 'buzzing', 'momentum', 'suddenly'];
const TRAVEL_WORTH_WORDS = ['worth travelling', 'worth traveling', 'worth the trip', 'worth a trip'];
const SURPRISE_WORDS = ['surprise me', 'what should i actually do', 'anything for me', 'you pick'];
const OLD_SCHOOL_WORDS = ['old-school', 'old school', 'oldskool', 'old skool'];
const CLOSE_FRIEND_WORDS = ['close friends', 'close friend', "people i'm close to", 'people im close to'];
const CONNECTION_WORDS = ['my friends', 'my people', 'my connections', 'friends going', 'anyone i know'];
const SCENE_WORDS = ['my old scene', 'my scene', 'people from my scene', 'old crowd'];
const PAST_PRESENT_WORDS = ['feels like', 'like the nights', 'like nights i went', 'reminds me of', 'takes me back'];
const ARCHIVE_WORDS = ['was happening', 'used to', 'back in', 'what happened at', 'old nights', 'show me old'];

function has(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function parseDate(text: string): AskDate | null {
  if (has(text, NEXT_WEEKEND_WORDS)) return { kind: 'next_weekend' };
  if (has(text, TONIGHT_WORDS) || /\btoday\b/.test(text)) return { kind: 'tonight' };
  if (has(text, TOMORROW_WORDS)) return { kind: 'tomorrow' };
  if (has(text, WEEKEND_WORDS)) return { kind: 'weekend' };
  if (has(text, NEXT_MONTH_WORDS)) return { kind: 'next_month' };
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return { kind: 'iso', date: iso[1] };
  for (const [name, dow] of Object.entries(DOW)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return { kind: 'day', dow };
  }
  return null;
}

// Longest-name-first matching against canonical tables. Cached briefly —
// these lists change rarely and every Ask hits them.
let placeCache: { at: number; rows: { name: string; lower: string }[] } | null = null;
let genreCache: { at: number; rows: { name: string; slug: string; lower: string }[] } | null = null;

async function knownCities(): Promise<{ name: string; lower: string }[]> {
  if (placeCache && Date.now() - placeCache.at < 5 * 60_000) return placeCache.rows;
  const rows = await query<{ name: string }>(
    `select distinct name from (
       select name from locations where kind in ('city', 'destination')
       union select city from events where city is not null
     ) c(name) where name is not null`);
  placeCache = {
    at: Date.now(),
    rows: rows.map((r) => ({ name: r.name, lower: r.name.toLowerCase() }))
      .sort((a, b) => b.lower.length - a.lower.length),
  };
  return placeCache.rows;
}

async function knownGenres(): Promise<{ name: string; slug: string; lower: string }[]> {
  if (genreCache && Date.now() - genreCache.at < 5 * 60_000) return genreCache.rows;
  const rows = await query<{ name: string; slug: string }>(
    `select name, slug from genres where active`);
  genreCache = {
    at: Date.now(),
    rows: rows.map((r) => ({ ...r, lower: r.name.toLowerCase() }))
      .sort((a, b) => b.lower.length - a.lower.length),
  };
  return genreCache.rows;
}

export function invalidateIntentCaches() {
  placeCache = null;
  genreCache = null;
}

export async function parseAskQuestion(raw: string): Promise<AskIntent> {
  // Curly quotes read the same as straight ones ("I’m close to").
  const text = ` ${raw.toLowerCase().replace(/[’‘]/g, "'").trim()} `;

  const cities = await knownCities();
  let city: string | null = null;
  let travelCity: string | null = null;
  for (const c of cities) {
    if (new RegExp(`\\b${c.lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      // "I'm in Ibiza" reads as travel context AND the target city.
      city = c.name;
      if (/\b(i'?m in|i am in|while i'?m|visiting|going to be in)\b/.test(text)) travelCity = c.name;
      break;
    }
  }

  const genres: string[] = [];
  for (const g of await knownGenres()) {
    if (new RegExp(`\\b${g.lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
        || text.includes(` ${g.slug} `)) {
      genres.push(g.name);
      if (genres.length >= 3) break;
    }
  }
  // "d&b" / "dnb" / "drum and bass" shorthand for the canonical name.
  if (!genres.some((g) => /drum & bass/i.test(g)) && /\b(d&b|dnb|drum and bass)\b/.test(text)) {
    const dnb = (await knownGenres()).find((g) => g.lower === 'drum & bass');
    if (dnb) genres.unshift(dnb.name);
  }
  // "house not techno" — an excluded genre must not stay a constraint.
  const excluded: string[] = [];
  for (const g of genres) {
    if (new RegExp(`(not|no more|less) ${g.toLowerCase()}`).test(text)
        || new RegExp(`${'more'} \\w+ than ${g.toLowerCase()}`).test(text)) {
      excluded.push(g);
    }
  }
  const kept = genres.filter((g) => !excluded.includes(g));

  const afterMatch = text.match(/after (\d{1,2})\s?(am|pm)?/);
  let afterHour: number | null = null;
  if (afterMatch) {
    afterHour = Number(afterMatch[1]) % 12;
    if (afterMatch[2] === 'pm') afterHour += 12;
  } else if (/after midnight/.test(text)) {
    afterHour = 0;
  }

  const priceMatch = text.match(/under [£$€]?\s?(\d{1,4})/);

  const social: AskIntent['social'] = has(text, CLOSE_FRIEND_WORDS) ? 'close_friends'
    : has(text, SCENE_WORDS) ? 'scene'
    : has(text, CONNECTION_WORDS) || /who'?s going/.test(text) ? 'connections'
    : null;

  const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const wantsArchive = has(text, ARCHIVE_WORDS) || (!!yearMatch && Number(yearMatch[1]) < 2020);
  const pastToPresent = has(text, PAST_PRESENT_WORDS);

  return {
    city,
    date: parseDate(text),
    genres: kept,
    oldSchool: has(text, OLD_SCHOOL_WORDS) || undefined,
    daytime: has(text, DAYTIME_WORDS) || undefined,
    lateNight: /late night|after dark|all night/.test(text) || undefined,
    afterHour,
    priceMax: priceMatch ? Number(priceMatch[1]) : has(text, FREE_WORDS) ? 0 : has(text, CHEAP_WORDS) ? 15 : null,
    sizePref: has(text, SMALL_WORDS) ? 'small' : has(text, BIG_WORDS) ? 'big' : null,
    social,
    momentum: has(text, MOMENTUM_WORDS) || undefined,
    worthTravelling: has(text, TRAVEL_WORTH_WORDS) || undefined,
    travelCity,
    archive: wantsArchive && !pastToPresent
      ? { query: raw.trim(), year: yearMatch ? Number(yearMatch[1]) : null }
      : null,
    pastToPresent: pastToPresent || undefined,
    personalized: has(text, SURPRISE_WORDS) || undefined,
    artist: null,
    venue: null,
    promoter: null,
  };
}

// FOLLOW-UP MERGING — new constraints override, everything else inherits.
// "Anything smaller?" keeps London + Saturday and only changes size.
export function mergeIntent(prev: AskIntent, next: AskIntent, followUpText: string): AskIntent {
  const t = ` ${followUpText.toLowerCase()} `;
  const isFollowUp = !next.city && !next.date && !next.archive && !next.pastToPresent
    ? true
    : /^(anything|something|more|less|what about|how about|and |ok |okay )/.test(followUpText.toLowerCase().trim());
  if (!isFollowUp && next.city && next.city !== prev.city) return next; // a fresh question resets

  const merged: AskIntent = { ...prev };
  if (next.city) merged.city = next.city;
  if (next.date) merged.date = next.date;
  if (next.genres.length) merged.genres = next.genres;
  // "house not techno" → replace, with the excluded genre dropped even if inherited
  for (const g of merged.genres) {
    if (new RegExp(`(not|no) ${g.toLowerCase()}`).test(t)) {
      merged.genres = merged.genres.filter((x) => x !== g);
    }
  }
  if (next.sizePref) merged.sizePref = next.sizePref;
  if (next.priceMax != null) merged.priceMax = next.priceMax;
  if (next.daytime) merged.daytime = true;
  if (next.lateNight) merged.lateNight = true;
  if (next.afterHour != null) merged.afterHour = next.afterHour;
  if (next.social) merged.social = next.social;
  if (next.oldSchool) merged.oldSchool = true;
  if (next.momentum) merged.momentum = true;
  if (next.worthTravelling) merged.worthTravelling = true;
  if (next.travelCity) merged.travelCity = next.travelCity;
  if (next.archive) merged.archive = next.archive;
  if (next.pastToPresent) merged.pastToPresent = true;
  if (next.personalized) merged.personalized = true;
  return merged;
}
