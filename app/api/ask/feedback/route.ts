// Lightweight 👍/👎 on an Ask answer — future ranking analysis, no ML now.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { track } from '@/lib/analytics';

const REASONS = ['not_relevant', 'wrong_vibe', 'too_far', 'too_expensive', 'already_knew', 'bad_answer', 'other'];

export async function POST(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    const verdict = body.verdict === 'up' ? 'up' : body.verdict === 'down' ? 'down' : null;
    if (!verdict) return NextResponse.json({ error: 'up or down' }, { status: 400 });
    const reason = REASONS.includes(body.reason) ? body.reason : null;

    const message = await queryOne<{ id: string }>(
      `select id from ask_messages where id = $1`, [String(body.messageId ?? '')]);
    if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await query(
      `insert into ask_feedback (message_id, member_id, verdict, reason)
       values ($1, $2, $3, $4)
       on conflict (message_id, member_id) do update set verdict = $3, reason = $4`,
      [message.id, member.id, verdict, reason]);
    await track('ask_feedback', {
      memberId: member.id,
      metadata: { message_id: message.id, verdict, reason },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
