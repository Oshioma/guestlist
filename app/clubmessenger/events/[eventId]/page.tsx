// One event's live layer: presence, who's here/going, pings, room chat.
// Room access (Going, present tonight, or admin) is enforced by
// canAccessRoom here AND in every API route — the page is a view, not the
// security boundary.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import {
  CLUB_LIMITS,
  canAccessRoom,
  peopleAtEvent,
} from '@/lib/clubmessenger';
import { heatForEvents, heatLabel } from '@/lib/heat';
import { fmtEventDate, fmtEventTime } from '@/lib/util';
import { AutoRefresh } from '@/components/clubmessenger/AutoRefresh';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { PresenceControls } from '@/components/clubmessenger/PresenceControls';
import { RoomChat } from '@/components/clubmessenger/RoomChat';
import { PeopleList } from '@/components/clubmessenger/PeopleList';
import { PingInbox } from '@/components/clubmessenger/PingInbox';
import { GoingCta } from '@/components/clubmessenger/GoingCta';

export const dynamic = 'force-dynamic';

type EventRow = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  listing_status: string;
  ticket_url: string | null;
  primary_image_url: string | null;
  venue_name: string | null;
};

export default async function ClubEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const member = await getCurrentMember();

  const event = await queryOne<EventRow>(
    `select e.id, e.title, e.slug, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.listing_status, e.ticket_url, e.primary_image_url,
            v.name as venue_name
       from events e left join venues v on v.id = e.venue_id
      where e.id = $1 and e.status = 'live'`,
    [eventId]
  );
  if (!event) notFound();
  const cancelled = event.listing_status === 'cancelled';

  const now = Date.now();
  const start = new Date(event.start_at).getTime();
  const end = event.end_at
    ? new Date(event.end_at).getTime()
    : start + 6 * 3600_000;
  const inWindow =
    start < now + 24 * 3600_000 &&
    end + CLUB_LIMITS.presenceGraceHours * 3600_000 > now;

  const [access, people, myPresence, incomingPings, sentPings] = member
    ? await Promise.all([
        canAccessRoom(member.id, event.id, member.role === 'admin'),
        peopleAtEvent(member.id, event.id),
        queryOne<{ visibility: 'friends' | 'event' | 'invisible'; status: string | null }>(
          `select visibility, status from event_presence
            where member_id = $1 and event_id = $2 and left_at is null and expires_at > now()`,
          [member.id, event.id]
        ),
        query<{ id: string; from_name: string }>(
          `select cp.id, m.display_name as from_name
             from club_pings cp join members m on m.id = cp.from_member
            where cp.to_member = $1 and cp.event_id = $2 and cp.responded_at is null
              and cp.created_at > now() - interval '6 hours'
            order by cp.created_at desc limit 10`,
          [member.id, event.id]
        ),
        query<{ to_member: string; responded_at: string | null; response: string | null }>(
          `select to_member, responded_at::text, response from club_pings
            where from_member = $1 and event_id = $2
              and created_at > now() - interval '12 hours'`,
          [member.id, event.id]
        ),
      ])
    : [false, [], null, [], []];

  const initialMessages =
    member && access && !cancelled
      ? (
          await query<{
            id: string; body: string; created_at: string; member_id: string;
            display_name: string; avatar_url: string | null;
          }>(
            `select msg.id, msg.body, msg.created_at::text, msg.member_id,
                    m.display_name, m.avatar_url
               from event_room_messages msg join members m on m.id = msg.member_id
              where msg.event_id = $1 and msg.deleted_at is null
              order by msg.created_at desc limit 100`,
            [event.id]
          )
        ).reverse()
      : [];

  const heat = (await heatForEvents([event.id])).get(event.id);
  const hl = heat ? heatLabel(heat.heat) : null;
  const hereCount = people.filter((p) => p.state === 'here').length;
  const goingCount = people.filter((p) => p.state === 'going').length;

  return (
    <main className="wrap clubWrap">
      <ClubTrack type="clubmessenger_event_open" eventId={event.id} />
      {member && access && !cancelled && <ClubTrack type="live_room_open" eventId={event.id} />}
      <AutoRefresh seconds={30} />

      <Link href="/clubmessenger" className="clubBack">← Who’s out tonight</Link>

      <section className="clubEventHero">
        {event.primary_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bg" src={event.primary_image_url} alt="" />
        )}
        <div className="clubEventHeroInner">
          <div className="clubEventTitleRow">
            <h1 className="clubTitle" style={{ margin: 0 }}>{event.title}</h1>
            {hl && <span className="heatBadge">🔥 {hl}</span>}
          </div>
          <div className="clubEventMeta" style={{ marginTop: 6 }}>
            {fmtEventDate(event.start_at, event.end_at, event.timezone)} ·{' '}
            {fmtEventTime(event.start_at, event.end_at, event.timezone)}
            {event.venue_name && ` · ${event.venue_name}`}
            {event.city && ` · ${event.city}`}
          </div>
          <div className="clubEventStats">
            {hereCount > 0 && <span className="hereBadge">● {hereCount} here now</span>}
            {goingCount > 0 && <span>{goingCount} going</span>}
            <Link href={`/events/${event.slug}`} className="clubDetailLink">Event details →</Link>
            {event.ticket_url && !cancelled && event.listing_status !== 'sold_out' && (
              <a href={`/out/${event.id}?src=clubmessenger`} className="clubDetailLink">Tickets →</a>
            )}
          </div>
        </div>
      </section>

      {cancelled && (
        <div className="cancelBanner">CANCELLED — this event is no longer going ahead.</div>
      )}

      {member && <PingInbox pings={incomingPings} />}

      {!cancelled && (
        <PresenceControls
          eventId={event.id}
          presence={myPresence}
          isSignedIn={!!member}
          canCheckIn={inWindow && !!member}
          sticky
        />
      )}

      {member ? (
        <div className="clubRoomColumns">
          <div>
            <div className="sectionLabel">Live room</div>
            {access && !cancelled ? (
              <RoomChat eventId={event.id} initialMessages={initialMessages} meId={member.id} />
            ) : cancelled ? (
              <div className="peopleEmpty">The room is closed for cancelled events.</div>
            ) : (
              <div className="clubJoin">
                <p>The live room is for people who are going or already here.</p>
                <GoingCta eventId={event.id} isSignedIn />
              </div>
            )}
          </div>
          <div>
            <div className="sectionLabel">People</div>
            <PeopleList
              eventId={event.id}
              people={people}
              meId={member.id}
              sentPings={sentPings}
            />
          </div>
        </div>
      ) : (
        <div className="clubJoin">
          <p>
            Sign in to see which friends are here, join the live room and
            find each other inside.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/clubmessenger/events/${event.id}`)}`}
            className="btnAccent"
          >
            Sign in →
          </Link>
        </div>
      )}
    </main>
  );
}
