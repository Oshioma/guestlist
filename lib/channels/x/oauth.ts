// X OAUTH 2.0 (Authorization Code + PKCE) — user context for @guestlist.
//
// Scopes: tweet.read tweet.write users.read offline.access media.write
// (offline.access issues the refresh token that keeps the connection
// alive). State + code verifier are held server-side and expire quickly;
// tokens are stored encrypted and never exposed to browser code.
//
// Reconnection/revocation: if X revokes access or the refresh token dies,
// the account row flips to status='error' with the reason, and the desk
// shows RECONNECT — which simply runs this flow again.

import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne } from '../../db';
import { getSetting, setSetting } from '../../settings';
import { encryptToken } from './client';

const SITE = process.env.SITE_URL ?? 'https://www.clubguestlists.com';
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];

function redirectUri(): string {
  return process.env.X_REDIRECT_URI ?? `${SITE}/api/admin/x/oauth/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function buildAuthorizeUrl(adminId: string): Promise<{ url: string } | { error: string }> {
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) return { error: 'X_CLIENT_ID is not configured' };
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await setSetting('x_oauth_pending', {
    state, verifier, admin: adminId, created_at: new Date().toISOString(),
  }, adminId);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: X_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `https://x.com/i/oauth2/authorize?${params}` };
}

export async function handleOAuthCallback(code: string, state: string): Promise<{ ok: true; handle: string } | { error: string }> {
  const pending = await getSetting<{ state: string; verifier: string; admin: string; created_at: string }>('x_oauth_pending');
  // State must match and be fresh — CSRF protection for the callback.
  if (!pending || pending.state !== state) return { error: 'OAuth state mismatch' };
  if (Date.now() - new Date(pending.created_at).getTime() > 10 * 60_000) {
    return { error: 'OAuth state expired — start the connection again' };
  }
  await setSetting('x_oauth_pending', null, pending.admin);

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId) return { error: 'X_CLIENT_ID is not configured' };

  const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(clientSecret
        ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }
        : {}),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
      client_id: clientId,
    }),
  });
  const tokens = await tokenRes.json().catch(() => null) as {
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
  } | null;
  if (!tokenRes.ok || !tokens?.access_token) {
    return { error: `Token exchange failed (${tokenRes.status})` };
  }

  const meRes = await fetch('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json().catch(() => null) as { data?: { id: string; username: string } } | null;
  const handle = me?.data?.username ?? 'guestlist';

  await query(
    `insert into social_accounts
       (platform, handle, external_user_id, access_token_enc, refresh_token_enc,
        token_expires_at, scopes, status, connected_by, connected_at, last_error)
     values ('x', $1, $2, $3, $4, $5, $6, 'connected', $7, now(), null)
     on conflict (platform) do update set
       handle = $1, external_user_id = $2, access_token_enc = $3,
       refresh_token_enc = $4, token_expires_at = $5, scopes = $6,
       status = 'connected', connected_by = $7, connected_at = now(), last_error = null`,
    [handle, me?.data?.id ?? null,
     encryptToken(tokens.access_token),
     tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
     tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
     (tokens.scope ?? X_SCOPES.join(' ')).split(' '),
     pending.admin]
  );
  return { ok: true, handle };
}

export async function disconnectX(): Promise<void> {
  await queryOne(
    `update social_accounts set status = 'disconnected',
            access_token_enc = null, refresh_token_enc = null
      where platform = 'x' returning id`
  );
}
