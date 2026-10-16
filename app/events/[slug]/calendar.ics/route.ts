// A night as a calendar file: /events/<slug>/calendar.ics.
//
// The "Add to calendar" button on an event links here. Live listings only —
// a night still waiting for review is not something to put in anybody's
// diary. A cancelled one is still served, marked STATUS:CANCELLED, so that a
// calendar which already holds it (same UID) learns it is off rather than
// being left with a night that is not happening.
//
// The building is all in lib/ics, which is pure and tested; this only finds
// the night and hands the bytes back with the right headers.

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { buildIcs, calendarEventFor } from '@/lib/ics';
import { SITE_URL } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await queryOne<{
    id: string; slug: string; title: string; start_at: string; end_at: string | null;
    short_description: string | null; city: string | null; country: string | null;
    listing_status: string;
    venue: { name: string; address: string | null; city: string | null; country: string | null } | null;
  }>(
    `select e.id, e.slug, e.title, e.start_at, e.end_at, e.short_description, e.city, e.country,
            e.listing_status,
            case when v.id is not null then json_build_object(
              'name', v.name, 'address', v.address, 'city', v.city, 'country', v.country) end as venue
       from events e left join venues v on v.id = e.venue_id
      where e.slug = $1 and e.status = 'live'`,
    [slug]
  );
  if (!event) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(buildIcs(calendarEventFor(event, SITE_URL)), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // A file to open, named after the night rather than "calendar.ics".
      'Content-Disposition': `attachment; filename="${event.slug.replace(/[^a-z0-9-]/gi, '') || 'event'}.ics"`,
      // Short: a time change or a cancellation should reach the next tap.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
