// GUESTLIST MARKET — independent businesses we like, giving Guestlist
// members something extra. A curated directory, not a coupon site. Nothing
// appears here that Guestlist has not chosen.

import Link from 'next/link';
import { listApprovedBusinesses, listCategories, offerHeadline } from '@/lib/market';
import { billingEnabled, currentMemberWithMembership } from '@/lib/membership';
import { ClubTrack } from '@/components/clubmessenger/ClubTrack';
import { MarketArt } from '@/components/market/MarketArt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guestlist Market' };

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const [businesses, categories, me] = await Promise.all([
    listApprovedBusinesses({ categorySlug: category ?? null }), listCategories(), currentMemberWithMembership(),
  ]);
  const used = new Set(businesses.map((b) => b.category_slug));

  return (
    <main className="wrap">
      <ClubTrack type="market_viewed" />
      <div className="marketHead">
        <div className="homeKicker">Guestlist Market</div>
        <h1 className="pageTitle" style={{ margin: '0 0 10px' }}>Independent businesses we like.</h1>
        <p className="pageStandfirst">
          Restaurants, bars, record shops, studios, clothing, places to stay — chosen by Guestlist, giving members something extra.
          {!me?.isMember && <> <Link href="/membership" style={{ textDecoration: 'underline' }}>{billingEnabled() ? 'Become a member' : 'Membership coming soon'}</Link>.</>}
        </p>
      </div>

      {businesses.length > 0 || category ? (
        <nav className="chipRow" aria-label="Categories">
          <Link href="/market" className={`chip${!category ? ' active' : ''}`}>All</Link>
          {categories.filter((c) => used.has(c.slug) || c.slug === category).map((c) => (
            <Link key={c.id} href={`/market?category=${c.slug}`} className={`chip${category === c.slug ? ' active' : ''}`}>{c.name}</Link>
          ))}
        </nav>
      ) : null}

      {businesses.length === 0 ? (
        <div className="emptyState" style={{ marginTop: 24 }}>
          <h3>{category ? 'Nothing in this category yet.' : 'The first businesses are being chosen.'}</h3>
          <p>Guestlist Market opens with a small number of independent businesses we genuinely rate. Members will hear first.</p>
          <Link href="/market/apply" className="btnGhost">Run an independent business? Apply →</Link>
        </div>
      ) : (
        <div className="marketGrid">
          {businesses.map((b) => (
            <Link key={b.id} href={`/market/${b.slug}`} className="marketCard">
              <div className="art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.hero_image_url ? <img src={b.hero_image_url} alt="" /> : <MarketArt name={b.name} category={b.category_name} />}
                {b.featured && <span className="marketFeatured">Featured</span>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.logo_url && <img className="logo" src={b.logo_url} alt="" />}
              </div>
              <div className="body">
                <div className="marketCategory">{b.category_name ?? 'Independent'}</div>
                <h3>{b.name}</h3>
                {b.offer ? <div className="marketOfferLine">{offerHeadline(b.offer)}</div> : b.tagline && <div className="youHistoryMeta">{b.tagline}</div>}
                {(b.city || b.country) && <div className="place">{[b.city, b.country].filter(Boolean).join(', ')}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {businesses.length > 0 && (
        <div className="mbFoot">
          <span className="adminSub" style={{ margin: 0 }}>Offers are provided by each business and have their own terms. Independent businesses we like — <Link href="/market/apply" style={{ textDecoration: 'underline' }}>apply to join</Link>.</span>
          <Link href="/membership" className="btnGhost">Membership</Link>
        </div>
      )}
    </main>
  );
}
