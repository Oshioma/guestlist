// Public member profile — WHO YOU ARE CULTURALLY before what your job
// title is. Every section respects the member's privacy flags; shared rave
// history is shown only when mutually visible.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { getPrivacy } from '@/lib/privacy';
import { connectionBetween, isBlockedEitherWay, isCloseFriend } from '@/lib/connections';
import { sharedHistory } from '@/lib/scene';
import { fmtEventDate } from '@/lib/util';
import { ConnectButton } from '@/components/v2c/ConnectButton';
import { MemberActions } from '@/components/v2c/MemberActions';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { isActiveMember } from '@/lib/membership';
import { MemberBadge } from '@/components/membership/MemberBadge';

export const dynamic = 'force-dynamic';

export default async function MemberProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getCurrentMember();

  const member = await queryOne<{
    id: string; display_name: string; slug: string; avatar_url: string | null;
    home_city: string | null; home_country: string | null; bio: string | null;
    raving_since: number | null; now_doing: string | null; looking_for: string | null;
    created_at: string;
  }>(
    `select id, display_name, slug, avatar_url, home_city, home_country, bio,
            raving_since, now_doing, looking_for, created_at::text
       from members where slug = $1`,
    [slug]
  );
  if (!member) notFound();
  const isSelf = viewer?.id === member.id;

  const privacy = await getPrivacy(member.id);
  if (!privacy.profile_public && !isSelf && viewer?.role !== 'admin') notFound();
  if (viewer && !isSelf && (await isBlockedEitherWay(viewer.id, member.id))) notFound();

  // GUESTLIST MEMBER — the badge, and only the badge, for now. "Member
  // since" and the rest of public identity are a deliberate later design.
  const guestlistMember = await isActiveMember(member.id);
  const [taste, history, upcoming, following, connection, viewerClose, shared, viewerBlocks] = await Promise.all([
    privacy.show_taste || isSelf
      ? query<{ name: string; slug: string }>(
          `select g.name, g.slug from member_genres mg join genres g on g.id = mg.genre_id
            where mg.member_id = $1 order by g.sort_order`,
          [member.id]
        )
      : Promise.resolve([]),
    privacy.show_history || isSelf
      ? query<{
          name: string; entity_type: string; city: string | null; country_name: string | null;
          from_year: number | null; to_year: number | null;
        }>(
          `select se.name, se.entity_type, se.city, se.country_name, h.from_year, h.to_year
             from member_scene_history h
             join scene_entities se on se.id = h.entity_id and se.status = 'approved'
            where h.member_id = $1 order by coalesce(h.from_year, 3000)`,
          [member.id]
        )
      : Promise.resolve([]),
    privacy.show_going || isSelf
      ? query<{ id: string; title: string; slug: string; start_at: string; end_at: string | null; timezone: string; city: string | null }>(
          `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone, e.city
             from member_event_actions mea join events e on e.id = mea.event_id
            where mea.member_id = $1 and mea.rsvp = 'going'
              and e.status = 'live' and e.start_at > now()
            order by e.start_at limit 6`,
          [member.id]
        )
      : Promise.resolve([]),
    query<{ entity_type: string; n: number }>(
      `select entity_type, count(*)::int as n from member_follows
        where member_id = $1 and entity_type <> 'member' group by entity_type`,
      [member.id]
    ),
    viewer && !isSelf ? connectionBetween(viewer.id, member.id) : Promise.resolve('none' as const),
    viewer && !isSelf ? isCloseFriend(viewer.id, member.id) : Promise.resolve(false),
    viewer && !isSelf ? sharedHistory(viewer.id, member.id) : Promise.resolve([]),
    viewer
      ? queryOne(`select 1 from member_blocks where blocker_id = $1 and blocked_id = $2`, [viewer.id, member.id])
      : Promise.resolve(null),
  ]);

  const pendingIn =
    connection === 'pending_in' && viewer
      ? await queryOne<{ id: string }>(
          `select id from member_connections where requester_id = $1 and addressee_id = $2 and status = 'pending'`,
          [member.id, viewer.id]
        )
      : null;

  const follows = Object.fromEntries(following.map((f) => [f.entity_type, f.n]));
  const showYears = privacy.show_history_years || isSelf;
  const location = [privacy.show_home_city || isSelf ? member.home_city : null,
                    privacy.show_home_city || isSelf ? member.home_country : null]
    .filter(Boolean).join(' / ');

  return (
    <main className="wrap profileWrap">
      <ClubTrack type="member_profile_viewed" />
      <div className="profileHead">
        {member.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profileAvatar" src={member.avatar_url} alt="" />
        ) : (
          <div className="profileAvatar profileAvatarFallback">{member.display_name[0]}</div>
        )}
        <div className="profileHeadBody">
          <h1 className="profileName">{member.display_name}</h1>
          {guestlistMember && <div style={{ margin: '0 0 8px' }}><MemberBadge /></div>}
          {location && <div className="profileLocation">{location}</div>}
          {member.raving_since && (
            <div className="profileRavingSince">{`Raving since ${member.raving_since}`}</div>
          )}
        </div>
        {viewer && !isSelf && (
          <div className="profileActions">
            <ConnectButton
              memberId={member.id}
              initialState={connection === 'blocked' ? 'blocked' : connection}
              connectionId={pendingIn?.id}
              isSignedIn
              initialClose={viewerClose}
            />
            <MemberActions memberId={member.id} blocked={!!viewerBlocks} />
          </div>
        )}
        {isSelf && <Link href="/you" className="btnGhost">Edit →</Link>}
      </div>

      {member.bio && <p className="prose profileBio">{member.bio}</p>}

      {shared.length > 0 && (
        <div className="sharedHistoryBox">
          <div className="sectionLabel">You may have crossed paths</div>
          {shared.map((s, i) => (
            <div key={i} className="sharedHistoryRow">
              ✦ Both went to <strong>{s.name}</strong>
              {s.overlap_from != null && (
                <> ({s.overlap_from}{s.overlap_to !== s.overlap_from ? `–${s.overlap_to}` : ''} overlap)</>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="profileGrid">
        {taste.length > 0 && (
          <section>
            <div className="sectionLabel">Music</div>
            <div className="chipRow">
              {taste.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="chip">{g.name}</Link>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section>
            <div className="sectionLabel">Rave history</div>
            {history.map((h, i) => (
              <div className="profileHistoryRow" key={i}>
                <strong>{h.name}</strong>
                <span className="youHistoryMeta">
                  {' '}{[h.city, h.country_name].filter(Boolean).join(' · ')}
                  {showYears && h.from_year &&
                    ` · ${h.from_year}${h.to_year && h.to_year !== h.from_year ? `–${h.to_year}` : ''}`}
                </span>
              </div>
            ))}
          </section>
        )}

        {upcoming.length > 0 && (
          <section>
            <div className="sectionLabel">Upcoming</div>
            {upcoming.map((e) => (
              <div className="profileHistoryRow" key={e.id}>
                <Link href={`/events/${e.slug}`}><strong>{e.title}</strong></Link>
                <span className="youHistoryMeta">
                  {' '}{fmtEventDate(e.start_at, e.end_at, e.timezone)}{e.city && ` · ${e.city}`}
                </span>
              </div>
            ))}
          </section>
        )}

        {(follows.promoter || follows.artist || follows.venue) && (
          <section>
            <div className="sectionLabel">Following</div>
            <div className="youHistoryMeta">
              {[
                follows.promoter && `${follows.promoter} promoter${follows.promoter === 1 ? '' : 's'}`,
                follows.artist && `${follows.artist} artist${follows.artist === 1 ? '' : 's'}`,
                follows.venue && `${follows.venue} venue${follows.venue === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
            </div>
          </section>
        )}

        {(member.now_doing || member.looking_for) && (
          <section>
            {member.now_doing && (
              <>
                <div className="sectionLabel">Now</div>
                <div className="youHistoryMeta">{member.now_doing}</div>
              </>
            )}
            {member.looking_for && (
              <>
                <div className="sectionLabel" style={{ marginTop: 10 }}>Looking for</div>
                <div className="youHistoryMeta">{member.looking_for}</div>
              </>
            )}
          </section>
        )}
      </div>

      {!viewer && (
        <div className="clubJoin" style={{ marginTop: 24 }}>
          <p>Join Guestlist to connect with people from your scene.</p>
          <Link href="/signup" className="btnAccent">Join Guestlist →</Link>
        </div>
      )}
    </main>
  );
}
