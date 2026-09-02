// YOU ARE ON THE GUESTLIST.
//
// The one email on this site that somebody will actually be pleased to get,
// and the one they will open again in a queue at midnight with cold hands. So
// it says the thing at the top in the largest type the format allows, puts the
// night underneath it, and carries a code the door can scan.
//
// It is deliberately not the standard shell. Everything else Guestlist sends
// is an update; this is a pass.

import { queueEmail } from './email';
import { qrUrl, doorUrl } from './doorPass';
import { queryOne } from './db';
import { fmtEventDate, fmtEventTime } from './util';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type GuestlistPass = {
  entryId: string;
  memberId: string;
  email: string;
  guestName: string;
  places: number;
  eventTitle: string;
  eventSlug: string;
  when: string;
  time: string;
  where: string | null;
  promoterName: string;
  confirmedBy: string | null;
};

/** Everything the email needs about one confirmed entry, or null. */
export async function passForEntry(entryId: string): Promise<GuestlistPass | null> {
  const row = await queryOne<{
    id: string; member_id: string | null; email: string | null; guest_name: string;
    plus_ones: number; status: string; title: string; slug: string; start_at: string;
    end_at: string | null; timezone: string; venue_name: string | null; city: string | null;
    promoter_name: string; confirmed_by: string | null;
  }>(
    `select g.id, g.member_id, m.email, g.guest_name, g.plus_ones, g.status,
            e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            v.name as venue_name, e.city, p.name as promoter_name,
            c.display_name as confirmed_by
       from event_guestlist_entries g
       join events e on e.id = g.event_id
       join promoters p on p.id = g.promoter_id
       left join members m on m.id = g.member_id
       left join members c on c.id = g.confirmed_by_member_id
       left join venues v on v.id = e.venue_id
      where g.id = $1`,
    [entryId]
  );
  // No member means a name a promoter typed in themselves: there is nobody to
  // write to, and inventing a recipient would be worse than staying quiet.
  if (!row || !row.member_id || !row.email || row.status !== 'confirmed') return null;
  return {
    entryId: row.id,
    memberId: row.member_id,
    email: row.email,
    guestName: row.guest_name,
    places: 1 + row.plus_ones,
    eventTitle: row.title,
    eventSlug: row.slug,
    when: fmtEventDate(row.start_at, row.end_at, row.timezone),
    time: fmtEventTime(row.start_at, row.end_at, row.timezone),
    where: [row.venue_name, row.city].filter(Boolean).join(', ') || null,
    promoterName: row.promoter_name,
    confirmedBy: row.confirmed_by,
  };
}

export function guestlistEmailText(p: GuestlistPass): string {
  return [
    'YOU ARE ON THE GUESTLIST',
    '',
    p.eventTitle,
    [p.when, p.time].filter(Boolean).join(' · '),
    p.where ?? '',
    '',
    `${p.guestName} — ${p.places} ${p.places === 1 ? 'place' : 'places'}`,
    p.confirmedBy ? `Confirmed by ${p.confirmedBy} at ${p.promoterName}.` : `Confirmed by ${p.promoterName}.`,
    '',
    'Show this at the door:',
    doorUrl(p.entryId),
    '',
    'Bring ID with the name above. Arrive before the guestlist closes —',
    'a place is a place, not a queue jump.',
    '',
    `${SITE}/events/${p.eventSlug}`,
  ].join('\n');
}

export function guestlistEmailHtml(p: GuestlistPass): string {
  const pass = doorUrl(p.entryId);
  const places = `${p.places} ${p.places === 1 ? 'PLACE' : 'PLACES'}`;
  const confirmed = p.confirmedBy
    ? `Confirmed by ${p.confirmedBy} at ${p.promoterName}`
    : `Confirmed by ${p.promoterName}`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3eee1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee1;">
    <tr><td align="center" style="padding:0 14px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">

        <tr><td style="background:#0d0d0c;border-radius:0 0 14px 14px;padding:20px 26px;">
          <span style="font-size:15px;font-weight:800;letter-spacing:4px;color:#f5f1e6;">GUEST<span style="color:#c9a2e8;">LIST</span></span>
        </td></tr>

        <!-- The sentence this whole email exists to deliver. -->
        <tr><td style="padding:30px 0 0;">
          <div style="background:#0d0d0c;border-radius:16px;padding:34px 28px 30px;">
            <div style="font-size:11px;font-weight:800;letter-spacing:3px;color:#c9a2e8;text-transform:uppercase;">You're in</div>
            <div style="font-size:40px;line-height:1.02;font-weight:800;letter-spacing:-1.4px;color:#f5f1e6;margin-top:12px;">
              YOU ARE ON<br/>THE <span style="color:#c9a2e8;">GUESTLIST</span>
            </div>
            <div style="font-size:14px;color:#a9a294;margin-top:16px;line-height:1.5;">${esc(confirmed)}.</div>
          </div>
        </td></tr>

        <!-- The night. -->
        <tr><td style="padding:22px 4px 0;">
          <a href="${SITE}/events/${esc(p.eventSlug)}" style="text-decoration:none;color:#141414;">
            <div style="font-size:24px;font-weight:800;letter-spacing:-0.6px;color:#141414;line-height:1.2;">${esc(p.eventTitle)}</div>
          </a>
          <div style="font-size:14px;color:#6f6a5c;margin-top:8px;line-height:1.6;">
            ${esc(p.when)}${p.time ? ` · ${esc(p.time)}` : ''}${p.where ? `<br/>${esc(p.where)}` : ''}
          </div>
        </td></tr>

        <!-- The pass. The QR is the point; the link under it is what saves the
             night when a mail client refuses to load images. -->
        <tr><td style="padding:24px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4dcc8;border-radius:16px;background:#ffffff;">
            <tr><td align="center" style="padding:26px 22px 8px;">
              <div style="font-size:10.5px;font-weight:800;letter-spacing:2.4px;color:#9a7b1f;text-transform:uppercase;">Show this at the door</div>
              <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#141414;margin-top:12px;">${esc(p.guestName)}</div>
              <div style="font-size:12px;font-weight:800;letter-spacing:2px;color:#7c4a9e;margin-top:6px;">${places}</div>
            </td></tr>
            <tr><td align="center" style="padding:14px 22px 4px;">
              <img src="${qrUrl(p.entryId)}" width="200" height="200" alt="Door pass QR code"
                   style="display:block;width:200px;height:200px;border:0;image-rendering:pixelated;" />
            </td></tr>
            <tr><td align="center" style="padding:6px 22px 26px;">
              <a href="${pass}" style="font-size:11.5px;color:#7c4a9e;text-decoration:underline;">Open your pass</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:22px 6px 0;">
          <div style="font-size:12.5px;color:#6f6a5c;line-height:1.7;">
            Bring ID with the name on the pass. Arrive before the guestlist closes —
            a place is a place, not a queue jump. If your plans change, take yourself
            off so somebody else can have it.
          </div>
        </td></tr>

        <tr><td style="padding:22px 6px 0;border-top:1px solid #e4dcc8;margin-top:20px;">
          <div style="font-size:11px;color:#8a8574;line-height:1.7;padding-top:14px;">
            <a href="${SITE}/you/membership" style="color:#8a8574;">Your guestlist places</a>
            &nbsp;·&nbsp;
            <a href="${SITE}/events/${esc(p.eventSlug)}" style="color:#8a8574;">The event</a><br/>
            Guestlist — the best events for our community, not every event.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Send the pass. Idempotent per entry: a promoter who declines and re-approves
 * gets one email per confirmation, not one per button press.
 */
export async function sendGuestlistConfirmed(entryId: string): Promise<boolean> {
  const p = await passForEntry(entryId);
  if (!p) return false;
  const { outcome } = await queueEmail({
    recipientEmail: p.email,
    memberId: p.memberId,
    // Transactional: somebody who has stopped recommendation email still needs
    // to be told they have a place at a door tonight.
    emailType: 'notification:guestlist_confirmed',
    subject: `You are on the guestlist — ${p.eventTitle}`,
    bodyText: guestlistEmailText(p),
    bodyHtml: guestlistEmailHtml(p),
    dedupeKey: `guestlist_confirmed:${entryId}`,
  });
  return outcome === 'queued';
}
