'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FollowButton({
  entityType,
  entityId,
  initialFollowing,
  isSignedIn,
  compact = false,
}: {
  entityType: 'promoter' | 'venue' | 'artist' | 'member';
  entityId: string;
  initialFollowing: boolean;
  isSignedIn: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    const res = await fetch('/api/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType, entityId, follow: next }),
    });
    if (!res.ok) setFollowing(!next);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      className={following ? 'btnGhost isActive' : compact ? 'btnGhost' : 'btnAccent'}
      style={compact ? { padding: '6px 12px', fontSize: 11 } : undefined}
      onClick={toggle}
      type="button"
    >
      {following ? '✓ Following' : 'Follow'}
    </button>
  );
}
