// The first thing a new member hears from us. Sent from wherever the
// membership is first activated — the webhook or the welcome page — and
// deduplicated by member, so two paths never mean two emails.

import { queryOne } from './db';
import { queueMemberTransactional } from './email';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export async function welcomeNewMember(memberId: string): Promise<void> {
  const m = await queryOne<{ email: string; display_name: string }>(`select email, display_name from members where id = $1`, [memberId]);
  if (!m) return;
  await queueMemberTransactional({
    memberId,
    email: m.email,
    emailType: 'notification:membership_welcome',
    subject: 'You’re in. Welcome to Guestlist.',
    body: 'See something you want to go to? Ask Guestlist to get you in. Your membership, your events and your Market offers all live in one place.',
    ctaLabel: 'YOUR MEMBERSHIP',
    ctaUrl: `${SITE}/you/membership`,
    dedupeKey: `membership-welcome:${memberId}`,
  });
  await queryOne(
    `insert into notifications (member_id, type, payload) values ($1, 'membership_started', '{}') returning id`, [memberId]
  ).catch(() => null);
}
