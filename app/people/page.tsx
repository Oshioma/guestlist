// PEOPLE — discovery through shared culture, never a giant directory.
// Every person shown comes with the REASON they're relevant. Privacy: only
// discoverable members appear, blocks exclude both ways, and reasons use
// mutually visible signals only.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { peopleFromScene, peopleYouMayHaveDancedWith, sceneReasons } from '@/lib/scene';
import { listConnections } from '@/lib/connections';
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

function PersonCard({ p, reasons, isSignedIn }: { p: PersonRow | { id: string; display_name: string; slug: string | null; avatar_url: string | null; home_city: string | null }; reasons: string[]; isSignedIn: boolean }) {
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
      <ConnectButton memberId={p.id} initialState="none" isSignedIn={isSignedIn} compact />
    </div>
  );
}

export default async function PeoplePage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/people');

  const [danced, scenePeople, connections, sameEvents, recent] = await Promise.all([
    peopleYouMayHaveDancedWith(member.id, 6),
    peopleFromScene(member.id, { limit: 12 }),
    listConnections(member.id),
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
  ]);

  const sceneIds = new Set(scenePeople.map((p) => p.id));

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
              <PersonCard key={p.id} p={p} reasons={sceneReasons(p)} isSignedIn />
            ))}
          </div>
        </section>
      )}

      {sameEvents.filter((p) => !sceneIds.has(p.id)).length > 0 && (
        <section>
          <div className="sectionLabel">Going to the same events</div>
          <div className="peopleGrid">
            {sameEvents.filter((p) => !sceneIds.has(p.id)).map((p) => (
              <PersonCard key={p.id} p={p} reasons={[`Also going to ${p.event_title}`]} isSignedIn />
            ))}
          </div>
        </section>
      )}

      {recent.filter((p) => !sceneIds.has(p.id)).length > 0 && (
        <section>
          <div className="sectionLabel">Recently joined</div>
          <div className="peopleGrid">
            {recent.filter((p) => !sceneIds.has(p.id)).map((p) => (
              <PersonCard key={p.id} p={p} reasons={['New to Guestlist']} isSignedIn />
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
