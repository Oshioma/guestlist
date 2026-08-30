// ANNOUNCE TO FOLLOWERS — structured, verified-only, capped, audited.
// GET: list this promoter's announcements with honest attribution stats.
// POST: preview an audience, create (send now / schedule), or cancel.
// Promoters never see or receive follower identities through any of this.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { requirePromoterRole } from '@/lib/promoterAuth';
import {
  AnnouncementError, announcementStats, audiencePreview, cancelAnnouncement,
  createAnnouncement, processAnnouncements, type Audience,
} from '@/lib/announcements';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requirePromoterRole(id, 'analyst');
    return NextResponse.json({ announcements: await announcementStats(id) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    // Announcements are a serious surface: admin or owner only.
    const { member } = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'preview') {
      const preview = await audiencePreview(
        id, String(body.eventId ?? ''), (body.audience ?? 'all') as Audience,
        typeof body.locationId === 'string' ? body.locationId : null);
      if ('error' in preview) return NextResponse.json({ error: preview.error }, { status: 400 });
      return NextResponse.json({ preview });
    }

    if (action === 'create') {
      const result = await createAnnouncement({
        promoterId: id,
        actorId: member.id,
        eventId: String(body.eventId ?? ''),
        updateType: String(body.updateType ?? ''),
        note: typeof body.note === 'string' ? body.note : null,
        audience: typeof body.audience === 'string' ? body.audience : 'all',
        locationId: typeof body.locationId === 'string' ? body.locationId : null,
        scheduleFor: typeof body.scheduleFor === 'string' && body.scheduleFor ? body.scheduleFor : null,
      });
      // "Send now" runs a first delivery pass immediately; the hourly job
      // continues/retries any remainder idempotently.
      if (result.status === 'queued') await processAnnouncements();
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'cancel') {
      const ok = await cancelAnnouncement(String(body.announcementId ?? ''), id, member.id);
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'Too late to cancel' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError || err instanceof AnnouncementError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
