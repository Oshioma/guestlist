import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { createSession, setSessionCookie, verifyPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const isForm = (req.headers.get('content-type') ?? '').includes('form');
  const data = isForm
    ? Object.fromEntries((await req.formData()).entries())
    : await req.json().catch(() => ({}));

  const email = String(data.email ?? '').trim().toLowerCase();
  const password = String(data.password ?? '');
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const member = await queryOne<{ id: string; password_hash: string | null }>(
    'select id, password_hash from members where lower(email) = $1',
    [email]
  );
  if (!member || !verifyPassword(password, member.password_hash)) {
    return NextResponse.json({ error: 'Wrong email or password' }, { status: 401 });
  }

  const token = await createSession(member.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
