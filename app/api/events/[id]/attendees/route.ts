// Who's Going. Full member list requires sign-in — logged-out visitors get
// counts only (the UI shows avatars + a join prompt). This is deliberate:
// discover event → see who's going → join Guestlist.

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { getGoingMembers } from '@/lib/events';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const event = await queryOne<{ id: string; status: string }>(
    `select id, status from events where id = $1 and status = 'live'`,
    [id]
  );
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const member = await getCurrentMember();
  const { going, interested } = await getGoingMembers(id);

  if (!member) {
    return NextResponse.json({
      counts: { going: going.length, interested: interested.length },
      memberOnly: true,
    });
  }
  return NextResponse.json({
    counts: { going: going.length, interested: interested.length },
    going,
    interested,
  });
}
