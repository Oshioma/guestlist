// X OAuth callback — state-checked (CSRF), admin-session-checked, tokens
// exchanged server-side and stored encrypted. Redirects back to the desk.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { handleOAuthCallback } from '@/lib/channels/x/oauth';
import { xAudit } from '@/lib/intelligence/core';

export async function GET(req: NextRequest) {
  const member = await getCurrentMember();
  if (member?.role !== 'admin') {
    return NextResponse.redirect(new URL('/login?next=/admin/guestlist-x', req.url));
  }
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect(new URL('/admin/guestlist-x?tab=settings&x=denied', req.url));
  }
  const result = await handleOAuthCallback(code, state);
  if ('error' in result) {
    await xAudit('oauth_failed', { actorId: member.id, detail: result.error });
    return NextResponse.redirect(
      new URL(`/admin/guestlist-x?tab=settings&x=error&reason=${encodeURIComponent(result.error)}`, req.url));
  }
  await xAudit('oauth_connected', { actorId: member.id, detail: `@${result.handle}` });
  return NextResponse.redirect(new URL('/admin/guestlist-x?tab=settings&x=connected', req.url));
}
