// Accept a team invite: signed-in member + valid unexpired token → join the
// promoter team with the invited role.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { audit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? '');
    if (!/^[a-f0-9]{48}$/.test(token)) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await queryOne<{
      id: string; promoter_id: string; role: string; accepted_at: string | null; expired: boolean;
      promoter_name: string;
    }>(
      `select i.id, i.promoter_id, i.role, i.accepted_at, (i.expires_at < now()) as expired,
              p.name as promoter_name
         from promoter_invites i join promoters p on p.id = i.promoter_id
        where i.token_hash = $1`,
      [tokenHash]
    );
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    if (invite.accepted_at) return NextResponse.json({ error: 'Invite already used' }, { status: 409 });
    if (invite.expired) return NextResponse.json({ error: 'Invite has expired' }, { status: 410 });

    await query(
      `insert into promoter_members (promoter_id, member_id, role) values ($1, $2, $3)
       on conflict (promoter_id, member_id) do nothing`,
      [invite.promoter_id, member.id, invite.role]
    );
    await query(
      `update promoter_invites set accepted_at = now(), accepted_by = $2 where id = $1`,
      [invite.id, member.id]
    );
    await audit('team_member_added', {
      actorId: member.id, promoterId: invite.promoter_id,
      detail: { via: 'invite', role: invite.role },
    });
    return NextResponse.json({ ok: true, promoterId: invite.promoter_id, promoterName: invite.promoter_name, role: invite.role });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
