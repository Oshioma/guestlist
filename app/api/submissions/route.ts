import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { processUrlSubmission } from '@/lib/ingestion';
import { track } from '@/lib/analytics';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? '').trim();
  if (!url) return NextResponse.json({ error: 'A link is required' }, { status: 400 });

  const member = await getCurrentMember();
  const result = await processUrlSubmission(url, member?.id ?? null);

  if (result.status === 'invalid') {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  await track('event_submitted', {
    memberId: member?.id ?? null,
    eventId: result.status === 'created' ? result.eventId : result.existingEventId,
    metadata: { url, outcome: result.status },
  });

  return NextResponse.json({
    ok: true,
    outcome: result.status,
    message:
      result.status === 'duplicate'
        ? 'Good news — we already have that one on our radar.'
        : 'Got it. Our team will review it and add it to Guestlist.',
  });
}
