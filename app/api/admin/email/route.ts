// Admin email controls: safety switches (pause without a deploy) and a
// manual retry for failed temporary deliveries.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { getSafetySwitches, setSetting } from '@/lib/settings';
import { processEmailQueue } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'set_switch') {
      const key = String(body.key ?? '');
      if (!['pause_recommendation_emails', 'pause_promoter_digests', 'pause_event_reminders'].includes(key)) {
        return NextResponse.json({ error: 'Unknown switch' }, { status: 400 });
      }
      await setSetting(key, body.value === true, admin.id);
      return NextResponse.json({ ok: true, switches: await getSafetySwitches() });
    }
    if (action === 'pause_type' || action === 'resume_type') {
      const type = String(body.type ?? '').slice(0, 60);
      if (!type) return NextResponse.json({ error: 'Type required' }, { status: 400 });
      const current = (await getSafetySwitches()).paused_alert_types;
      const next = action === 'pause_type'
        ? [...new Set([...current, type])]
        : current.filter((t) => t !== type);
      await setSetting('paused_alert_types', next, admin.id);
      return NextResponse.json({ ok: true, switches: await getSafetySwitches() });
    }
    if (action === 'retry_failed') {
      await query(
        `update email_outbox set status = 'pending', attempt_count = 0, error = null
          where status = 'failed' and error_category = 'temporary'`
      );
      const result = await processEmailQueue();
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === 'process_queue') {
      const result = await processEmailQueue();
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
