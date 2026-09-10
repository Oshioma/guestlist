// Client analytics ingestion. Only view/UI event types are accepted here;
// action events (saved, going, ticket clicks…) are recorded server-side by
// the routes that perform them, so counts can't be spoofed from the client.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { track, type AnalyticsEventType } from '@/lib/analytics';

const CLIENT_TYPES: AnalyticsEventType[] = [
  'event_viewed', 'event_shared', 'promoter_viewed', 'genre_selected', 'location_selected',
  'clubmessenger_open', 'clubmessenger_event_open', 'live_room_open',
  'friend_arrival_seen', 'friend_arrival_clicked',
  'event_click_from_clubmessenger', 'heat_card_click',
  'member_profile_viewed', 'scene_people_impression',
  'recommendation_click', 'email_rec_clicked', 'notification_clicked',
  'archive_viewed', 'archive_item_viewed', 'archive_to_event_click',
  'membership_page_viewed', 'get_me_in_viewed', 'market_viewed', 'market_business_viewed',
  'member_drop_viewed', 'ask_guestlist_opened',
  'retreat_clicked',
];

// A hostname and nothing else. The browser is supposed to send only that,
// but the browser is not ours, so anything that is not host-shaped is thrown
// away rather than stored — a full URL arriving here would be exactly the
// leak the client-side trim exists to prevent.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
function cleanHost(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const host = v.trim().toLowerCase().replace(/^www\./, '').slice(0, 120);
  return HOST.test(host) ? host : null;
}

// Two letters from the CDN edge. Vercel sets the first; the others are here
// so this keeps working behind Cloudflare or a plain proxy rather than
// silently recording nothing.
function country(req: NextRequest): string | null {
  const raw = req.headers.get('x-vercel-ip-country')
    ?? req.headers.get('cf-ipcountry')
    ?? req.headers.get('x-geo-country');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const type = body?.type as AnalyticsEventType | undefined;
  if (!type || !CLIENT_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }
  const member = await getCurrentMember();
  await track(type, {
    memberId: member?.id ?? null,
    referrerHost: cleanHost(body.referrerHost),
    country: country(req),
    anonId: typeof body.anonId === 'string' ? body.anonId.slice(0, 64) : null,
    eventId: typeof body.eventId === 'string' ? body.eventId : null,
    genreId: typeof body.genreId === 'string' ? body.genreId : null,
    promoterId: typeof body.promoterId === 'string' ? body.promoterId : null,
    path: typeof body.path === 'string' ? body.path.slice(0, 300) : null,
    metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
  });
  return NextResponse.json({ ok: true });
}
