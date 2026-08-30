// Begin the X OAuth 2.0 (PKCE) connection for @guestlist. Admin-only.
// State + verifier are held server-side; the browser only sees the
// authorize redirect. Tokens never reach client code.

import { NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { buildAuthorizeUrl } from '@/lib/channels/x/oauth';
import { xAudit } from '@/lib/intelligence/core';

export async function POST() {
  try {
    const admin = await requireAdmin();
    const result = await buildAuthorizeUrl(admin.id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    await xAudit('oauth_started', { actorId: admin.id });
    return NextResponse.json({ url: result.url });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
