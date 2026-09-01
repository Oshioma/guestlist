'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { track } from '@/lib/track';

export function TrackView({ eventId, src }: { eventId: string; src?: string | null }) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    track('event_viewed', { eventId, ...(src ? { src } : {}) });
  }, [eventId, src]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/session', { cache: 'no-store' })
      .then((res) => active && setIsAdmin(res.ok))
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function deleteEvent() {
    if (deleting) return;
    const confirmed = window.confirm('Delete this event permanently? This cannot be undone.');
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error ?? 'Could not delete event');
        return;
      }
      router.push('/events');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 0 10px' }}>
      <button
        type="button"
        onClick={deleteEvent}
        disabled={deleting}
        style={{
          border: '1px solid #b42318',
          color: '#b42318',
          background: 'transparent',
          borderRadius: 999,
          padding: '8px 13px',
          fontSize: 11,
          fontWeight: 750,
          cursor: deleting ? 'wait' : 'pointer',
        }}
      >
        {deleting ? 'Deleting…' : 'Delete event'}
      </button>
    </div>
  );
}
