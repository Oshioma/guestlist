// Member connections: CONNECT (not "add friend"), accept, decline, block,
// unblock, report. Blocking severs the relationship everywhere and removes
// both members from each other's discovery.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  ConnectionError, blockMember, listConnections, removeConnection,
  requestConnection, respondToConnection, setCloseFriend, unblockMember,
} from '@/lib/connections';
import { track } from '@/lib/analytics';

export async function GET() {
  try {
    const member = await requireMember();
    const [connections, blocked] = await Promise.all([
      listConnections(member.id),
      query<{ id: string; display_name: string }>(
        `select m.id, m.display_name from member_blocks b
           join members m on m.id = b.blocked_id where b.blocker_id = $1`,
        [member.id]
      ),
    ]);
    return NextResponse.json({ ...connections, blocked });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const memberId = typeof body.memberId === 'string' ? body.memberId : '';
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId : '';

    if (action === 'request') {
      await requestConnection(member.id, memberId);
      await track('connection_requested', { memberId: member.id, metadata: { to: memberId } });
    } else if (action === 'accept' || action === 'decline') {
      await respondToConnection(member.id, connectionId, action === 'accept');
      if (action === 'accept') {
        await track('connection_accepted', { memberId: member.id, metadata: { connection_id: connectionId } });
      }
    } else if (action === 'close_friend') {
      // PRIVATE, one-way. The other member is never notified or shown it.
      const close = body.close !== false;
      await setCloseFriend(member.id, memberId, close);
      await track(close ? 'close_friend_marked' : 'close_friend_unmarked', {
        memberId: member.id, metadata: { other: memberId },
      });
    } else if (action === 'remove') {
      await removeConnection(member.id, memberId);
    } else if (action === 'block') {
      await blockMember(member.id, memberId);
    } else if (action === 'unblock') {
      await unblockMember(member.id, memberId);
    } else if (action === 'report') {
      const target = await query(`select 1 from members where id = $1`, [memberId]);
      if (!target.length) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;
      await query(
        `insert into member_reports (reporter_id, reported_id, reason) values ($1, $2, $3)`,
        [member.id, memberId, reason]
      );
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError || err instanceof ConnectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
