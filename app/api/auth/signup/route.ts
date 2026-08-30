import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { createSession, hashPassword, setSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const email = String(data.email ?? '').trim().toLowerCase();
  const password = String(data.password ?? '');
  const displayName = String(data.displayName ?? '').trim();
  const homeCity = String(data.homeCity ?? '').trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: 'A display name is required' }, { status: 400 });
  }

  const existing = await queryOne('select 1 from members where lower(email) = $1', [email]);
  if (existing) {
    return NextResponse.json({ error: 'That email is already registered' }, { status: 409 });
  }

  const member = await queryOne<{ id: string }>(
    `insert into members (email, password_hash, display_name, home_city)
     values ($1, $2, $3, $4) returning id`,
    [email, hashPassword(password), displayName, homeCity]
  );

  const token = await createSession(member!.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
