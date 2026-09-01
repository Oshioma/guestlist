// Go back to an event's own page and look for its flyer. Fills a blank by
// default; `replace: true` is the "that picture is wrong, try again" case.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { findImageForEvent } from '@/lib/supply/imageBackfill';

const SAID = {
  no_source_url: 'This event has no source page to look at.',
  already_has_image: 'This event already has an image.',
  fetch_failed: 'Could not reach the event page.',
  no_image_found: 'Nothing on that page looks like artwork.',
} as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const result = await findImageForEvent(id, { replace: body?.replace === true });
    if (!result.ok) {
      return NextResponse.json(
        { error: SAID[result.reason], detail: result.detail ?? null },
        { status: result.reason === 'already_has_image' ? 409 : 422 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
