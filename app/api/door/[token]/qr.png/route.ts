// The QR code on the guestlist email, as an image a mail client will draw.
//
// Public on purpose: the token in the path IS the credential, and a mail
// client fetching an image never carries a session cookie. An unsigned or
// unknown token gets a 404 rather than a placeholder, so a guessed URL tells
// the guesser nothing.

import { NextRequest } from 'next/server';
import { doorUrl, entryFromToken } from '@/lib/doorPass';
import { encodeQr } from '@/lib/qr';
import { qrPng } from '@/lib/png';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const entryId = entryFromToken(token);
  if (!entryId) return new Response('Not found', { status: 404 });
  const png = qrPng(encodeQr(doorUrl(entryId)), 8, 4);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      // The code never changes for an entry, and mail clients cache
      // aggressively through their own proxies anyway.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(png.length),
    },
  });
}
