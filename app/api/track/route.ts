// Client analytics ingestion. Only view/UI event types are accepted here;
// action events (saved, going, ticket clicks…) are recorded server-side by
// the routes that perform them, so counts can't be spoofed from the client.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { track, type AnalyticsEventType } from '@/lib/analytics';

const CLIENT_TYPES: AnalyticsEventType[] = [
  'event_viewed', 'event_shared', 'promoter_viewed', 'genre_selected', 'location_selected',
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const type = body?.type as AnalyticsEventType | undefined;
  if (!type || !CLIENT_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }
  const member = await getCurrentMember();
  await track(type, {
    memberId: member?.id ?? null,
    anonId: typeof body.anonId === 'string' ? body.anonId.slice(0, 64) : null,
    eventId: typeof body.eventId === 'string' ? body.eventId : null,
    genreId: typeof body.genreId === 'string' ? body.genreId : null,
    promoterId: typeof body.promoterId === 'string' ? body.promoterId : null,
    path: typeof body.path === 'string' ? body.path.slice(0, 300) : null,
    metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
  });
  return NextResponse.json({ ok: true });
}
