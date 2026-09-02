// JOIN THE WAITLIST — before payments are live. A signed-in member joins
// with one press; a visitor leaves an email. Idempotent per address.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getCurrentMember } from '@/lib/auth';
import { joinWaitlist } from '@/lib/membership';

// Cheap per-IP brake so the form cannot be used to fill the table.
const recent = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 3600_000);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > 20;
}

export async function POST(req: NextRequest) {
  try {
    const member = await getCurrentMember();
    const body = await req.json().catch(() => ({})) as { email?: unknown; source?: unknown };
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    if (!member && tooMany(ip)) return NextResponse.json({ error: 'Too many attempts — try again later' }, { status: 429 });
    const email = member?.email ?? (typeof body.email === 'string' ? body.email : '');
    const source = typeof body.source === 'string' ? body.source.slice(0, 40) : 'membership_page';
    const outcome = await joinWaitlist(email, member?.id ?? null, source);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
