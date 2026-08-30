'use client';

// Notifications + preferences for Club Messenger. Fetched client-side so
// the page itself stays cacheable per-user work light; marking read happens
// when the panel opens.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { track } from '@/lib/track';

type Notification = {
  id: string;
  type: 'friend_arrived' | 'friend_pinged_you' | 'event_room_message';
  created_at: string;
  read_at: string | null;
  event_id: string | null;
  event_title: string | null;
  event_slug: string | null;
  actor_name: string | null;
};

type Prefs = { friend_arrivals: boolean; pings: boolean; room_messages: boolean };

function label(n: Notification): string {
  const who = n.actor_name ?? 'Someone';
  const where = n.event_title ? ` at ${n.event_title}` : '';
  if (n.type === 'friend_arrived') return `${who} just arrived${where}`;
  if (n.type === 'friend_pinged_you') return `${who} asked where you are${where}`;
  return `${who} messaged the room${where}`;
}

export function NotificationsPanel() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/clubmessenger/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
    } catch {
      /* retry on next open */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unread = (items ?? []).filter((n) => !n.read_at);

  useEffect(() => {
    if (unread.some((n) => n.type === 'friend_arrived')) {
      track('friend_arrival_seen');
    }
    // Track once per load, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items === null]);

  async function openPanel() {
    setOpen(true);
    if (unread.length) {
      await fetch('/api/clubmessenger/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      }).catch(() => {});
      setItems((prev) =>
        prev ? prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) : prev
      );
    }
  }

  async function loadPrefs() {
    setShowPrefs((s) => !s);
    if (!prefs) {
      const res = await fetch('/api/clubmessenger/preferences').catch(() => null);
      if (res?.ok) setPrefs((await res.json()).preferences);
    }
  }

  async function togglePref(key: keyof Prefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await fetch('/api/clubmessenger/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => {});
  }

  return (
    <div className="notifPanel">
      <div className="notifHead">
        <button
          type="button"
          className={`btnGhost${unread.length ? ' notifHasUnread' : ''}`}
          onClick={() => (open ? setOpen(false) : openPanel())}
        >
          🔔 {unread.length > 0 ? `${unread.length} new` : 'Notifications'}
        </button>
        <button type="button" className="btnGhost" onClick={loadPrefs}>
          ⚙
        </button>
      </div>

      {showPrefs && prefs && (
        <div className="notifPrefs">
          {(
            [
              ['friend_arrivals', 'Friend arrivals'],
              ['pings', '“Where are you?” pings'],
              ['room_messages', 'Room messages (can be noisy)'],
            ] as [keyof Prefs, string][]
          ).map(([key, text]) => (
            <label className="notifPrefRow" key={key}>
              <input type="checkbox" checked={prefs[key]} onChange={() => togglePref(key)} />
              {text}
            </label>
          ))}
        </div>
      )}

      {open && (
        <div className="notifList">
          {!items?.length && <div className="peopleEmpty">Nothing yet — quiet night.</div>}
          {(items ?? []).slice(0, 15).map((n) => (
            <div className="notifRow" key={n.id}>
              {n.event_id ? (
                <Link
                  href={`/clubmessenger/events/${n.event_id}`}
                  onClick={() => n.type === 'friend_arrived' && track('friend_arrival_clicked', { eventId: n.event_id! })}
                >
                  {label(n)}
                </Link>
              ) : (
                <span>{label(n)}</span>
              )}
              <span className="notifTime">
                {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
