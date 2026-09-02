// A Market listing with no picture is the one thing people notice. Most
// independent businesses already have a decent og:image — it is what shows
// when their link is shared — and an apple-touch-icon that works as a logo.
// Read both from their website through the supply engine's hardened fetcher
// and fill in whatever the listing is missing. Admin can overwrite anything.
//
// Only ever called from admin actions or a business owner saving their own
// listing: a member submitting a form never makes Guestlist fetch a URL.

import { parse } from 'node-html-parser';
import { query, queryOne } from './db';
import { safeFetch } from './supply/safeFetch';
import { inspectPage } from './supply/structured';

export type DiscoveredImages = { hero: string | null; logo: string | null; error: string | null };

function abs(u: string | null | undefined, base: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function discoverBusinessImages(website: string): Promise<DiscoveredImages> {
  const res = await safeFetch(website, { timeoutMs: 8000, maxBytes: 1_500_000, accept: 'text/html' });
  if (!res.ok) return { hero: null, logo: null, error: res.detail };
  if (!/html/i.test(res.contentType)) return { hero: null, logo: null, error: 'Not an HTML page' };

  // The hero: the same og:image / JSON-LD / page-image logic events use.
  const page = inspectPage(res.body, res.finalUrl, 2000);
  const hero = page.imageUrl?.value ?? null;

  // The logo: an apple-touch-icon is a real square logo; a plain icon is a
  // last resort (often a 16px favicon, but better than a letter).
  const root = parse(res.body);
  const icons = root.querySelectorAll('link[rel]').map((l) => ({
    rel: (l.getAttribute('rel') ?? '').toLowerCase(),
    href: l.getAttribute('href') ?? '',
    sizes: l.getAttribute('sizes') ?? '',
  }));
  const bySize = (a: { sizes: string }, b: { sizes: string }) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0);
  const touch = icons.filter((i) => i.rel.includes('apple-touch-icon')).sort(bySize)[0];
  const icon = icons.filter((i) => /(^|\s)icon(\s|$)/.test(i.rel) && !/\.ico(\?|$)/i.test(i.href)).sort(bySize)[0];
  const ogLogo = root.querySelector('meta[property="og:logo"]')?.getAttribute('content');
  const logo = abs(touch?.href, res.finalUrl) ?? abs(ogLogo, res.finalUrl) ?? abs(icon?.href, res.finalUrl);

  return { hero, logo, error: null };
}

// Fill only what is empty. Returns what was set, so the desk can say so.
export async function fillMissingBusinessImages(businessId: string): Promise<{ hero: boolean; logo: boolean; error: string | null }> {
  const b = await queryOne<{ website: string | null; logo_url: string | null; hero_image_url: string | null }>(
    `select website, logo_url, hero_image_url from market_businesses where id = $1`, [businessId]);
  if (!b?.website) return { hero: false, logo: false, error: 'No website to read from' };
  if (b.logo_url && b.hero_image_url) return { hero: false, logo: false, error: null };
  const found = await discoverBusinessImages(b.website);
  const setHero = !b.hero_image_url && !!found.hero;
  const setLogo = !b.logo_url && !!found.logo;
  if (setHero || setLogo) {
    await query(
      `update market_businesses
          set hero_image_url = coalesce(hero_image_url, $2), logo_url = coalesce(logo_url, $3), updated_at = now()
        where id = $1`,
      [businessId, setHero ? found.hero : null, setLogo ? found.logo : null]
    );
  }
  return { hero: setHero, logo: setLogo, error: found.error };
}
