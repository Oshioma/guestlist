// One endpoint for the member's own controls: profile fields, privacy
// flags, email preferences.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireMember } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  getEmailPrefs, getPrivacy, updateEmailPrefs, updatePrivacy,
} from '@/lib/privacy';

export async function GET() {
  try {
    const member = await requireMember();
    const [privacy, emailPrefs, profile] = await Promise.all([
      getPrivacy(member.id),
      getEmailPrefs(member.id),
      query<{ bio: string | null; raving_since: number | null; now_doing: string | null; looking_for: string | null; slug: string | null }>(
        `select bio, raving_since, now_doing, looking_for, slug from members where id = $1`,
        [member.id]
      ).then((r) => r[0]),
    ]);
    return NextResponse.json({ privacy, emailPrefs, profile });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const member = await requireMember();
    const body = await req.json().catch(() => ({}));
    if (body.privacy && typeof body.privacy === 'object') {
      await updatePrivacy(member.id, body.privacy);
    }
    if (body.emailPrefs && typeof body.emailPrefs === 'object') {
      await updateEmailPrefs(member.id, body.emailPrefs);
    }
    if (body.profile && typeof body.profile === 'object') {
      const p = body.profile;
      const clean = (v: unknown, max: number) =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
      const year = Number(p.ravingSince);
      await query(
        `update members set
           bio = case when $2::boolean then $3 else bio end,
           raving_since = case when $4::boolean then $5 else raving_since end,
           now_doing = case when $6::boolean then $7 else now_doing end,
           looking_for = case when $8::boolean then $9 else looking_for end
         where id = $1`,
        [member.id,
         'bio' in p, clean(p.bio, 600),
         'ravingSince' in p, Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null,
         'nowDoing' in p, clean(p.nowDoing, 160),
         'lookingFor' in p, clean(p.lookingFor, 160)]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
