// RENDERING A PAGE THAT WILL NOT RENDER ITSELF FOR US.
//
// Some listing pages ship an empty shell and fetch their events in the
// browser, after load. ADE's programme is one: 18 sitemaps and 2,326 URLs
// with not one event page in them, an HTML body whose event list is an empty
// <ul>, and no data embedded in the document either. Nothing we can read
// without running the JavaScript.
//
// So for those sources — and ONLY those, one flag at a time — we hand the URL
// to a hosted browser and read what it produces. Three rules keep this from
// becoming something we regret:
//
//   1. NEVER the default. A source renders only when somebody ticked the box
//      AND a token is configured. Everything else fetches exactly as before.
//   2. ALWAYS falls back. No token, a bad response, a timeout, the service
//      down — every one of those returns the ordinary fetch rather than a
//      failed scan. A rendering service having a bad day must not look like a
//      venue that stopped publishing.
//   3. The URL is validated HERE, by the same rules as a direct fetch. We are
//      asking a third party to make a request on our behalf, and "somebody
//      else does the fetching" is not a reason to stop checking where it
//      points.
//
// The provider is behind an env var. Browserless today because its free tier
// is 100 browser hours a month and we will not come close; the /content
// endpoint is a plain POST, so swapping it is a small job, not a rewrite.

import { safeFetch, validateUrl, type SafeFetchOptions, type SafeFetchResult } from './safeFetch';
import { supplyConfig } from './config';

export type Fetcher = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResult>;

export const renderingConfigured = () => Boolean(supplyConfig.render.token);

// Why a render did not happen. Shown to an admin, because "rendering is on
// but nothing changed" needs a reason and silence is not one.
export type RenderOutcome =
  | { rendered: true; ms: number }
  | { rendered: false; reason: 'not_requested' | 'no_token' | 'unsafe_url' | 'failed'; detail?: string; ms: number };

export type RenderedFetch = { result: SafeFetchResult; render: RenderOutcome };

export async function renderFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<RenderedFetch> {
  const started = Date.now();
  const { token, endpoint, timeoutMs, waitMs } = supplyConfig.render;

  if (!token) {
    return { result: await safeFetch(rawUrl, options), render: { rendered: false, reason: 'no_token', ms: Date.now() - started } };
  }
  // Same address rules as a direct fetch. A hosted browser cannot reach OUR
  // private network, but it can reach somebody else's, and asking it to is
  // not something we do by accident.
  const valid = validateUrl(rawUrl, options);
  if (!valid.ok) {
    return {
      result: { ok: false, code: valid.code, detail: valid.detail, ms: Date.now() - started },
      render: { rendered: false, reason: 'unsafe_url', detail: valid.detail, ms: Date.now() - started },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}/content?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        url: valid.url.toString(),
        // Wait for the page to stop fetching, which is the whole point: the
        // listing arrives after load or it would not need rendering.
        gotoOptions: { waitUntil: 'networkidle2', timeout: timeoutMs },
        waitForTimeout: waitMs,
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const detail = `Renderer returned HTTP ${res.status}`;
      return { result: await safeFetch(rawUrl, options), render: { rendered: false, reason: 'failed', detail, ms } };
    }
    const body = await res.text();
    if (!body.trim()) {
      return { result: await safeFetch(rawUrl, options), render: { rendered: false, reason: 'failed', detail: 'Renderer returned an empty page', ms } };
    }
    const max = options.maxBytes ?? supplyConfig.fetch.maxBytes;
    if (body.length > max) {
      return { result: await safeFetch(rawUrl, options), render: { rendered: false, reason: 'failed', detail: `Rendered page exceeded ${max} bytes`, ms } };
    }
    return {
      result: { ok: true, status: 200, finalUrl: valid.url.toString(), contentType: 'text/html', body, ms },
      render: { rendered: true, ms },
    };
  } catch (err) {
    const ms = Date.now() - started;
    const detail = err instanceof Error ? (err.name === 'AbortError' ? `Renderer timed out after ${timeoutMs}ms` : err.message) : 'Renderer failed';
    return { result: await safeFetch(rawUrl, options), render: { rendered: false, reason: 'failed', detail, ms } };
  } finally {
    clearTimeout(timer);
  }
}

// The fetcher a scan should use. Plain safeFetch unless this source is one of
// the flagged ones — the decision lives here so no caller has to remember it.
export function fetcherFor(renderJs: boolean, base: Fetcher = safeFetch): Fetcher {
  if (!renderJs || !renderingConfigured()) return base;
  return async (url, options) => (await renderFetch(url, options)).result;
}
