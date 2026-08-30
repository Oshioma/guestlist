// Club Messenger moderation (admin only):
//   POST { action: 'remove_message', messageId }
//   POST { action: 'restore_message', messageId }
//   POST { action: 'suspend', memberId } / { action: 'unsuspend', memberId }
// All actions are audit-logged. Removal is a soft delete — the row stays
// for the audit trail, the room stops showing it.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { AuthError, requireAdmin } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    if (action === 'remove_message' || action === 'restore_message') {
      const messageId = String(body.messageId ?? '');
      const message = await queryOne<{ id: string; event_id: string; member_id: string }>(
        `update event_room_messages
            set deleted_at = case when $2 then now() else null end,
                deleted_by = case when $2 then $3::uuid else null end
          where id = $1
          returning id, event_id, member_id`,
        [messageId, action === 'remove_message', admin.id]
      );
      if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      if (action === 'remove_message') {
        await audit('room_message_removed', {
          actorId: admin.id, eventId: message.event_id,
          detail: { message_id: messageId, author_member_id: message.member_id },
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'suspend' || action === 'unsuspend') {
      const memberId = String(body.memberId ?? '');
      if (memberId === admin.id) {
        return NextResponse.json({ error: 'You cannot suspend yourself' }, { status: 400 });
      }
      const member = await queryOne<{ id: string }>(
        `update members set club_suspended_at = case when $2 then now() else null end
          where id = $1 returning id`,
        [memberId, action === 'suspend']
      );
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      if (action === 'suspend') {
        // A suspended member's presence goes dark immediately.
        await query(
          `update event_presence set left_at = now(), updated_at = now()
            where member_id = $1 and left_at is null`,
          [memberId]
        );
      }
      await audit(action === 'suspend' ? 'member_club_suspended' : 'member_club_unsuspended', {
        actorId: admin.id, detail: { member_id: memberId },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
