'use client';

// Follow / unfollow a city — it then drives your recommendations.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FollowCityButton({ locationId, following }: { locationId: string; following: boolean }) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(following);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !isFollowing;
    setIsFollowing(next);
    const res = await fetch('/api/you/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: next ? 'follow' : 'unfollow', locationId }),
    });
    if (!res.ok) setIsFollowing(!next);
    setBusy(false);
    router.refresh();
  }

  return (
    <button className={`btnGhost${isFollowing ? ' isActive' : ''}`} type="button" disabled={busy} onClick={toggle}>
      {isFollowing ? '✓ Following city' : '+ Follow city'}
    </button>
  );
}
