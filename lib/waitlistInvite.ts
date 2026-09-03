// TELL THE WAITLIST. People left an address while /membership read COMING
// SOON; once billing is on, an admin presses one button and each of them
// gets one email saying it is open. Never twice (invited_at is the record),
// never to someone who has joined since, never on its own.

import { AuthError } from './auth';
import { query } from './db';
import { audit } from './audit';
import { track } from './analytics';
import { queueMemberTransactional } from './email';
import { billingEnabled, formatPence, getPlan } from './membership';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

export type WaitlistPending = { id: string; email: string; member_id: string | null; display_name: string | null; created_at: string };

// Waiting = never invited, and not already an active member (by account or
// by the same address on a member's account).
const PENDING_SQL = `
  select w.id, w.email, coalesce(w.member_id, m.id) as member_id, m.display_name, w.created_at::text
    from membership_waitlist w
    left join members m on m.id = w.member_id or lower(m.email) = lower(w.email)
    left join memberships s on s.member_id = m.id
   where w.invited_at is null
     and not (s.id is not null and (
       (s.billing_source = 'lifetime' and s.status = 'active')
       or (s.status in ('active','trialing'))
       or (s.status = 'past_due' and s.current_period_end > now())
     ))`;

export async function waitlistPending(): Promise<WaitlistPending[]> {
  return query<WaitlistPending>(`${PENDING_SQL} order by w.created_at asc`);
}

export async function inviteWaitlist(actorId: string): Promise<{ sent: number; skipped: number }> {
  if (!billingEnabled()) throw new AuthError(400, 'Switch on Stripe first — the email tells people they can join now');
  const plan = await getPlan();
  const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
  const pending = await waitlistPending();
  let sent = 0;
  for (const w of pending) {
    await queueMemberTransactional({
      memberId: w.member_id, email: w.email, emailType: 'notification:membership_open',
      subject: 'Guestlist Membership is open',
      body: `You asked to be told when Guestlist Membership opened. It has. ${price}/month: free entrance to parties where we can make it happen, queue jumps, member prices, the Guestlist Market, member drops — and a membership that does some good along the way. Cancel any time.`,
      ctaLabel: `JOIN GUESTLIST — ${price.toUpperCase()}/MONTH`, ctaUrl: `${SITE}/membership`,
      dedupeKey: `waitlist-invite:${w.email.toLowerCase()}`,
    });
    await query(`update membership_waitlist set invited_at = now() where id = $1`, [w.id]);
    await track('membership_waitlist_invited', { memberId: w.member_id ?? undefined, metadata: { by: actorId } });
    sent++;
  }
  const skipped = (await query<{ n: number }>(`select count(*)::int as n from membership_waitlist where invited_at is null`))[0]?.n ?? 0;
  await audit('membership_changed', { actorId, detail: { action: 'waitlist_invited', sent, skipped } });
  return { sent, skipped };
}
