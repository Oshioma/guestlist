// The claim screen — what a member holds up at the counter. Big code, the
// business, the offer, when it expires. Only its owner can open it.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { claimForMember, offerHeadline } from '@/lib/market';

export const dynamic = 'force-dynamic';

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getCurrentMember();
  if (!member) redirect(`/login?next=/market/claims/${id}`);
  const claim = await claimForMember(id, member.id);
  if (!claim) notFound();
  const spent = claim.status !== 'claimed';
  const expires = new Date(claim.expires_at);
  const headline = offerHeadline({ title: claim.offer_title, offer_type: claim.offer_type, discount_percent: claim.discount_percent, discount_amount_pence: claim.discount_amount_pence, currency: claim.currency });

  return (
    <main className="wrap">
      <div className="claimScreen">
        <div className="homeKicker">Guestlist member offer</div>
        <h1 style={{ fontSize: 'clamp(24px, 6vw, 40px)', letterSpacing: -0.8, margin: '0 0 4px', textTransform: 'uppercase' }}>{headline}</h1>
        <div className="claimMeta">{claim.offer_title !== headline ? claim.offer_title : ''}</div>
        <div className={`claimCode${spent ? ' spent' : ''}`} aria-label="Your code">{claim.code}</div>
        <div className="claimMeta">
          {claim.status === 'claimed' && `Show this at ${claim.business_name}. Valid until ${expires.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`}
          {claim.status === 'redeemed' && `Used ${claim.redeemed_at ? new Date(claim.redeemed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}. Enjoy.`}
          {claim.status === 'expired' && 'This code has expired — claim the offer again from the business page.'}
          {claim.status === 'cancelled' && 'This code was cancelled.'}
        </div>
        {claim.redemption_instructions && <p className="claimMeta" style={{ marginTop: 14 }}>{claim.redemption_instructions}</p>}
        <div className="claimBusiness">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {claim.logo_url && <img src={claim.logo_url} alt="" />}
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700 }}>{claim.business_name}</div>
            <div className="claimMeta">{[claim.address, claim.city].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`/market/${claim.business_slug}`} className="btnGhost">{spent ? 'Back to the offer' : 'About the business'}</Link>
          <Link href="/you/membership" className="btnGhost">Your membership</Link>
        </div>
        {claim.terms && <p className="claimMeta" style={{ marginTop: 22, fontSize: 12 }}>{claim.terms}</p>}
        <p className="claimMeta" style={{ marginTop: 10, fontSize: 12 }}>Personal to you. One use. Offer provided by {claim.business_name}; their terms apply.</p>
      </div>
    </main>
  );
}
