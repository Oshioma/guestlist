// One-click unsubscribe — no login required, secured by an HMAC token
// bound to (member, scope). Updates both the suppression ledger and the
// member's stored preferences so the UI reflects reality.

import { NextRequest, NextResponse } from 'next/server';
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

function page(title: string, body: string, ok: boolean): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title></head>
     <body style="margin:0;background:#0d0d0c;color:#f5f1e6;font-family:-apple-system,Segoe UI,sans-serif;">
       <div style="max-width:480px;margin:0 auto;padding:60px 24px;">
         <div style="font-weight:800;letter-spacing:4px;font-size:15px;">GUEST<span style="color:#f2c94c;">LIST</span></div>
         <h1 style="font-size:26px;letter-spacing:-0.5px;margin:26px 0 10px;">${title}</h1>
         <p style="color:#b9b3a2;line-height:1.6;">${body}</p>
         <p style="margin-top:26px;"><a href="/you" style="color:#f2c94c;">Manage all email settings →</a></p>
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
