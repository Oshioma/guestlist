'use client';

// Who's here / who's going at one event, with "Where are you?" pings.
// Only friends with visible active presence get a ping button — the server
// re-checks both conditions, this is just the affordance.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Person = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  state: 'here' | 'going';
  status: string | null;
  is_friend: boolean;
};

type SentPing = { to_member: string; responded_at: string | null; response: string | null };

export function PeopleList({
  eventId,
  people,
  meId,
  sentPings,
}: {
  eventId: string;
  people: Person[];
  meId: string;
  sentPings: SentPing[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'here' | 'going'>('here');
  const [pinged, setPinged] = useState<Set<string>>(
    new Set(sentPings.filter((p) => !p.responded_at).map((p) => p.to_member))
  );
  const [error, setError] = useState<string | null>(null);

  const responses = new Map(
    sentPings.filter((p) => p.response).map((p) => [p.to_member, p.response as string])
  );
  const here = people.filter((p) => p.state === 'here' && p.id !== meId);
  const going = people.filter((p) => p.state === 'going' && p.id !== meId);
  const rows = tab === 'here' ? here : going;

  async function ping(toMemberId: string) {
    setError(null);
    setPinged((prev) => new Set(prev).add(toMemberId));
    const res = await fetch('/api/clubmessenger/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toMemberId, eventId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Ping failed');
      setPinged((prev) => {
        const next = new Set(prev);
        next.delete(toMemberId);
        return next;
      });
    } else {
      router.refresh();
    }
  }

  return (
    <div className="peoplePanel">
      <div className="peopleTabs">
        <button
          type="button"
          className={`peopleTab${tab === 'here' ? ' isActive' : ''}`}
          onClick={() => setTab('here')}
        >
          {`Here now (${here.length})`}
        </button>
        <button
          type="button"
          className={`peopleTab${tab === 'going' ? ' isActive' : ''}`}
          onClick={() => setTab('going')}
        >
          {`Going (${going.length})`}
        </button>
      </div>
      {rows.length === 0 && (
        <div className="peopleEmpty">
          {tab === 'here'
            ? 'Nobody visible here yet — arrivals show up the moment friends tap I’M HERE.'
            : 'Nobody has marked themselves going yet.'}
        </div>
      )}
      {rows.map((p) => (
        <div className="personRow" key={p.id}>
          {p.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="personAvatar" src={p.avatar_url} alt="" />
          ) : (
            <span className="personAvatar personAvatarFallback">{p.display_name[0]}</span>
          )}
          <div className="personInfo">
            <div className="personName">
              {p.display_name}
              {p.is_friend && <span className="friendMark" title="Friend"> ✦</span>}
            </div>
            {p.state === 'here' && p.status && <div className="personStatus">“{p.status}”</div>}
            {responses.has(p.id) && (
              <div className="personStatus pingReply">↩ {responses.get(p.id)}</div>
            )}
          </div>
          {p.is_friend && p.state === 'here' && (
            <button
              className="btnGhost"
              type="button"
              disabled={pinged.has(p.id)}
              onClick={() => ping(p.id)}
            >
              {pinged.has(p.id) ? 'Pinged' : 'Where are you?'}
            </button>
          )}
        </div>
      ))}
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
