'use client';

// Interested / Going / Save actions + attendance summary + Who's Going drawer.
// Counts update optimistically; logged-out users are routed to sign-in.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Rsvp = 'interested' | 'going' | null;
type Avatar = { display_name: string; avatar_url: string | null };
type Attendee = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  home_city: string | null;
  slug?: string | null;
  is_me?: boolean;
  following?: boolean;
  is_friend?: boolean;
  is_connected?: boolean;
};

// One attendee with a member-follow toggle. Following back makes you
// friends (mutual follow) — the basis of Club Messenger visibility.
function MemberRow({ member: m }: { member: Attendee }) {
  const [following, setFollowing] = useState(!!m.following);
  const [friend, setFriend] = useState(!!m.is_friend);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    if (!next) setFriend(false);
    const res = await fetch('/api/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'member', entityId: m.id, follow: next }),
    });
    if (!res.ok) {
      setFollowing(!next);
    } else {
      const data = await res.json().catch(() => ({}));
      setFriend(!!data.mutual);
    }
    setBusy(false);
  }

  return (
    <div className="memberRow">
      {m.avatar_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.avatar_url} alt="" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name">
          {m.slug ? (
            <a href={`/members/${m.slug}`} style={{ textDecoration: 'none' }}>{m.display_name}</a>
          ) : (
            m.display_name
          )}
          {m.is_connected ? (
            <span className="friendMark" title="Connected"> ✦</span>
          ) : friend ? (
            <span className="friendMark" title="Friends"> ✦</span>
          ) : null}
        </div>
        {m.home_city && <div className="loc">{m.home_city}</div>}
      </div>
      {!m.is_me && (
        <button
          className={`btnGhost${following ? ' isActive' : ''}`}
          style={{ padding: '5px 10px', fontSize: 11 }}
          onClick={toggle}
          disabled={busy}
          type="button"
        >
          {friend ? '✦ Friends' : following ? '✓ Following' : 'Follow'}
        </button>
      )}
    </div>
  );
}

export function SocialPanel({
  eventId,
  isSignedIn,
  initial,
  goingCount,
  interestedCount,
  avatars,
}: {
  eventId: string;
  isSignedIn: boolean;
  initial: { saved: boolean; rsvp: Rsvp };
  goingCount: number;
  interestedCount: number;
  avatars: Avatar[];
}) {
  const router = useRouter();
  const [rsvp, setRsvp] = useState<Rsvp>(initial.rsvp);
  const [saved, setSaved] = useState(initial.saved);
  const [counts, setCounts] = useState({ going: goingCount, interested: interestedCount });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attendees, setAttendees] = useState<{ going: Attendee[]; interested: Attendee[] } | null>(null);

  const requireAuth = useCallback(() => {
    if (isSignedIn) return true;
    router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    return false;
  }, [isSignedIn, router]);

  async function send(body: Record<string, unknown>) {
    const res = await fetch(`/api/events/${eventId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  function adjust(prev: Rsvp, next: Rsvp) {
    setCounts((c) => ({
      going: c.going + (next === 'going' ? 1 : 0) - (prev === 'going' ? 1 : 0),
      interested: c.interested + (next === 'interested' ? 1 : 0) - (prev === 'interested' ? 1 : 0),
    }));
  }

  async function setRsvpState(next: Rsvp) {
    if (!requireAuth()) return;
    const prev = rsvp;
    const target = prev === next ? null : next; // tap again to clear
    setRsvp(target);
    adjust(prev, target);
    setAttendees(null);
    const ok = await send({ rsvp: target });
    if (!ok) {
      setRsvp(prev);
      adjust(target, prev);
    }
  }

  async function toggleSave() {
    if (!requireAuth()) return;
    const next = !saved;
    setSaved(next);
    if (!(await send({ saved: next }))) setSaved(!next);
  }

  useEffect(() => {
    if (drawerOpen && !attendees) {
      fetch(`/api/events/${eventId}/attendees`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setAttendees(data))
        .catch(() => {});
    }
  }, [drawerOpen, attendees, eventId]);

  return (
    <div className="sideCard">
      <div className="rsvpRow">
        <button
          className={`btnGhost${rsvp === 'interested' ? ' isActive' : ''}`}
          onClick={() => setRsvpState('interested')}
          type="button"
        >
          {rsvp === 'interested' ? '★ Interested' : 'Interested'}
        </button>
        <button
          className={`btnGhost${rsvp === 'going' ? ' isActive' : ''}`}
          onClick={() => setRsvpState('going')}
          type="button"
        >
          {rsvp === 'going' ? "✓ I'm Going" : "I'm Going"}
        </button>
      </div>
      <div className="rsvpRow">
        <button
          className={`btnGhost${saved ? ' isActive' : ''}`}
          onClick={toggleSave}
          type="button"
        >
          {saved ? '♥ Saved' : '♡ Save'}
        </button>
      </div>

      <div className="goingSummary">
        {avatars.length > 0 && (
          <span className="avatarStack">
            {avatars.slice(0, 5).map((a, i) =>
              a.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.avatar_url} alt={a.display_name} key={i} title={a.display_name} />
              ) : null
            )}
          </span>
        )}
        <span>
          {counts.going > 0
            ? `${counts.going} Guestlist member${counts.going === 1 ? '' : 's'} going`
            : counts.interested > 0
              ? `${counts.interested} interested`
              : 'Be the first to mark yourself going'}
          {counts.going > 0 && counts.interested > 0 && ` · ${counts.interested} interested`}
        </span>
      </div>

      {(counts.going > 0 || counts.interested > 0) && (
        <button
          className="btnGhost"
          style={{ width: '100%', marginTop: 12 }}
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          See who’s going
        </button>
      )}

      {drawerOpen && (
        <>
          <div className="drawerOverlay" onClick={() => setDrawerOpen(false)} />
          <div className="drawer" role="dialog" aria-label="Who's going">
            <button className="drawerClose" onClick={() => setDrawerOpen(false)} type="button">✕</button>
            <h3>Who’s going</h3>
            <p className="sub">
              {counts.going} going · {counts.interested} interested
            </p>
            {!isSignedIn ? (
              <div className="joinPrompt">
                {counts.going > 0 && (
                  <div className="avatarStack" style={{ justifyContent: 'center', display: 'flex', marginBottom: 12 }}>
                    {avatars.slice(0, 5).map((a, i) =>
                      a.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatar_url} alt="" key={i} />
                      ) : null
                    )}
                  </div>
                )}
                Join Guestlist to see who’s going — and to find the people you
                used to share dance floors with.
                <div style={{ marginTop: 14 }}>
                  <a href={`/signup?next=${encodeURIComponent(`/events`)}`} className="btnAccent">Join Guestlist</a>
                </div>
              </div>
            ) : attendees ? (
              <>
                {attendees.going.length > 0 && (
                  <>
                    <div className="sectionLabel">Going</div>
                    {attendees.going.map((m) => (
                      <MemberRow member={m} key={m.id} />
                    ))}
                  </>
                )}
                {attendees.interested.length > 0 && (
                  <>
                    <div className="sectionLabel">Interested</div>
                    {attendees.interested.map((m) => (
                      <MemberRow member={m} key={m.id} />
                    ))}
                  </>
                )}
                {/* Room to grow: mutual friends, shared club history, taste
                    overlap — the schema already captures the raw signals. */}
              </>
            ) : (
              <div className="sub">Loading…</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
