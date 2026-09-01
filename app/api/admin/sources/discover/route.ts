// DISCOVER: propose clubs, promoters, festivals and calendars in a country
// that programme the genres we care about, so an admin can test them and add
// the ones that work. Suggestions are never believed — the response says
// which ones we already have, and the workbench makes an admin probe a
// candidate (POST /api/admin/sources/test-url) before adding it.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { cleanPlace, cleanCountry } from '@/lib/util';
import { defaultDiscoveryClient, discoverSources } from '@/lib/supply/discover';

export const maxDuration = 60;

const hostKey = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const country = cleanCountry(body.country);
    if (!country) return NextResponse.json({ error: 'Choose a country' }, { status: 400 });
    const city = cleanPlace(body.city);
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 15);

    // The picker defaults to every genre, and a genre list that long says
    // nothing useful to the model — so a full selection is sent as "any dance
    // music" rather than a thirty-item list. A deliberate narrowing is sent
    // as-is, and matching is ANY-of, never all-of (see the system prompt).
    const genreIds = [...new Set(
      (Array.isArray(body.genreIds) ? body.genreIds : []).filter(
        (g: unknown): g is string => typeof g === 'string' && /^[0-9a-f-]{36}$/.test(g)
      )
    )];
    const [chosen, activeCount] = await Promise.all([
      genreIds.length
        ? query<{ name: string }>(
            `select name from genres where id = any($1::uuid[]) and active order by name`,
            [genreIds]
          )
        : Promise.resolve([]),
      query<{ n: number }>(`select count(*)::int as n from genres where active`),
    ]);
    const genres = chosen.length >= (activeCount[0]?.n ?? 0) ? [] : chosen.map((g) => g.name);

    const outcome = await discoverSources(
      { country, city, genres, limit },
      defaultDiscoveryClient()
    );
    if (!outcome.ok) {
      const status = outcome.error === 'unavailable' ? 503 : 502;
      return NextResponse.json(
        {
          error:
            outcome.error === 'unavailable'
              ? 'Discovery needs an ANTHROPIC_API_KEY on the server'
              : `Discovery failed: ${outcome.detail}`,
        },
        { status }
      );
    }

    // Anything we already monitor is marked, not hidden: seeing it is how an
    // admin knows the search covered ground they have already worked.
    const existing = await query<{ url: string }>(`select url from event_sources`);
    const knownHosts = new Set(existing.map((e) => hostKey(e.url)).filter(Boolean) as string[]);
    const knownUrls = new Set(existing.map((e) => e.url.replace(/\/$/, '').toLowerCase()));

    const candidates = outcome.candidates.map((c) => ({
      ...c,
      known:
        knownUrls.has(c.url.replace(/\/$/, '').toLowerCase()) ||
        knownHosts.has(hostKey(c.url) ?? ''),
    }));

    return NextResponse.json({ candidates, model: outcome.model, genres });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}
