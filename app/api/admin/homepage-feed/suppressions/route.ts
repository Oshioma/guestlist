import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { xAudit } from '@/lib/intelligence/core';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const source = body.source;
    const externalId = typeof body.externalId === 'string' ? body.externalId : '';

    if (source !== 'website' || !UUID.test(externalId)) {
      return NextResponse.json({ error: 'Invalid homepage post' }, { status: 400 });
    }

    const suppression = await queryOne<{ external_id: string }>(
      `insert into homepage_feed_suppressions (source, external_id, suppressed_by)
       select 'website', d.id::text, $2
         from channel_drafts d
        where d.id = $1::uuid and d.channel = 'website' and d.status = 'posted'
       on conflict (source, external_id) do update
         set suppressed_by = excluded.suppressed_by, suppressed_at = now()
       returning external_id`,
      [externalId, admin.id]
    );

    if (!suppression) {
      return NextResponse.json({ error: 'Homepage post not found' }, { status: 404 });
    }

    await xAudit('homepage_post_suppressed', {
      actorId: admin.id,
      draftId: externalId,
      detail: 'website homepage feed',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

