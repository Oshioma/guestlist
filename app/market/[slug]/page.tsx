// One business in the Market: who they are, what they give members, and
// the button that claims it.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBusinessBySlug, offerHeadline, offerTypeLabel } from '@/lib/market';
import { billingEnabled, currentMemberWithMembership } from '@/lib/membership';
import { ClaimOffer } from '@/components/market/ClaimOffer';
import { TrackEntityView } from '@/components/TrackEntityView';

export const dynamic = 'force-dynamic';

const SOCIAL_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', website2: 'Website' };

export default async function MarketBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [me, business] = await Promise.all([currentMemberWithMembership(), getBusinessBySlug(slug)]);
  if (!business) notFound();
  const viewer = !me ? 'anon' : me.isMember ? 'member' : 'nonmember';
  const location = [business.city, business.country].filter(Boolean).join(', ');
  const socials = Object.entries(business.socials ?? {}).filter(([k]) => SOCIAL_LABEL[k]);

  return (
    <main className="wrap">
      <TrackEntityView type="market_business_viewed" ids={{ business_id: business.id }} />
      <section className="profileHero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {business.hero_image_url && <img className="bg" src={business.hero_image_url} alt="" />}
        <div className="profileHeroInner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {business.logo_url ? <img className="profileLogo" src={business.logo_url} alt="" /> : <div className="profileLogo">{business.name[0]}</div>}
          <div className="homeKicker" style={{ marginBottom: 8 }}>{business.category_name ?? 'Independent'}</div>
          <h1 className="profileName">{business.name}</h1>
          {business.tagline && <p className="landingLead" style={{ margin: '0 0 10px' }}>{business.tagline}</p>}
          <div className="profileFacts">
            {location && <span>{location}</span>}
            {business.address && <span>{business.address}</span>}
            {business.website && (
              <a href={business.website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                {business.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗
              </a>
            )}
          </div>
          {socials.length > 0 && (
            <div className="profileActions">
              {socials.map(([k, url]) => <a key={k} className="btnGhost" href={url} target="_blank" rel="noopener noreferrer">{SOCIAL_LABEL[k]}</a>)}
            </div>
          )}
        </div>
      </section>

      <div className="detailColumns">
        <div>
          {business.description && (
            <>
              <div className="sectionLabel" style={{ marginTop: 34 }}>About</div>
              <p className="prose">{business.description}</p>
            </>
          )}
          <div className="sectionLabel" style={{ marginTop: 34 }}>Member offer{business.offers.length === 1 ? '' : 's'}</div>
          {business.offers.length === 0 && <p className="adminSub">No live offer right now — check back soon.</p>}
          {business.offers.map((o) => (
            <div className="offerCard" key={o.id}>
              <div className="marketCategory" style={{ color: 'var(--accent-ink)' }}>{offerTypeLabel(o.offer_type)} · for Guestlist members</div>
              <h2 className="headline">{offerHeadline(o)}</h2>
              {o.title !== offerHeadline(o) && o.offer_type !== 'other' && <p><strong>{o.title}</strong></p>}
              {o.description && <p>{o.description}</p>}
              {o.redemption_instructions && <p className="small"><strong>How to use it:</strong> {o.redemption_instructions}</p>}
              {(o.valid_from || o.valid_to) && (
                <p className="small">
                  {o.valid_from && `From ${new Date(o.valid_from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  {o.valid_from && o.valid_to && ' · '}
                  {o.valid_to && `Until ${new Date(o.valid_to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                </p>
              )}
              <div style={{ marginTop: 14 }}>
                <ClaimOffer offerId={o.id} viewer={viewer} businessSlug={business.slug} billingLive={billingEnabled()} />
              </div>
              {o.terms && <p className="small" style={{ marginTop: 12 }}>{o.terms}</p>}
              <p className="small" style={{ marginTop: 8 }}>Offer provided by {business.name}. Their terms apply. One claim per member at a time; codes are personal and expire.</p>
            </div>
          ))}
        </div>
        <aside>
          <div className="sideCard">
            <div className="sectionLabel" style={{ marginTop: 0 }}>Guestlist Market</div>
            <div className="muted">Independent businesses we like, giving Guestlist members something extra. Chosen by Guestlist, not listed by anyone.</div>
            <hr />
            <Link href="/market" className="btnGhost">All businesses</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
