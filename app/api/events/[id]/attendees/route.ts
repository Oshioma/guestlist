// Who's Going. Full member list requires sign-in — logged-out visitors get
// counts only (the UI shows avatars + a join prompt). This is deliberate:
// discover event → see who's going → join Guestlist.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
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
  // Annotate with the viewer's member-follow state so the UI can offer
  // Follow buttons (friend = mutual follow — shown as ✦ when both ways).
  const ids = [...going, ...interested].map((m) => m.id).filter((mid) => mid !== member.id);
  const follows = ids.length
    ? await query<{ entity_id: string; mutual: boolean }>(
        `select f1.entity_id,
                exists (select 1 from member_follows f2
                         where f2.member_id = f1.entity_id and f2.entity_type = 'member'
                           and f2.entity_id = $1) as mutual
           from member_follows f1
          where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = any($2)`,
        [member.id, ids]
      )
    : [];
  const followMap = new Map(follows.map((f) => [f.entity_id, f.mutual]));
  const annotate = <T extends { id: string }>(list: T[]) =>
    list.map((m) => ({
      ...m,
      is_me: m.id === member.id,
      following: followMap.has(m.id),
      is_friend: followMap.get(m.id) === true,
    }));

  return NextResponse.json({
    counts: { going: going.length, interested: interested.length },
    going: annotate(going),
    interested: annotate(interested),
  });
}
