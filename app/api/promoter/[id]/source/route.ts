// CONNECT YOUR WEBSITE: creates (or repoints) the promoter's event-feed
// source using the V2A source system, then lets the team pause/resume.
// Trust levels and blocking remain admin-only concepts.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requirePromoterRole } from '@/lib/promoterAuth';
import { validateUrl } from '@/lib/supply/safeFetch';
import { supplyConfig } from '@/lib/supply/config';
import { audit } from '@/lib/audit';

async function feedSource(promoterId: string) {
  return queryOne<{ id: string; url: string; active: boolean; trust: string }>(
    `select id, url, active, trust from event_sources
      where promoter_id = $1 order by created_at asc limit 1`,
    [promoterId]
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));
    const rawUrl = String(body.url ?? '').trim();

    // The test allowlist (dev only, empty in production) lets fixture
    // servers through; real private/unsafe URLs are still rejected.
    const validated = validateUrl(rawUrl, { allowHostsForTests: supplyConfig.fetch.allowHosts });
    if (!validated.ok) {
      return NextResponse.json({ error: 'That doesn’t look like a public website URL' }, { status: 400 });
    }
    const url = validated.url.toString();

    const existing = await feedSource(id);
    if (existing) {
      if (existing.trust === 'blocked') {
        return NextResponse.json({ error: 'This source is blocked — contact Guestlist' }, { status: 403 });
      }
      await query(
        `update event_sources set url = $2, feed_url = null, active = true, updated_at = now() where id = $1`,
        [existing.id, url]
      );
      await audit('source_url_changed', {
        actorId: member.id, promoterId: id, sourceId: existing.id,
        detail: { from: existing.url, to: url },
      });
      return NextResponse.json({ ok: true, sourceId: existing.id, changed: true });
    }

    const clash = await queryOne(`select 1 from event_sources where url = $1`, [url]);
    if (clash) {
      return NextResponse.json({ error: 'That URL is already connected to another source' }, { status: 409 });
    }
    const source = await queryOne<{ id: string }>(
      // NOT polling. Connecting a site says "read this", not "read this
      // every day forever" — and a schedule nobody chose is a schedule
      // nobody is watching. An admin turns it on once the scans look right.
      `insert into event_sources (source_type, name, url, promoter_id, polling_enabled, poll_frequency_hours, notes)
       values ('promoter_website', $1, $2, $3, false, 24, 'Connected by promoter team')
       returning id`,
      [`${promoter.name} — website`, url, id]
    );
    await audit('source_connected', {
      actorId: member.id, promoterId: id, sourceId: source!.id, detail: { url },
    });
    return NextResponse.json({ ok: true, sourceId: source!.id, changed: false }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member } = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const source = await feedSource(id);
    if (!source) return NextResponse.json({ error: 'No connected source' }, { status: 404 });
    if (source.trust === 'blocked') {
      return NextResponse.json({ error: 'This source is blocked — contact Guestlist' }, { status: 403 });
    }
    if (action !== 'pause' && action !== 'resume') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    await query(
      `update event_sources set active = $2, updated_at = now() where id = $1`,
      [source.id, action === 'resume']
    );
    await audit(action === 'pause' ? 'source_paused' : 'source_resumed', {
      actorId: member.id, promoterId: id, sourceId: source.id,
    });
    return NextResponse.json({ ok: true, active: action === 'resume' });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
