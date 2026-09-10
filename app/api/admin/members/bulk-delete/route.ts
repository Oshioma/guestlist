// ADMIN → remove several accounts at once.
//
// Deleting scripted signups one at a time is a job nobody finishes, so they go
// together. Each one still goes through deleteMember, which means every guard
// still applies — an admin cannot be deleted, nobody can delete themselves,
// and every removal is written to the audit log individually.
//
// One failure does not stop the rest: the reply says what went and what did
// not, and why, so a batch with one protected account in it still does the
// other forty-nine.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { deleteMember, MemberDeleteError } from '@/lib/memberDelete';

const MAX = 200;

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((i): i is string => typeof i === 'string' && /^[0-9a-f-]{36}$/.test(i)).slice(0, MAX)
      : [];
    if (!ids.length) return NextResponse.json({ error: 'Nothing selected' }, { status: 400 });

    const deleted: string[] = [];
    const kept: { id: string; why: string }[] = [];
    for (const id of ids) {
      try {
        const gone = await deleteMember(id, admin.id);
        deleted.push(gone.display_name);
      } catch (err) {
        kept.push({ id, why: err instanceof MemberDeleteError ? err.message : 'Could not delete that one' });
      }
    }
    return NextResponse.json({ ok: true, deleted: deleted.length, names: deleted.slice(0, 20), kept });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
