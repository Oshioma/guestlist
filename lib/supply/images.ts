// FINDING THE FLYER.
//
// Most club and festival pages do not publish an og:image. A promoter in Dar
// es Salaam builds a page in WordPress or Elementor, puts the flyer in the
// post, and never touches a meta tag — so an event arrives with everything
// except the one thing people actually look at.
//
// So when the metadata is silent, read the page like a person would: find the
// biggest picture that is plainly the artwork, and ignore the furniture. The
// hard part is not finding images, it is not picking the logo.
//
// Three things make this messy in the real world, and each is handled here:
//
//   1. Lazy loading. The real URL is in data-src / data-lazy-src / srcset,
//      and the src attribute holds a 1px placeholder.
//   2. CSS backgrounds. Page builders put the hero art in
//      style="background-image:url(…)" with no <img> anywhere.
//   3. Responsive sets. srcset lists the same picture at six sizes; the one
//      worth keeping is the largest.
//
// Nothing here fetches anything. It reads the HTML we already have.

import { parse, type HTMLElement } from 'node-html-parser';

export type ImageSource = 'json-ld' | 'opengraph' | 'meta' | 'page';
export type FoundImage = { url: string; source: ImageSource; why: string; score: number };

// Filenames that are furniture, not artwork. Deliberately conservative: it is
// better to keep an odd picture than to throw away a real flyer.
const JUNK_NAME = /(^|[/_-])(logo|logos|icon|icons|favicon|sprite|spacer|blank|placeholder|avatar|profile-pic|banner-ad|advert|pixel|tracking|loading|spinner|arrow|chevron|badge|flag|payment|visa|mastercard|paypal|whatsapp|facebook|instagram|twitter|tiktok|youtube|linkedin|share|cookie|gdpr)([/_.-]|$)/i;

// WordPress and friends write the crop into the filename: flyer-150x150.jpg.
// A 150-square is a thumbnail of the flyer, not the flyer.
const SIZE_IN_NAME = /-(\d{2,4})x(\d{2,4})\.(jpe?g|png|webp|avif)$/i;

const EXTENSION = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

function absolute(raw: string | null | undefined, pageUrl: string): string | null {
  const value = (raw ?? '').trim();
  if (!value || value.startsWith('data:')) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

// "flyer-480.jpg 480w, flyer-960.jpg 960w" → the 960 one. Descriptors may be
// widths (480w) or pixel densities (2x); both mean "bigger is better".
export function largestInSrcset(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  let best: { url: string; weight: number } | null = null;
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const descriptor = bits[1] ?? '';
    const w = /^(\d+)w$/.exec(descriptor);
    const x = /^([\d.]+)x$/.exec(descriptor);
    const weight = w ? Number(w[1]) : x ? Number(x[1]) * 1000 : 1;
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best?.url ?? null;
}

// url(…) out of a style attribute, quoted or not.
export function backgroundImageUrl(style: string | null | undefined): string | null {
  if (!style) return null;
  const m = /background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style);
  return m?.[1]?.trim() || null;
}

function declaredSize(el: HTMLElement): { w: number | null; h: number | null } {
  const num = (v: string | undefined) => {
    const n = Number((v ?? '').replace(/px$/i, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { w: num(el.getAttribute('width')), h: num(el.getAttribute('height')) };
}

function looksLikeJunk(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  if (JUNK_NAME.test(path)) return true;
  if (/\.svg(\?|#|$)/i.test(path)) return true;
  const size = SIZE_IN_NAME.exec(path);
  if (size && Number(size[1]) < 300 && Number(size[2]) < 300) return true;
  return false;
}

// Where a flyer actually lives. An image inside the article beats one in the
// header, which is nearly always the site's own logo.
const CONTENT_HINT = /(^|[\s_-])(entry|post|article|event|single|content|hero|featured|thumbnail|gallery|flyer|poster|banner|main)([\s_-]|$)/i;
const CHROME_HINT = /(^|[\s_-])(header|nav|navbar|menu|footer|sidebar|widget|logo|brand|cookie|popup|modal|newsletter|related|comment)([\s_-]|$)/i;

function contextScore(el: HTMLElement): number {
  let score = 0;
  let node: HTMLElement | null = el;
  let depth = 0;
  while (node && depth < 8) {
    const tag = node.rawTagName?.toLowerCase() ?? '';
    const bag = `${node.getAttribute('class') ?? ''} ${node.getAttribute('id') ?? ''}`;
    if (tag === 'article' || tag === 'main') score += 12;
    if (tag === 'header' || tag === 'nav' || tag === 'footer' || tag === 'aside') score -= 25;
    if (CONTENT_HINT.test(bag)) score += 8;
    if (CHROME_HINT.test(bag)) score -= 20;
    node = node.parentNode as HTMLElement | null;
    depth++;
  }
  return score;
}

// Every candidate on the page, best first. Exported so the admin desk can
// show a person what else was on the page when the top pick is wrong.
export function findPageImages(html: string, pageUrl: string, limit = 8): FoundImage[] {
  const root = parse(html);
  const found: FoundImage[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null, source: ImageSource, why: string, score: number) => {
    const url = absolute(raw, pageUrl);
    if (!url || seen.has(url)) return;
    if (looksLikeJunk(url)) return;
    seen.add(url);
    found.push({ url, source, why, score });
  };

  // Declared artwork first — when a page bothers to say, believe it.
  for (const sel of [
    'meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[property="og:image:secure_url"]',
    'meta[name="og:image"]', 'meta[name="twitter:image"]', 'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]', 'meta[property="twitter:image:src"]',
    'meta[itemprop="image"]',
  ]) {
    const el = root.querySelector(sel);
    add(el?.getAttribute('content') ?? null, 'opengraph', 'social card image', 1000);
  }
  add(root.querySelector('link[rel="image_src"]')?.getAttribute('href') ?? null, 'meta', 'link rel=image_src', 900);

  // Then the page itself.
  for (const img of root.querySelectorAll('img')) {
    const { w, h } = declaredSize(img);
    // A declared thumbnail is a thumbnail whatever its filename says.
    if ((w != null && w < 200) || (h != null && h < 200)) continue;

    const lazy =
      img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ??
      img.getAttribute('data-original') ?? img.getAttribute('data-image') ??
      img.getAttribute('data-full-url') ?? null;
    const set = largestInSrcset(
      img.getAttribute('srcset') ?? img.getAttribute('data-srcset') ?? img.getAttribute('data-lazy-srcset')
    );
    const plain = img.getAttribute('src');

    // A src that is a placeholder must not beat the real URL beside it.
    const candidates = [set, lazy, plain].filter(Boolean) as string[];
    if (!candidates.length) continue;

    const cls = `${img.getAttribute('class') ?? ''} ${img.getAttribute('id') ?? ''}`;
    let score = 100 + contextScore(img);
    if (/wp-post-image|attachment-|featured|hero|flyer|poster|event/i.test(cls)) score += 25;
    if (w != null && h != null) score += Math.min(30, Math.round(Math.sqrt(w * h) / 40));
    // A picture with real alt text is more likely the subject of the page.
    if ((img.getAttribute('alt') ?? '').trim().length > 3) score += 4;

    add(candidates[0], 'page', 'image in the page', score);
  }

  // Page builders put the hero art in CSS, with no <img> to find.
  for (const el of root.querySelectorAll('[style*="background"]')) {
    const url = backgroundImageUrl(el.getAttribute('style'));
    if (!url) continue;
    add(url, 'page', 'CSS background image', 80 + contextScore(el));
  }
  for (const el of root.querySelectorAll('[data-bg], [data-background-image], [data-bg-image]')) {
    const url = el.getAttribute('data-bg') ?? el.getAttribute('data-background-image')
      ?? el.getAttribute('data-bg-image');
    add(url ?? null, 'page', 'lazy CSS background', 80 + contextScore(el));
  }

  // A URL that at least looks like a picture beats one that does not.
  for (const f of found) if (EXTENSION.test(f.url)) f.score += 6;

  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function pickPageImage(html: string, pageUrl: string): FoundImage | null {
  return findPageImages(html, pageUrl, 1)[0] ?? null;
}
