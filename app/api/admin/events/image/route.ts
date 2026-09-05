// A picture off the admin's own machine, for the manual event form.
//
// The other image route on an event goes back to its source page and looks
// for the flyer. That works when there is a source page. An event typed in by
// hand has none — somebody was sent a JPEG on WhatsApp — and until now the
// only way to give it a picture was to host the file somewhere else first and
// paste a URL back in, which is a job nobody should have to do.
//
// Same storage and the same sniffing as the site pictures: the bytes are
// checked to actually be an image rather than trusting a filename or a
// content-type header, and anything over the media limit is refused.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { MediaError, storeSiteImage } from '@/lib/archive/media';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Attach a picture' }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No picture attached' }, { status: 400 });
    const stored = await storeSiteImage(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ url: stored.url, bytes: stored.bytes });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof MediaError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
