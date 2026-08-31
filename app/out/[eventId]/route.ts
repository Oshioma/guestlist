// Outbound "Get Tickets" redirect. The click is recorded server-side (the
// same spoof-resistant convention as other action events), then the visitor
// is sent to the event's ticket link — or, until ticketing exists for the
// event, to the source page the listing came from.

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { track } from '@/lib/analytics';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await ctx.params;
  const home = new URL('/', req.url);
  if (!UUID.test(eventId)) return NextResponse.redirect(home);

  const event = await queryOne<{
    id: string; slug: string; ticket_url: string | null; source_url: string | null;
  }>(
    `select id, slug, ticket_url, source_url from events where id = $1 and status = 'live'`,
    [eventId]
  );
  if (!event) return NextResponse.redirect(home);

  const destination = isHttpUrl(event.ticket_url)
    ? event.ticket_url
    : isHttpUrl(event.source_url)
      ? event.source_url
      : null;
  if (!destination) return NextResponse.redirect(new URL(`/events/${event.slug}`, req.url));

  const src = req.nextUrl.searchParams.get('src');
  const member = await getCurrentMember();
  await track('ticket_clicked', {
    memberId: member?.id ?? null,
    eventId: event.id,
    path: `/out/${event.id}`,
    metadata: {
      ...(src ? { src: src.slice(0, 64) } : {}),
      destination: event.ticket_url ? 'ticket_url' : 'source_url',
    },
  });
  if (src === 'clubmessenger') {
    // Club Messenger's conversion attribution — proves the surface sells.
    await track('ticket_click_from_clubmessenger', {
      memberId: member?.id ?? null,
      eventId: event.id,
      path: `/out/${event.id}`,
    });
  }

  return NextResponse.redirect(destination, 302);
}
