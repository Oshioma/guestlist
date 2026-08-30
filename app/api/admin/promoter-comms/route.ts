// ADMIN → PROMOTER COMMUNICATIONS. Central control: pause a promoter's
// announcements, block an individual announcement, adjust the central
// caps, or pause the whole channel. Every override is audited.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import { audit, setAnnouncementCaps } from '@/lib/announcements';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'pause_promoter' || action === 'unpause_promoter') {
      const paused = action === 'pause_promoter';
      const row = await queryOne<{ id: string }>(
        `update promoters set announcements_paused = $2 where id = $1 returning id`,
        [String(body.promoterId ?? ''), paused]);
      if (!row) return NextResponse.json({ error: 'Promoter not found' }, { status: 404 });
      await audit(row.id, paused ? 'admin_pause' : 'admin_unpause', { actorId: admin.id });
      return NextResponse.json({ ok: true });
    }

    if (action === 'block_announcement') {
      const row = await queryOne<{ id: string; promoter_id: string }>(
        `update promoter_announcements
            set status = 'blocked', blocked_reason = $2
          where id = $1 and status in ('draft', 'scheduled', 'queued', 'sending')
          returning id, promoter_id`,
        [String(body.announcementId ?? ''),
         typeof body.reason === 'string' ? body.reason.slice(0, 300) : 'Blocked by admin']);
      if (!row) return NextResponse.json({ error: 'Announcement not found or already sent' }, { status: 404 });
      await audit(row.promoter_id, 'blocked', {
        announcementId: row.id, actorId: admin.id,
        detail: typeof body.reason === 'string' ? body.reason.slice(0, 300) : null,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'set_caps') {
      const caps: Record<string, number> = {};
      for (const k of ['per_promoter_per_7d', 'same_event_type_days', 'min_aggregate', 'batch_size']) {
        const v = Number(body[k]);
        if (Number.isFinite(v) && v >= 0) caps[k] = Math.floor(v);
      }
      // system_settings records who changed policy and when.
      await setAnnouncementCaps(caps, admin.id);
      return NextResponse.json({ ok: true });
    }

    if (action === 'pause_all' || action === 'unpause_all') {
      await setSetting('pause_promoter_announcements', action === 'pause_all', admin.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
