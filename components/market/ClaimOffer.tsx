'use client';

// CLAIM MEMBER OFFER — mints the member's single-use code and takes them
// to the claim screen, ready to show at the counter.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ClaimOffer({ offerId, viewer, businessSlug, billingLive }: {
  offerId: string; viewer: 'anon' | 'nonmember' | 'member'; businessSlug: string; billingLive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (viewer === 'anon') {
    return <Link href={`/login?next=${encodeURIComponent(`/market/${businessSlug}`)}`} className="mbCta" style={{ fontSize: 12.5 }}>Sign in to claim</Link>;
  }
  if (viewer === 'nonmember') {
    return (
      <div>
        <Link href="/membership" className="mbCta" style={{ fontSize: 12.5 }}>{billingLive ? 'Become a member to claim' : 'Membership coming soon'}</Link>
        <div className="mbQualifier">Member offers are for Guestlist members.</div>
      </div>
    );
  }
  async function claim() {
    setBusy(true); setError('');
    const r = await fetch(`/api/market/offers/${offerId}/claim`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) { router.push(j.url); return; }
    setError(j.error || 'Could not claim this offer');
    setBusy(false);
  }
  return (
    <div>
      <button className="mbCta" style={{ fontSize: 12.5 }} onClick={claim} disabled={busy}>{busy ? 'One moment…' : 'Claim member offer'}</button>
      {error && <div className="mbErr" style={{ marginTop: 8, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
