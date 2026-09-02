// ADMIN → the verification gate, for one person.
//
// Two things an admin can honestly do about somebody who has not confirmed:
// send the email again, or vouch for them. Vouching is a real decision — it
// puts a profile in the directory without the address ever being proved — so
// it goes on the record.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { queueEmail } from '@/lib/email';
import { audit } from '@/lib/audit';
import { queryOne } from '@/lib/db';
import {
  createVerificationToken, markVerifiedByAdmin, verificationEmail,
} from '@/lib/emailVerification';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const action = String((await req.json().catch(() => ({})))?.action ?? '');

    if (action === 'resend') {
      const issued = await createVerificationToken(id);
      if (!issued.issued) {
        // Each of these is a different thing worth saying out loud rather
        // than one shrugging "couldn't do that".
        const why = {
          already_verified: 'They are already confirmed',
          no_account: 'No such member',
          rate_limited: 'They have had several links in the last hour — give it time',
        }[issued.reason];
        return NextResponse.json({ error: why }, { status: issued.reason === 'no_account' ? 404 : 400 });
      }
      const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
      const mail = verificationEmail(issued.displayName, `${site}/verify?token=${encodeURIComponent(issued.token)}`);
      await queueEmail({
        recipientEmail: issued.email,
        memberId: id,
        emailType: 'transactional:verify_email',
        subject: mail.subject,
        bodyText: mail.bodyText,
        bodyHtml: mail.bodyHtml,
      });
      return NextResponse.json({ ok: true, resent: true });
    }

    if (action === 'mark_verified') {
      const member = await queryOne<{ display_name: string; email: string }>(
        `select display_name, email from members where id = $1`, [id]);
      if (!member) return NextResponse.json({ error: 'No such member' }, { status: 404 });
      if (!(await markVerifiedByAdmin(id))) {
        return NextResponse.json({ error: 'Could not do that' }, { status: 400 });
      }
      await audit('member_verified', {
        actorId: admin.id,
        detail: { memberId: id, displayName: member.display_name, by: 'admin' },
      });
      return NextResponse.json({ ok: true, verified: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
