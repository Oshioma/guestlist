// Club Messenger — "WHO'S OUT TONIGHT?"
// Ranking (documented): friends here now → friends going → my own RSVP →
// public heat → soonest start. Social relevance and heat are computed in
// lib/clubmessenger + lib/heat (data only) — this page just orders and
// renders. Refreshes every 30s while visible.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import {
  friendActivity,
  myActivePresence,
  tonightEvents,
  tonightEventsPublic,
  type TonightEvent,
} from '@/lib/clubmessenger';
import { heatForEvents, heatLabel } from '@/lib/heat';
import { fmtEventTime } from '@/lib/util';
import { AutoRefresh } from '@/components/clubmessenger/AutoRefresh';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { NotificationsPanel } from '@/components/clubmessenger/NotificationsPanel';
import { HeatCardLink } from '@/components/clubmessenger/HeatCardLink';

export const dynamic = 'force-dynamic';

export default async function ClubMessengerPage() {
  const member = await getCurrentMember();

  if (!member) {
    // Signed out: tonight's listings are public, the people are not —
    // no presence, no names, no here-now counts until you're in.
    const publicEvents = await tonightEventsPublic();
    return (
      <main className="wrap clubWrap">
        <div className="clubHead">
          <h1 className="clubTitle">Who’s out tonight?</h1>
          {publicEvents.length > 0 && (
            <div className="clubSummary">
              {publicEvents.length} event{publicEvents.length === 1 ? '' : 's'} on tonight
            </div>
          )}
        </div>
        <div className="clubJoin">
          <p>
            Club Messenger is where Guestlist comes alive after dark — see
            which friends are out, check in when you arrive, and find each
            other inside without leaving the dance floor.
          </p>
          <p className="muted" style={{ color: 'var(--text-muted)' }}>
            No GPS, no tracking — you’re only “here” when you say you are,
            and only the people you choose can see it.
          </p>
          <Link href="/signup?next=%2Fclubmessenger" className="btnAccent">
            Join Guestlist →
          </Link>
        </div>

        <div className="sectionLabel">Tonight</div>
        {publicEvents.length === 0 && (
          <div className="clubJoin">
            <p>Nothing on tonight in the next 24 hours.</p>
            <Link href="/events" className="btnGhost">Browse events →</Link>
          </div>
        )}
        <div className="clubEventList">
          {publicEvents.map((e) => (
            <Link href={`/events/${e.slug}`} className="clubEventCardLink" key={e.id}>
              <div className="clubEventCard">
                {e.primary_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="clubEventImg" src={e.primary_image_url} alt="" />
                )}
                <div className="clubEventBody">
                  <div className="clubEventTitleRow">
                    <span className="clubEventTitle">{e.title}</span>
                  </div>
                  <div className="clubEventMeta">
                    {fmtEventTime(e.start_at, e.end_at, e.timezone)}
                    {e.venue_name && ` · ${e.venue_name}`}
                    {e.city && ` · ${e.city}`}
                    {e.listing_status !== 'confirmed' && ` · ${e.listing_status.replace('_', ' ')}`}
                  </div>
                  <div className="clubEventSocial">
                    {e.going_count > 0 ? (
                      <span>{e.going_count} going</span>
                    ) : (
                      <span className="mutedLine">Be the first one there</span>
                    )}
                    <span className="mutedLine">Sign in to see who’s out</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    );
  }

  const [events, activity, presence] = await Promise.all([
    tonightEvents(member.id),
    friendActivity(member.id),
    myActivePresence(member.id),
  ]);
  const heat = await heatForEvents(events.map((e) => e.id));

  const ranked = [...events].sort((a, b) => {
    const diff =
      b.friends_here.length - a.friends_here.length ||
      b.friends_going.length - a.friends_going.length ||
      Number(b.my_rsvp === 'going') - Number(a.my_rsvp === 'going') ||
      Number(b.my_rsvp === 'interested') - Number(a.my_rsvp === 'interested') ||
      (heat.get(b.id)?.heat ?? 0) - (heat.get(a.id)?.heat ?? 0);
    return diff || new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
  });

  const friendsOut = new Map<string, { name: string; event: TonightEvent }>();
  for (const e of events) {
    for (const f of e.friends_here) {
      if (!friendsOut.has(f.id)) friendsOut.set(f.id, { name: f.display_name, event: e });
    }
  }

  return (
    <main className="wrap clubWrap">
      <ClubTrack type="clubmessenger_open" />
      <AutoRefresh seconds={30} />

      <div className="clubHead">
        <h1 className="clubTitle">Who’s out tonight?</h1>
        <div className="clubSummary">
          {friendsOut.size > 0
            ? `${friendsOut.size} friend${friendsOut.size === 1 ? ' is' : 's are'} out right now`
            : 'None of your friends are out yet'}
        </div>
      </div>

      <NotificationsPanel />

      {presence && (
        <Link href={`/clubmessenger/events/${presence.event_id}`} className="clubMyPresence">
          ● You’re at <strong>{presence.event_title}</strong>
          {presence.status && <> — “{presence.status}”</>}
          <span className="clubMyPresenceGo">Open room →</span>
        </Link>
      )}

      {activity.length > 0 && (
        <>
          <div className="sectionLabel">Tonight’s activity</div>
          <div className="clubActivity">
            {activity.map((a, i) => (
              <Link
                href={`/clubmessenger/events/${a.event_id}`}
                className="clubActivityRow"
                key={`${a.kind}-${a.member_id}-${a.event_id}-${i}`}
              >
                <span>
                  <strong>{a.display_name}</strong>{' '}
                  {a.kind === 'arrived' ? 'is at' : 'is going to'}{' '}
                  <strong>{a.event_title}</strong>
                </span>
                <span className="notifTime">
                  {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="sectionLabel">Tonight</div>
      {ranked.length === 0 && (
        <div className="clubJoin">
          <p>Nothing on tonight in the next 24 hours.</p>
          <p style={{ color: 'var(--text-muted)' }}>
            Browse what’s coming up and mark yourself going — events show up
            here the day they happen.
          </p>
          <Link href="/events" className="btnGhost">Browse events →</Link>
        </div>
      )}
      <div className="clubEventList">
        {ranked.map((e) => {
          const h = heat.get(e.id);
          const hl = h ? heatLabel(h.heat) : null;
          const friendBits = [
            e.friends_here.length &&
              `${e.friends_here.map((f) => `${f.is_close ? '★ ' : ''}${f.display_name}`).slice(0, 3).join(', ')}${
                e.friends_here.length > 3 ? ` +${e.friends_here.length - 3}` : ''
              } here now`,
            e.friends_going.length && `${e.friends_going.length} friend${e.friends_going.length === 1 ? '' : 's'} going`,
          ].filter(Boolean);
          return (
            <HeatCardLink eventId={e.id} key={e.id}>
              <div className="clubEventCard">
                {e.primary_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="clubEventImg" src={e.primary_image_url} alt="" />
                )}
                <div className="clubEventBody">
                  <div className="clubEventTitleRow">
                    <span className="clubEventTitle">{e.title}</span>
                    {hl && <span className="heatBadge">🔥 {hl}</span>}
                  </div>
                  <div className="clubEventMeta">
                    {fmtEventTime(e.start_at, e.end_at, e.timezone)}
                    {e.venue_name && ` · ${e.venue_name}`}
                    {e.city && ` · ${e.city}`}
                    {e.listing_status !== 'confirmed' && ` · ${e.listing_status.replace('_', ' ')}`}
                  </div>
                  <div className="clubEventSocial">
                    {friendBits.length > 0 ? (
                      <span className="clubFriendLine">✦ {friendBits.join(' · ')}</span>
                    ) : e.event_visible_here > 0 ? (
                      <span>{e.event_visible_here} here now</span>
                    ) : e.going_count > 0 ? (
                      <span>{e.going_count} going</span>
                    ) : (
                      <span className="mutedLine">Be the first one there</span>
                    )}
                    {e.my_rsvp === 'going' && <span className="myRsvpMark">✓ Going</span>}
                  </div>
                </div>
              </div>
            </HeatCardLink>
          );
        })}
      </div>

      <div className="clubFootNote">
        Presence is manual — you’re only “here” when you tap I’M HERE, and
        you choose who sees it. No GPS. Ever.
      </div>
    </main>
  );
}
