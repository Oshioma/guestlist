// ASK @GUESTLIST — the website channel. Guests and members; rate-limited
// per member and per IP using the same conventions as event submissions.

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { askGuestlist } from '@/lib/ask/engine';
import type { AskWriterClient } from '@/lib/ask/writer';

export const maxDuration = 60;

const MEMBER_PER_HOUR = 60;
const GUEST_PER_IP_HOUR = 20;

function hashIp(req: NextRequest): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  return createHash('sha256')
    .update(`${ip}:${process.env.SESSION_SECRET ?? ''}`)
    .digest('hex');
}

// Test hook: deterministic writer fixture, never honoured in production —
// same pattern as the vision/extraction fixtures.
function fixtureWriter(req: NextRequest): AskWriterClient | undefined {
  const fixture = req.headers.get('x-ask-writer-fixture');
  if (!fixture || process.env.NODE_ENV === 'production') return undefined;
  try {
    const parsed = JSON.parse(fixture) as { commentary: string };
    return { write: async () => ({ ok: true, commentary: parsed.commentary, model: 'fixture' }) };
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await getCurrentMember();
    const body = await req.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return NextResponse.json({ error: 'Ask something' }, { status: 400 });
    if (question.length > 500) {
      return NextResponse.json({ error: 'Keep it under 500 characters' }, { status: 400 });
    }

    const ipHash = hashIp(req);
    const recent = await queryOne<{ n: number }>(
      member
        ? `select count(*)::int as n from ask_messages
            where member_id = $1 and created_at > now() - interval '1 hour'`
        : `select count(*)::int as n from ask_messages
            where ip_hash = $1 and member_id is null and created_at > now() - interval '1 hour'`,
      [member ? member.id : ipHash]);
    if ((recent?.n ?? 0) >= (member ? MEMBER_PER_HOUR : GUEST_PER_IP_HOUR)) {
      return NextResponse.json(
        { error: 'Easy — that’s a lot of questions. Try again in a bit.' }, { status: 429 });
    }

    const answer = await askGuestlist({
      question,
      viewerId: member?.id ?? null,
      channel: 'website',
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      ipHash: member ? null : ipHash,
      writer: fixtureWriter(req),
    });
    return NextResponse.json(answer);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
