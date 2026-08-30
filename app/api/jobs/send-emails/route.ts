// Email cron. Bridges promoter notifications to the outbox, queues weekly
// digests when asked, then delivers pending mail.
//
//   hourly:  curl -X POST .../api/jobs/send-emails -H "Authorization: Bearer $SUPPLY_CRON_SECRET"
//   weekly:  curl -X POST ".../api/jobs/send-emails?digest=weekly" -H ...

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  queueMemberWeeklyDigest, queuePromoterNotificationEmails,
  queuePromoterWeeklyDigest, sendPendingEmails,
} from '@/lib/email';

export const maxDuration = 300;

function secretMatches(header: string | null): boolean {
  const secret = process.env.SUPPLY_CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('authorization'))) {
    const member = await getCurrentMember();
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const notificationEmails = await queuePromoterNotificationEmails();

  let memberDigests = 0;
  let promoterDigests = 0;
  if (req.nextUrl.searchParams.get('digest') === 'weekly') {
    const members = await query<{ id: string }>(
      `select m.id from members m
        where not exists (select 1 from member_email_prefs p
                           where p.member_id = m.id and not p.weekly_digest)`
    );
    for (const m of members) {
      if (await queueMemberWeeklyDigest(m.id)) memberDigests++;
    }
    const promoters = await query<{ id: string }>(
      `select distinct p.id from promoters p
         join promoter_members pm on pm.promoter_id = p.id
        where p.claim_status = 'verified'`
    );
    for (const p of promoters) {
      if (await queuePromoterWeeklyDigest(p.id)) promoterDigests++;
    }
  }
  const delivery = await sendPendingEmails();
  return NextResponse.json({ ok: true, notificationEmails, memberDigests, promoterDigests, ...delivery });
}
