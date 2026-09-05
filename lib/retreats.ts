// RETREATS — read the page, then let a person correct it.
//
// An admin has a link to a retreat and wants it on Balance. Everything a card
// needs (a name, a picture, a line about it, roughly where in the world it is)
// is usually already in the page's own OpenGraph tags, because that is what
// those tags are for — they are what WhatsApp shows when you paste the link.
//
// So this reads them and hands back a filled-in form rather than saving
// anything. Nothing goes live off the back of a machine reading a website:
// the admin sees exactly what was found, fixes the half of it that is
// marketing waffle, and presses save. Reading is a suggestion; publishing is
// a decision.
//
// It deliberately does not use the event extraction pipeline. That pipeline
// exists to find a *night* — it fails a page outright when it cannot pin down
// a start date, which is the normal state of a retreat's website.

import { query, queryOne } from './db';
import { safeFetch, type SafeFetchResult } from './supply/safeFetch';
import { inspectPage } from './supply/structured';
import { findPageImages, type FoundImage } from './supply/images';
import { slugify } from './util';

export type Retreat = {
  id: string;
  slug: string;
  title: string;
  location: string | null;
  when_text: string | null;
  blurb: string | null;
  image_url: string | null;
  url: string;
  price_text: string | null;
  status: string;
  sort_order: number;
  source_url: string | null;
  created_at: string;
};

const SELECT = `select id, slug, title, location, when_text, blurb, image_url, url, price_text,
                       status, sort_order, source_url, created_at::text
                  from retreats`;

/** What Balance shows. Hand-ordered first, newest of the rest after. */
export async function listLiveRetreats(limit = 12): Promise<Retreat[]> {
  return query<Retreat>(`${SELECT} where status = 'live' order by sort_order, created_at desc limit $1`, [limit]);
}

export async function allRetreats(): Promise<Retreat[]> {
  return query<Retreat>(`${SELECT} order by sort_order, created_at desc limit 200`);
}

export async function getRetreat(id: string): Promise<Retreat | null> {
  return queryOne<Retreat>(`${SELECT} where id = $1`, [id]);
}

export type RetreatDraft = {
  title: string;
  location: string | null;
  whenText: string | null;
  blurb: string | null;
  imageUrl: string | null;
  url: string;
  priceText: string | null;
};

export type ReadLinkOutcome =
  | { ok: true; draft: RetreatDraft; found: string[]; images: string[] }
  | { ok: false; error: string };

// A social card is a picture of words: the site's name, the price, the title
// again, laid over a gradient by a template. Frameworks generate them at
// /opengraph-image or /api/og, and they are exactly right for WhatsApp and
// exactly wrong for Balance, where the words are already on the card and the
// picture is meant to be the place. So it goes to the back of the queue —
// still offered, never chosen for you.
const GENERATED_CARD =
  /(^|\/)(opengraph-image|twitter-image|og-image|og|opengraph)(-[a-z0-9]+)?(\/|\?|$)|\/(api|_vercel)\/og(\/|\?|$)/i;

const IMAGE_FILE = /\.(jpe?g|png|webp|avif|gif)$/i;

export function looksGenerated(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return GENERATED_CARD.test(url); }
  if (GENERATED_CARD.test(u.pathname) || GENERATED_CARD.test(`${u.pathname}?`)) return true;
  // The other shape they take: a host that exists to draw cards, serving a
  // hash with no file extension — opengraph.githubassets.com/<sha>/owner/repo.
  // A photograph somebody uploaded nearly always ends in .jpg.
  if (/(^|\.)(opengraph|og|card|social)[.-]/i.test(u.hostname) && !IMAGE_FILE.test(u.pathname)) return true;
  return false;
}

/**
 * Every picture the page offers, the ones that look like photographs first.
 *
 * findPageImages already ranks a page's images and puts a declared og:image
 * at the top, which is right for a club flyer and wrong for a retreat: the
 * flyer IS the social card, and a retreat's social card is a text template
 * over the photograph we actually want.
 */
function retreatImages(html: string, pageUrl: string): FoundImage[] {
  const all = findPageImages(html, pageUrl, 14);
  const real = all.filter((i) => !looksGenerated(i.url));
  const cards = all.filter((i) => looksGenerated(i.url));
  return [...real, ...cards];
}

/** Trim to a length, and never mid-word if we can help it. */
function tidy(v: string | null | undefined, max: number): string | null {
  if (!v) return null;
  const clean = v.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Fetch a retreat's page and pull out what a card needs.
 *
 * safeFetch is the same guarded fetcher the event engine uses — an admin
 * pasting a link is still a URL from outside, and it must not be able to make
 * the server knock on its own internal doors.
 */
export async function readRetreatLink(
  rawUrl: string,
  opts: { fetcher?: (url: string) => Promise<SafeFetchResult> } = {}
): Promise<ReadLinkOutcome> {
  const fetcher = opts.fetcher ?? safeFetch;
  const fetched = await fetcher(rawUrl.trim());
  if (!fetched.ok) {
    const why: Record<string, string> = {
      invalid_url: 'That doesn’t look like a web address.',
      unsafe_url: 'That address isn’t one we’re allowed to fetch.',
      not_found: 'That page returned “not found”.',
      blocked_by_site: 'The site blocked us. Fill the card in by hand.',
      too_large: 'That page is too big to read. Fill the card in by hand.',
      unsupported_content: 'That link isn’t a web page.',
    };
    return { ok: false, error: why[fetched.code] ?? 'Couldn’t reach that page. Fill the card in by hand.' };
  }

  let page;
  try {
    page = inspectPage(fetched.body, fetched.finalUrl, 4000);
  } catch {
    return { ok: false, error: 'Couldn’t read that page. Fill the card in by hand.' };
  }

  // Which fields actually came off the page, so the form can say so rather
  // than leaving an admin to guess what it invented.
  const found: string[] = [];
  const take = <T>(field: string, v: T | null): T | null => {
    if (v != null && v !== '') found.push(field);
    return v ?? null;
  };

  const location = [page.city?.value, page.country?.value].filter(Boolean).join(', ') || null;
  const images = retreatImages(fetched.body, fetched.finalUrl);

  return {
    ok: true,
    found,
    images: images.map((i) => i.url),
    draft: {
      title: take('title', tidy(page.title?.value, 140)) ?? '',
      location: take('location', tidy(location, 120)),
      // Nothing on a retreat page reliably says when it runs, so this is
      // always the admin's sentence to write.
      whenText: null,
      blurb: take('blurb', tidy(page.description?.value, 240)),
      imageUrl: take('image', images[0]?.url ?? page.imageUrl?.value ?? null),
      url: page.canonicalUrl ?? fetched.finalUrl,
      priceText: take('price', page.priceFrom != null
        ? `From ${page.currency?.value ?? ''}${page.priceFrom.value}`.trim()
        : null),
    },
  };
}

export type RetreatPatch = {
  id?: string | null;
  title: string;
  location?: string | null;
  whenText?: string | null;
  blurb?: string | null;
  imageUrl?: string | null;
  url: string;
  priceText?: string | null;
  status?: string;
  sortOrder?: number;
  sourceUrl?: string | null;
  createdBy?: string | null;
};

const STATUSES = new Set(['draft', 'live', 'hidden']);

export async function saveRetreat(p: RetreatPatch): Promise<{ id: string } | null> {
  const status = STATUSES.has(p.status ?? '') ? p.status! : 'draft';
  const args = [
    p.title.trim().slice(0, 160),
    tidy(p.location, 120), tidy(p.whenText, 120), tidy(p.blurb, 400),
    p.imageUrl?.trim() || null, p.url.trim(), tidy(p.priceText, 60),
    status, Number.isFinite(p.sortOrder) ? Number(p.sortOrder) : 0,
  ];
  if (p.id) {
    return queryOne<{ id: string }>(
      `update retreats set title = $1, location = $2, when_text = $3, blurb = $4, image_url = $5,
              url = $6, price_text = $7, status = $8, sort_order = $9, updated_at = now()
        where id = $10 returning id`,
      [...args, p.id]
    );
  }
  // A slug per retreat even though there is no page of its own yet: it is the
  // stable handle to use the day one gets written.
  let slug = slugify(p.title) || 'retreat';
  if (await queryOne(`select 1 from retreats where slug = $1`, [slug])) slug = `${slug}-${Date.now().toString(36)}`;
  return queryOne<{ id: string }>(
    `insert into retreats (title, location, when_text, blurb, image_url, url, price_text, status, sort_order,
                           slug, source_url, created_by_member_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [...args, slug, p.sourceUrl ?? p.url.trim(), p.createdBy ?? null]
  );
}

export async function deleteRetreat(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(`delete from retreats where id = $1 returning id`, [id]);
  return !!row;
}
