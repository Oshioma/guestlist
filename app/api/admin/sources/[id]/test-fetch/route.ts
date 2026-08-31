// TEST FETCH: admin diagnostic for one source. Fetches the scanner's target
// twice — once as GuestlistBot (the scanner's real identity) and once with a
// browser user agent — so an admin can tell WHY a source fails: dead URL,
// user-agent filtering, IP-level blocking, or a JS-rendered page with no
// links in the HTML. The comparison request exists only to diagnose; the
// scanner itself never masquerades as a browser.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { safeFetch, type SafeFetchResult } from '@/lib/supply/safeFetch';
import { identifyCandidateLinks, parseFeedLinks, looksLikeFeed } from '@/lib/supply/scanner';
import { supplyConfig } from '@/lib/supply/config';

export const maxDuration = 60;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SCANNER_ACCEPT =
  'application/rss+xml,application/atom+xml,text/html,application/xhtml+xml,application/xml;q=0.9';

export type FetchProbe = {
  ok: boolean;
  status: number | null;
  code: string | null;
  detail: string | null;
  ms: number;
};

const toProbe = (r: SafeFetchResult): FetchProbe =>
  r.ok
    ? { ok: true, status: r.status, code: null, detail: null, ms: r.ms }
    : { ok: false, status: r.status ?? null, code: r.code, detail: r.detail, ms: r.ms };

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const source = await queryOne<{ url: string; feed_url: string | null }>(
      `select url, feed_url from event_sources where id = $1`,
      [id]
    );
    if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 });

    // Same target the scanner would fetch.
    const target = source.feed_url ?? source.url;
    const asBot = await safeFetch(target, { accept: SCANNER_ACCEPT });
    await new Promise((r) => setTimeout(r, supplyConfig.scan.delayBetweenFetchesMs));
    const asBrowser = await safeFetch(target, { accept: SCANNER_ACCEPT, userAgent: BROWSER_UA });

    // What the scanner would make of the successful bot response.
    let method: 'rss' | 'html' | null = null;
    let candidates: number | null = null;
    if (asBot.ok) {
      if (looksLikeFeed(asBot.contentType, asBot.body)) {
        method = 'rss';
        candidates = parseFeedLinks(asBot.body, asBot.finalUrl).length;
      } else {
        method = 'html';
        candidates = identifyCandidateLinks(asBot.body, asBot.finalUrl).length;
      }
    }

    return NextResponse.json({
      target,
      bot: toProbe(asBot),
      browser: toProbe(asBrowser),
      method,
      candidates,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Test fetch failed' },
      { status: 500 }
    );
  }
}
