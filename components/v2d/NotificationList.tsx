'use client';

// Notification centre list: mark read / mark all read, click-through with
// attribution tracking.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { track } from '@/lib/track';

export type NotificationRow = {
  id: string;
  text: string;
  href: string;
  created_at: string;
  read: boolean;
};

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [read, setRead] = useState<Set<string>>(new Set(items.filter((i) => i.read).map((i) => i.id)));

  async function markAll() {
    setRead(new Set(items.map((i) => i.id)));
    await fetch('/api/clubmessenger/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
    router.refresh();
  }

  async function open(item: NotificationRow) {
    setRead((prev) => new Set(prev).add(item.id));
    track('notification_clicked');
    fetch('/api/clubmessenger/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [item.id] }),
    }).catch(() => {});
    router.push(item.href);
  }

  const unreadCount = items.length - read.size;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="youHistoryMeta">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </span>
        {unreadCount > 0 && (
          <button className="btnGhost" type="button" onClick={markAll}>Mark all read</button>
        )}
      </div>
      {items.length === 0 && (
        <div className="peopleEmpty">
          Nothing yet. Follow promoters, artists and cities — when something
          relevant happens, you’ll hear about it here first.
        </div>
      )}
      <div className="notifCentreList">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`notifCentreRow${read.has(n.id) ? '' : ' isUnread'}`}
            onClick={() => open(n)}
          >
            <span className="notifCentreText">{n.text}</span>
            <span className="notifTime">
              {new Date(n.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
