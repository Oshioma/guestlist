// ADMIN → RETREATS. Read a link, save a card, delete a card. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { sanitizeHttpUrl } from '@/lib/market';
import { deleteRetreat, readRetreatLink, saveRetreat } from '@/lib/retreats';

// Reading somebody else's website is a network round trip, not a database
// write, and a slow marketing site is normal.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

    if (action === 'read_link') {
      const url = sanitizeHttpUrl(body.url);
      if (!url) return NextResponse.json({ error: 'Paste a link first' }, { status: 400 });
      const outcome = await readRetreatLink(url);
      if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 422 });
      return NextResponse.json({ ok: true, draft: outcome.draft, found: outcome.found, images: outcome.images, sourceUrl: url });
    }

    if (action === 'save') {
      const title = s(body.title, 160);
      if (!title) return NextResponse.json({ error: 'Give the retreat a name' }, { status: 400 });
      const url = sanitizeHttpUrl(body.url);
      if (!url) return NextResponse.json({ error: 'A retreat needs a link to book it' }, { status: 400 });
      const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
      const row = await saveRetreat({
        id, title, url,
        location: s(body.location, 120),
        whenText: s(body.whenText, 120),
        blurb: s(body.blurb, 400),
        imageUrl: sanitizeHttpUrl(body.imageUrl),
        priceText: s(body.priceText, 60),
        status: String(body.status ?? 'draft'),
        sortOrder: Number(body.sortOrder) || 0,
        sourceUrl: sanitizeHttpUrl(body.sourceUrl) ?? url,
        createdBy: admin.id,
      });
      await audit('retreat_changed', { actorId: admin.id, detail: { retreatId: row?.id, status: String(body.status ?? 'draft') } });
      return NextResponse.json({ ok: true, id: row?.id });
    }

    if (action === 'delete') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Unknown retreat' }, { status: 400 });
      if (!(await deleteRetreat(id))) return NextResponse.json({ error: 'Unknown retreat' }, { status: 404 });
      await audit('retreat_deleted', { actorId: admin.id, detail: { retreatId: id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
