'use client';

import Link from 'next/link';
import { useState } from 'react';

export type GuestlistNowObservation = {
  id: string;
  body: string;
  link_url: string | null;
};

export function GuestlistNowItems({
  observations,
  isAdmin,
}: {
  observations: GuestlistNowObservation[];
  isAdmin: boolean;
}) {
  const [items, setItems] = useState(observations);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function suppress(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const response = await fetch('/api/admin/homepage-feed/suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'website', externalId: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not hide this post');
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError({ id, message: err instanceof Error ? err.message : 'Could not hide this post' });
    } finally {
      setPendingId(null);
    }
  }

  if (!items.length) return null;

  return (
    <section className="guestlistNow">
      <div className="guestlistNowHead">
        <span className="guestlistNowBadge">@guestlist</span>
        <span className="guestlistNowSub">The things we’re noticing</span>
      </div>
      {items.map((item) => (
        <div className="guestlistNowItem" key={item.id}>
          {isAdmin && (
            <button
              type="button"
              className="guestlistNowSuppress"
              aria-label="Hide this post from the Guestlist homepage"
              title="Hide from homepage"
              disabled={pendingId === item.id}
              onClick={() => suppress(item.id)}
            >
              {pendingId === item.id ? '…' : '×'}
            </button>
          )}
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.body}</p>
          {item.link_url && (
            <Link href={item.link_url.replace(/^https?:\/\/[^/]+/, '')} className="guestlistNowLink">
              On Guestlist →
            </Link>
          )}
          {error?.id === item.id && (
            <span className="guestlistNowSuppressError" role="status">{error.message}</span>
          )}
        </div>
      ))}
    </section>
  );
}
