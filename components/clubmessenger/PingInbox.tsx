'use client';

// Unanswered "Where are you?" pings for the viewer at this event, with
// venue-relative quick replies — the answer is a phrase, never a location.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const QUICK_REPLIES = ['By the bar', 'Upstairs', 'Main room', 'Outside', 'Smoking area'];

type Ping = { id: string; from_name: string };

export function PingInbox({ pings }: { pings: Ping[] }) {
  const router = useRouter();
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [custom, setCustom] = useState('');

  const open = pings.filter((p) => !answered.has(p.id));
  if (!open.length) return null;

  async function respond(pingId: string, response: string) {
    const text = response.trim().slice(0, 80);
    if (!text) return;
    setAnswered((prev) => new Set(prev).add(pingId));
    setCustomFor(null);
    setCustom('');
    await fetch('/api/clubmessenger/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pingId, response: text }),
    }).catch(() => {});
    router.refresh();
  }

  return (
    <div className="pingInbox">
      {open.map((p) => (
        <div className="pingCard" key={p.id}>
          <div className="pingAsk">
            <strong>{p.from_name}</strong> asked: Where are you?
          </div>
          <div className="pingReplies">
            {QUICK_REPLIES.map((r) => (
              <button key={r} type="button" className="chip" onClick={() => respond(p.id, r)}>
                {r}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => setCustomFor(customFor === p.id ? null : p.id)}
            >
              Custom…
            </button>
          </div>
          {customFor === p.id && (
            <form
              className="pingCustomForm"
              onSubmit={(e) => {
                e.preventDefault();
                respond(p.id, custom);
              }}
            >
              <input
                value={custom}
                maxLength={80}
                placeholder="Back left, silver jacket"
                onChange={(e) => setCustom(e.target.value)}
                autoFocus
              />
              <button className="btnGhost" type="submit">Reply</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
