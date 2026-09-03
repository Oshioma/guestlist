// One-click unsubscribe — no login required, secured by an HMAC token
// bound to (member, scope). Updates both the suppression ledger and the
// member's stored preferences so the UI reflects reality.

import { NextRequest, NextResponse } from 'next/server';
import { BRAND } from '@/lib/emailBrand';
import { query, queryOne } from '@/lib/db';
import { suppress, verifyUnsubscribeToken } from '@/lib/email';
import { updateEmailPrefs } from '@/lib/privacy';
import { track } from '@/lib/analytics';

const SCOPES = ['all', 'recommendations', 'alerts', 'weekly_digest', 'reminders', 'promoter_digest'];

const SCOPE_PREF_PATCH: Record<string, Record<string, boolean>> = {
  recommendations: {
    weekly_digest: false, followed_promoter_events: false, followed_venue_events: false,
    followed_artist_events: false, genre_in_home_city: false, travel_events: false,
    connection_going: false,
  },
  alerts: {
    followed_promoter_events: false, followed_venue_events: false,
    followed_artist_events: false, genre_in_home_city: false, travel_events: false,
    connection_going: false,
  },
  weekly_digest: { weekly_digest: false },
  reminders: { event_reminders: false },
};

// Somebody arriving here has come straight from an inbox, so it looks like
// the email did and like the site does. It cannot be a normal page: an
// unsubscribe link has to work with no session and no JavaScript.
function page(title: string, body: string, ok: boolean): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title} — Guestlist</title></head>
     <body style="margin:0;background:${BRAND.page};color:${BRAND.ink};font-family:${BRAND.font};">
       <div style="max-width:520px;margin:0 auto;padding:44px 18px;">
         <div style="background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:18px;padding:30px 28px 34px;">
           <a href="/" style="text-decoration:none;"><img src="/brand/Guestlist_purple_300dpi.png" width="176" height="18" alt="GUESTLIST"
                style="display:block;border:0;height:18px;width:176px;font-size:15px;font-weight:800;letter-spacing:4px;color:${BRAND.accent};" /></a>
           <h1 style="font-size:26px;font-weight:800;letter-spacing:-0.6px;margin:24px 0 10px;">${title}</h1>
           <p style="color:${BRAND.soft};line-height:1.65;margin:0;">${body}</p>
           <p style="margin:24px 0 0;"><a href="/you/profile#settings" style="color:${BRAND.accentInk};font-weight:650;">Manage all email settings →</a></p>
         </div>
       </div>
     </body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get('m') ?? '';
  const scope = req.nextUrl.searchParams.get('s') ?? '';
  const token = req.nextUrl.searchParams.get('t') ?? '';

  if (!SCOPES.includes(scope) || !/^[0-9a-f-]{36}$/.test(memberId)
      || !verifyUnsubscribeToken(memberId, scope, token)) {
    return page('That link didn’t work', 'The unsubscribe link is invalid or has expired. You can manage every email preference from your account settings.', false);
  }
  const member = await queryOne<{ email: string }>(`select email from members where id = $1`, [memberId]);
  if (!member) {
    return page('That link didn’t work', 'We couldn’t find this account.', false);
  }
  await suppress(member.email, scope, 'unsubscribe', memberId);
  const patch = SCOPE_PREF_PATCH[scope];
  if (patch) await updateEmailPrefs(memberId, patch);
  if (scope === 'all') {
    await updateEmailPrefs(memberId, SCOPE_PREF_PATCH.recommendations);
    await query(`update member_email_prefs set event_reminders = false where member_id = $1`, [memberId]);
  }
  await track('email_unsubscribed', { memberId, metadata: { scope } });
  const what =
    scope === 'weekly_digest' ? 'the weekly digest' :
    scope === 'reminders' ? 'event reminders' :
    scope === 'alerts' ? 'event alerts' :
    scope === 'promoter_digest' ? 'promoter digests' :
    scope === 'all' ? 'all Guestlist email' : 'Guestlist recommendations';
  return page('Done — you’re unsubscribed', `You won’t receive ${what} any more. Essential account and team email is unaffected. Changed your mind? Everything can be switched back on in settings.`, true);
}
