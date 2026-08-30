// Who's Going. Full member list requires sign-in — logged-out visitors get
// counts only (the UI shows avatars + a join prompt). This is deliberate:
// discover event → see who's going → join Guestlist.

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { getGoingMembers } from '@/lib/events';
import { friendPairSql } from '@/lib/clubmessenger';
import { closeFriendSql, connectedSql, notBlockedSql } from '@/lib/connections';

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
  // Annotate with the viewer's relationship to each attendee, filter out
  // hidden/blocked members, and order by social closeness:
  // connections → friends/shared history → shared music → everyone else.
  const ids = [...new Set([...going, ...interested].map((m) => m.id))].filter((mid) => mid !== member.id);
  const rels = ids.length
    ? await query<{
        id: string; following: boolean; is_friend: boolean; is_connected: boolean;
        is_close: boolean; shared_history: boolean; shared_music: boolean; visible: boolean;
      }>(
        `select m.id,
                exists (select 1 from member_follows f1
                         where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = m.id) as following,
                ${friendPairSql('$1', 'm.id')} as is_friend,
                ${connectedSql('$1', 'm')} as is_connected,
                ${closeFriendSql('$1', 'm')} as is_close,
                exists (select 1 from member_scene_history ha
                          join member_scene_history hb on hb.entity_id = ha.entity_id and hb.member_id = m.id
                          join scene_entities se on se.id = ha.entity_id and se.status = 'approved'
                         where ha.member_id = $1
                           and coalesce((select mp.show_history from member_privacy mp where mp.member_id = m.id), true)
                           and coalesce((select mp.show_history from member_privacy mp where mp.member_id = $1), true)
                ) as shared_history,
                exists (select 1 from member_genres mga
                          join member_genres mgb on mgb.genre_id = mga.genre_id and mgb.member_id = m.id
                         where mga.member_id = $1
                           and coalesce((select mp.show_taste from member_privacy mp where mp.member_id = m.id), true)
                ) as shared_music,
                (coalesce((select mp.show_going and mp.profile_public
                             from member_privacy mp where mp.member_id = m.id), true)
                 and ${notBlockedSql('$1', 'm')}) as visible
           from members m where m.id = any($2)`,
        [member.id, ids]
      )
    : [];
  const relMap = new Map(rels.map((r) => [r.id, r]));

  const rank = (id: string) => {
    const r = relMap.get(id);
    if (!r) return 6;
    if (r.is_close) return 0; // close friends above everything
    if (r.is_connected) return 1;
    if (r.is_friend) return 2;
    if (r.shared_history) return 3;
    if (r.shared_music) return 4;
    return 5;
  };
  const annotate = <T extends { id: string }>(list: T[]) =>
    list
      .filter((m) => m.id === member.id || (relMap.get(m.id)?.visible ?? true))
      .map((m) => ({
        ...m,
        is_me: m.id === member.id,
        following: relMap.get(m.id)?.following ?? false,
        is_friend: relMap.get(m.id)?.is_friend ?? false,
        is_connected: relMap.get(m.id)?.is_connected ?? false,
        is_close: relMap.get(m.id)?.is_close ?? false,
      }))
      .sort((a, b) => rank(a.id) - rank(b.id));

  return NextResponse.json({
    counts: { going: going.length, interested: interested.length },
    going: annotate(going),
    interested: annotate(interested),
  });
}
