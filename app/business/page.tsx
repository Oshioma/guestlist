// Business portal — OVERVIEW.

import Link from 'next/link';
import { businessDashContext } from '@/lib/marketAuth';
import { businessStats, getBusinessById, OFFER_LIVE_SQL } from '@/lib/market';
import { queryOne } from '@/lib/db';
import { BusinessShell } from '@/components/business/BusinessShell';

export const dynamic = 'force-dynamic';

export default async function BusinessOverviewPage({ searchParams }: { searchParams: Promise<{ b?: string; applied?: string }> }) {
  const sp = await searchParams;
  const ctx = await businessDashContext(sp.b);
  if (ctx.kind !== 'ok') return <BusinessShell ctx={ctx} tab="">{null}</BusinessShell>;
  const q = ctx.businesses.length > 1 ? `?b=${ctx.active.id}` : '';
  const [business, stats, liveOffer] = await Promise.all([
    getBusinessById(ctx.active.id), businessStats(ctx.active.id),
    queryOne(`select 1 from market_offers o where o.business_id = $1 and ${OFFER_LIVE_SQL}`, [ctx.active.id]),
  ]);
  const steps: [string, boolean, string][] = [
    ['Describe the business', !!(business?.description && business?.category_id), `/business/profile${q}`],
    ['Add a logo and a photo', !!(business?.logo_url && business?.hero_image_url), `/business/profile${q}`],
    ['Create your member offer', (business?.offers.length ?? 0) > 0, `/business/offers${q}`],
    ['Offer live to members', !!liveOffer && business?.status === 'approved', `/business/offers${q}`],
  ];
  return (
    <BusinessShell ctx={ctx} tab="">
      {sp.applied && <div className="formOk" style={{ marginBottom: 14 }}>Application sent. Guestlist will come back to you by email.</div>}
      <div className="statGrid">
        {([
          [stats.views_30d, 'Views · 30d'],
          [stats.claims_30d, 'Offers claimed · 30d'],
          [stats.redemptions_30d, 'Redeemed · 30d'],
          [stats.unique_members, 'Members reached'],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v">{v.toLocaleString()}</div><div className="l">{l}</div></div>
        ))}
      </div>
      {steps.some(([, done]) => !done) && (
        <div className="sideCard" style={{ maxWidth: 460 }}>
          <div className="big" style={{ marginBottom: 8 }}>Getting set up</div>
          {steps.map(([label, done, href], i) => (
            <Link href={href} key={label} className={`onboardStep${done ? ' done' : ''}`} style={{ display: 'flex' }}>
              <span className="tick">{done ? '✓' : i + 1}</span>{label}
            </Link>
          ))}
        </div>
      )}
      <div className="sectionLabel" style={{ marginTop: 26 }}>At the counter</div>
      <p className="adminSub">A member shows a code on their phone — GL-XXXX-XXXX. Type it into <Link href={`/business/redeem${q}`} style={{ textDecoration: 'underline' }}>Redeem</Link> and it’s done. Codes are single-use and expire, so a screenshot shared online is worth nothing.</p>
    </BusinessShell>
  );
}
