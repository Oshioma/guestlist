// ADMIN → the pictures on the site.
//
// Three things an admin can do to a slot: upload a new picture, point it at
// one that already exists somewhere, or put the original back. All three are
// on the record, because a photograph changing on the front page is the kind
// of thing somebody asks about later.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { MediaError, storeSiteImage } from '@/lib/archive/media';
import { setSiteImage, siteImageRows, SiteImageError } from '@/lib/siteImages';

export const maxDuration = 60;

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ images: await siteImageRows() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const type = req.headers.get('content-type') ?? '';

    // An uploaded file.
    if (type.includes('multipart/form-data')) {
      const form = await req.formData();
      const slot = String(form.get('slot') ?? '');
      const file = form.get('file');
      if (!(file instanceof File)) return NextResponse.json({ error: 'No picture attached' }, { status: 400 });
      const stored = await storeSiteImage(Buffer.from(await file.arrayBuffer()));
      const row = await setSiteImage(slot, stored.url, admin.id);
      await audit('site_image_changed', {
        actorId: admin.id, detail: { slot, url: stored.url, how: 'upload', bytes: stored.bytes },
      });
      return NextResponse.json({ image: row });
    }

    // An address, or null to put the original back.
    const body = (await req.json().catch(() => ({}))) as { slot?: string; url?: string | null };
    const slot = String(body.slot ?? '');
    const url = body.url === null ? null : String(body.url ?? '');
    const row = await setSiteImage(slot, url, admin.id);
    await audit('site_image_changed', {
      actorId: admin.id, detail: { slot, url: row.url, how: url === null ? 'reset' : 'address' },
    });
    return NextResponse.json({ image: row });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof SiteImageError || err instanceof MediaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
