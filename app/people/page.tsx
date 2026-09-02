// PEOPLE — discovery through shared culture, never a giant directory.
// Every person shown comes with the REASON they're relevant. Privacy: only
// discoverable members appear, blocks exclude both ways, and reasons use
// mutually visible signals only.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { peopleFromScene, peopleYouMayHaveDancedWith, sceneReasons, yourPeopleUpcoming } from '@/lib/scene';
import { listConnections } from '@/lib/connections';
import { followedArtists } from '@/lib/profiles';
import { discoverableSql } from '@/lib/privacy';
import { notBlockedSql, connectedSql } from '@/lib/connections';
import { ConnectButton } from '@/components/v2c/ConnectButton';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';

export const dynamic = 'force-dynamic';

type PersonRow = {
  id: string;
  display_name: string;
  slug: string | null;
  avatar_url: string | null;
  home_city: string | null;
  reason: string;
};

type CardRelation = { state: 'none' | 'pending_out' | 'pending_in'; connectionId?: string | null };

function PersonCard({ p, reasons, isSignedIn, relation }: { p: PersonRow | { id: string; display_name: string; slug: string | null; avatar_url: string | null; home_city: string | null }; reasons: string[]; isSignedIn: boolean; relation?: CardRelation }) {
  return (
    <div className="personCard">
      <Link href={`/members/${p.slug}`} className="personCardMain">
        {p.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="personAvatar" src={p.avatar_url} alt="" />
        ) : (
          <span className="personAvatar personAvatarFallback">{p.display_name[0]}</span>
        )}
        <span className="personCardBody">
          <span className="personName">{p.display_name}</span>
          {p.home_city && <span className="personStatus">Now in {p.home_city}</span>}
          {reasons.map((r, i) => (
            <span className="personReason" key={i}>{r}</span>
          ))}
        </span>
      </Link>
      <ConnectButton memberId={p.id} initialState={relation?.state ?? 'none'}
                     connectionId={relation?.connectionId} isSignedIn={isSignedIn} compact />
    </div>
  );
}

export default async function PeoplePage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/people');

  const [danced, scenePeople, connections, peoplePlans, sameEvents, recent, artists] = await Promise.all([
    peopleYouMayHaveDancedWith(member.id, 6),
    peopleFromScene(member.id, { limit: 12 }),
    listConnections(member.id),
    yourPeopleUpcoming(member.id, { to: new Date(Date.now() + 30 * 86400_000), limit: 30 }),
    query<PersonRow & { event_title: string }>(
      `select distinct on (m.id) m.id, m.display_name, m.slug, m.avatar_url,
              case when coalesce(mp.show_home_city, true) then m.home_city end as home_city,
              e.title as event_title, '' as reason
         from member_event_actions mine
         join member_event_actions theirs
           on theirs.event_id = mine.event_id and theirs.rsvp = 'going' and theirs.member_id <> $1
         join members m on m.id = theirs.member_id
         join events e on e.id = mine.event_id and e.status = 'live' and e.start_at > now()
         left join member_privacy mp on mp.member_id = m.id
        where mine.member_id = $1 and mine.rsvp = 'going'
          and coalesce(mp.show_going, true)
          and ${discoverableSql('m')} and ${notBlockedSql('$1', 'm')}
          and not ${connectedSql('$1', 'm')}
        limit 8`,
      [member.id]
    ),
    query<PersonRow>(
      `select m.id, m.display_name, m.slug, m.avatar_url,
              case when coalesce(mp.show_home_city, true) then m.home_city end as home_city,
              '' as reason
         from members m
         left join member_privacy mp on mp.member_id = m.id
        where m.id <> $1 and ${discoverableSql('m')} and ${notBlockedSql('$1', 'm')}
          and not ${connectedSql('$1', 'm')}
          and m.created_at > now() - interval '60 days'
        order by m.created_at desc limit 6`,
      [member.id]
    ),
    followedArtists(member.id),
  ]);

  const sceneIds = new Set(scenePeople.map((p) => p.id));
  // Real relationship state for every card — a sent request shows PENDING,
  // an incoming one shows Accept/Decline, never a dead-end CONNECT button.
  const relationFor = new Map<string, CardRelation>();
  for (const c of connections.pendingOut) relationFor.set(c.member_id, { state: 'pending_out' });
  for (const c of connections.pendingIn) {
    relationFor.set(c.member_id, { state: 'pending_in', connectionId: c.connection_id });
  }
  // CLOSE FRIENDS — private to this member. Nobody else ever sees who is
  // starred, and the starred person is never notified.
  const closeFriends = connections.connected.filter((c) => c.is_close);
  // The rest of the connections — discovery sections below exclude people
  // you're already connected with, so without this list a friend would
  // disappear from /people the moment you connect.
  const otherConnections = connections.connected.filter((c) => !c.is_close);
  const plansByMember = new Map<string, typeof peoplePlans>();
  for (const plan of peoplePlans) {
    const list = plansByMember.get(plan.member_id) ?? [];
    list.push(plan);
    plansByMember.set(plan.member_id, list);
  }

  return (
    <main className="wrap peopleWrap">
      <ClubTrack type="scene_people_impression" />
      <h1 className="pageTitle">People</h1>
      <p className="pageStandfirst">
        The people who were in the same rooms, on the same dance floors, into
        the same music — then and now.
      </p>

      {connections.pendingIn.length > 0 && (
        <section className="youPanel">
          <div className="sectionLabel">Connection requests</div>
          {connections.pendingIn.map((c) => (
            <div className="personCard" key={c.connection_id}>
              <Link href={`/members/${c.slug}`} className="personCardMain">
                {c.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="personAvatar" src={c.avatar_url} alt="" />
                ) : (
                  <span className="personAvatar personAvatarFallback">{c.display_name[0]}</span>
                )}
                <span className="personCardBody">
                  <span className="personName">{c.display_name}</span>
                  {c.home_city && <span className="personStatus">{c.home_city}</span>}
                </span>
              </Link>
              <ConnectButton
                memberId={c.member_id} initialState="pending_in"
                connectionId={c.connection_id} isSignedIn compact
              />
            </div>
          ))}
        </section>
      )}

      {closeFriends.length > 0 && (
        <section className="youPanel">
          <div className="sectionLabel">{`★ Close friends (${closeFriends.length})`}</div>
          <p className="youPanelSub" style={{ marginTop: 0 }}>
            Only you can see this list. Close friends rank first in your
            recommendations, Who’s Going and alerts.
          </p>
          <div className="peopleGrid">
            {closeFriends.map((c) => {
              const plans = plansByMember.get(c.member_id) ?? [];
              return (
                <div className="personCard" key={c.member_id}>
                  <Link href={`/members/${c.slug}`} className="personCardMain">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="personAvatar" src={c.avatar_url} alt="" />
                    ) : (
                      <span className="personAvatar personAvatarFallback">{c.display_name[0]}</span>
                    )}
                    <span className="personCardBody">
                      <span className="personName">{`★ ${c.display_name}`}</span>
                      {c.home_city && <span className="personStatus">{c.home_city}</span>}
                      {plans.slice(0, 2).map((plan) => (
                        <span className="personReason" key={plan.event_id}>
                          {plan.i_am_going ? `Both going: ${plan.title}` : `Going: ${plan.title}`}
                        </span>
                      ))}
                      {plans.length === 0 && <span className="personReason">No visible plans yet</span>}
                    </span>
                  </Link>
                  <ConnectButton memberId={c.member_id} initialState="connected"
                                 isSignedIn compact initialClose />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {otherConnections.length > 0 && (
        <section className="youPanel">
          <div className="sectionLabel">{`Your people (${connections.connected.length})`}</div>
          <p className="youPanelSub" style={{ marginTop: 0 }}>
            Everyone you’re connected with. Star the ones you never miss a
            night with — only you can see the stars.
          </p>
          <div className="peopleGrid">
            {otherConnections.map((c) => {
              const plans = plansByMember.get(c.member_id) ?? [];
              return (
                <div className="personCard" key={c.member_id}>
                  <Link href={`/members/${c.slug}`} className="personCardMain">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="personAvatar" src={c.avatar_url} alt="" />
                    ) : (
                      <span className="personAvatar personAvatarFallback">{c.display_name[0]}</span>
                    )}
                    <span className="personCardBody">
                      <span className="personName">{c.display_name}</span>
                      {c.home_city && <span className="personStatus">{c.home_city}</span>}
                      {plans.slice(0, 2).map((plan) => (
                        <span className="personReason" key={plan.event_id}>
                          {plan.i_am_going ? `Both going: ${plan.title}` : `Going: ${plan.title}`}
                        </span>
                      ))}
                    </span>
                  </Link>
                  <ConnectButton memberId={c.member_id} initialState="connected" isSignedIn compact />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {danced.length > 0 && (
        <section className="dancedWith">
          <h2 className="dancedTitle">People you may have danced with</h2>
          <div className="dancedGrid">
            {danced.map((d) => (
              <Link href={`/members/${d.slug}`} className="dancedCard" key={d.id}>
                {d.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="dancedAvatar" src={d.avatar_url} alt="" />
                ) : (
                  <span className="dancedAvatar personAvatarFallback">{d.display_name[0]}</span>
                )}
                <span className="dancedName">{d.display_name}</span>
                <span className="dancedWhere">
                  {d.entity_name}
                  {d.overlap_from != null && (
                    <> · {d.overlap_from}{d.overlap_to !== d.overlap_from ? `–${d.overlap_to}` : ''}</>
                  )}
                </span>
              </Link>
            ))}
          </div>
          <p className="dancedFoot">
            Based on shared rave history — you may have crossed paths.
          </p>
        </section>
      )}

      {scenePeople.length > 0 && (
        <section>
          <div className="sectionLabel">From your scene</div>
          <div className="peopleGrid">
            {scenePeople.map((p) => (
              <PersonCard key={p.id} p={p} reasons={sceneReasons(p)} isSignedIn relation={relationFor.get(p.id)} />
            ))}
          </div>
        </section>
      )}

      {sameEvents.filter((p) => !sceneIds.has(p.id)).length > 0 && (
        <section>
          <div className="sectionLabel">Going to the same events</div>
          <div className="peopleGrid">
            {sameEvents.filter((p) => !sceneIds.has(p.id)).map((p) => (
              <PersonCard key={p.id} p={p} reasons={[`Also going to ${p.event_title}`]} isSignedIn relation={relationFor.get(p.id)} />
            ))}
          </div>
        </section>
      )}

      {recent.filter((p) => !sceneIds.has(p.id)).length > 0 && (
        <section>
          <div className="sectionLabel">Recently joined</div>
          <div className="peopleGrid">
            {recent.filter((p) => !sceneIds.has(p.id)).map((p) => (
              <PersonCard key={p.id} p={p} reasons={['New to Guestlist']} isSignedIn relation={relationFor.get(p.id)} />
            ))}
          </div>
        </section>
      )}

      {/* ARTISTS, UNDER THE PEOPLE.
          One follower is the bar. An artist nobody follows is a name that
          arrived attached to an event listing, and a directory of those is a
          phone book; the moment somebody cares, they are part of this scene. */}
      {artists.length > 0 && (
        <section>
          <div className="sectionLabel">Artists people follow</div>
          <div className="artistFollowGrid">
            {artists.map((a) => (
              <Link key={a.id} href={`/artists/${a.slug}`} className="artistFollowCard">
                {a.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="artistFollowArt" src={a.image_url} alt="" />
                  : <span className="artistFollowArt artistFollowBlank" aria-hidden>{a.name.charAt(0)}</span>}
                <span className="artistFollowBody">
                  <span className="artistFollowName">{a.name}</span>
                  <span className="artistFollowMeta">
                    {`${a.follower_count} follower${a.follower_count === 1 ? '' : 's'}`}
                    {a.upcoming_count > 0 && ` · ${a.upcoming_count} coming up`}
                  </span>
                  {a.following && <span className="artistFollowYou">You follow them</span>}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {danced.length === 0 && scenePeople.length === 0 && (
        <div className="clubJoin">
          <p>Your scene isn’t here yet — but it will be.</p>
          <p style={{ color: 'var(--text-muted)' }}>
            Add your rave history and music taste so we can find the people
            you shared dance floors with.
          </p>
          <Link href="/you#history" className="btnAccent">Add your rave history →</Link>
        </div>
      )}
    </main>
  );
}
