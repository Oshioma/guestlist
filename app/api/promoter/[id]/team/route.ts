// Team management: invite (owner/admin), change roles, remove members.
// Owner-only: granting/removing owner. Admins manage everything below owner.

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { AuthError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { requirePromoterRole, roleAtLeast, type PromoterRole } from '@/lib/promoterAuth';
import { audit } from '@/lib/audit';
import { queueMemberTransactional } from '@/lib/email';

const INVITABLE: PromoterRole[] = ['admin', 'editor', 'analyst'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { member, promoter } = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const role = String(body.role ?? '') as PromoterRole;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (!INVITABLE.includes(role)) {
      return NextResponse.json({ error: 'Role must be admin, editor or analyst' }, { status: 400 });
    }

    // Already on the team?
    const existing = await queryOne(
      `select 1 from promoter_members pm join members m on m.id = pm.member_id
        where pm.promoter_id = $1 and lower(m.email) = $2`,
      [id, email]
    );
    if (existing) return NextResponse.json({ error: 'Already on the team' }, { status: 409 });

    const token = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await query(
      `insert into promoter_invites (promoter_id, email, role, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '14 days')`,
      [id, email, role, tokenHash, member.id]
    );
    await audit('team_invited', { actorId: member.id, promoterId: id, detail: { email, role } });

    // Email the invite (transactional — delivered live with credentials,
    // dev-logged without). The link is still returned as a fallback so
    // the inviter can share it directly.
    const invitee = await queryOne<{ id: string }>(
      `select id from members where lower(email) = $1`, [email]);
    const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
    await queueMemberTransactional({
      memberId: invitee?.id ?? null,
      email,
      emailType: 'team_invite',
      subject: `You've been invited to ${promoter.name} on Guestlist`,
      body: `${member.display_name} invited you to help run ${promoter.name} as ${role}. The invite expires in 14 days.`,
      ctaLabel: 'ACCEPT INVITE',
      ctaUrl: `${site}/promoter/invite/${token}`,
      dedupeKey: `invite:${tokenHash}`,
    });

    return NextResponse.json({
      ok: true,
      inviteUrl: `/promoter/invite/${token}`,
      note: `We've emailed ${email}. You can also share the link directly — it grants ${role} access to ${promoter.name} and expires in 14 days.`,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const actor = await requirePromoterRole(id, 'admin');
    const body = await req.json().catch(() => ({}));
    const targetMemberId = String(body.memberId ?? '');
    const remove = body.remove === true;
    const newRole = remove ? null : (String(body.role ?? '') as PromoterRole);

    const target = await queryOne<{ role: PromoterRole }>(
      `select role from promoter_members where promoter_id = $1 and member_id = $2`,
      [id, targetMemberId]
    );
    if (!target) return NextResponse.json({ error: 'Not on the team' }, { status: 404 });

    // Ownership changes (touching an owner, or granting owner) are owner-only.
    const touchesOwnership = target.role === 'owner' || newRole === 'owner';
    if (touchesOwnership && actor.role !== 'owner') {
      return NextResponse.json({ error: 'Only an owner can change ownership' }, { status: 403 });
    }
    if (!remove && !['owner', 'admin', 'editor', 'analyst'].includes(newRole!)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Never leave a promoter with no owner.
    if ((remove || newRole !== 'owner') && target.role === 'owner') {
      const owners = await queryOne<{ n: number }>(
        `select count(*)::int as n from promoter_members where promoter_id = $1 and role = 'owner'`,
        [id]
      );
      if ((owners?.n ?? 0) <= 1) {
        return NextResponse.json({ error: 'A promoter must keep at least one owner' }, { status: 409 });
      }
    }

    if (remove) {
      await query(
        `delete from promoter_members where promoter_id = $1 and member_id = $2`,
        [id, targetMemberId]
      );
      await audit('team_member_removed', { actorId: actor.member.id, promoterId: id, detail: { memberId: targetMemberId } });
    } else {
      await query(
        `update promoter_members set role = $3 where promoter_id = $1 and member_id = $2`,
        [id, targetMemberId, newRole]
      );
      await audit('role_changed', {
        actorId: actor.member.id, promoterId: id,
        detail: { memberId: targetMemberId, from: target.role, to: newRole },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
