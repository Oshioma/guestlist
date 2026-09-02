// ADMIN → one member. Delete only: everything else about a person is edited
// by the person, and an admin reaching into somebody's profile is a different
// conversation from removing an account that should not exist.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { deleteMember, MemberDeleteError } from '@/lib/memberDelete';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const gone = await deleteMember(id, admin.id);
    return NextResponse.json({ ok: true, deleted: gone.display_name });
  } catch (err) {
    if (err instanceof MemberDeleteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: 'Could not delete that member' }, { status: 500 });
  }
}
