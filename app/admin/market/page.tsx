// ADMIN → MARKET: who is in, who is asking, and what the Market is doing.

import Link from 'next/link';
import { adminListBusinesses, listCategories } from '@/lib/market';
import { marketOverview } from '@/lib/membershipStats';
import { BusinessDecision, CreateBusiness } from '@/components/admin/MarketDesk';

export const dynamic = 'force-dynamic';

export default async function AdminMarketPage() {
  const [businesses, categories, stats] = await Promise.all([adminListBusinesses(), listCategories(), marketOverview()]);
  const applications = businesses.filter((b) => b.status === 'applied' || b.status === 'pending');
  const rest = businesses.filter((b) => !applications.includes(b));

  return (
    <main>
      <h1 className="adminTitle">Guestlist Market</h1>
      <p className="adminSub">Independent businesses we like. Nobody appears until Guestlist says so.</p>

      <div className="statGrid">
        {([
          [stats.approved, 'In the Market'], [stats.applications, 'Applications'], [stats.live_offers, 'Live offers'],
          [stats.claims_30d, 'Claims · 30d'], [stats.redemptions_30d, 'Redeemed · 30d'], [stats.claims_total, 'Claims · all time'],
        ] as [number, string][]).map(([v, l]) => (
          <div className="statTile" key={l}><div className="v">{v.toLocaleString()}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <CreateBusiness categories={categories} />

      <div className="sectionLabel" style={{ marginTop: 26 }}>Applications ({applications.length})</div>
      {applications.length === 0 && <p className="adminSub">Nothing waiting.</p>}
      {applications.map((b) => (
        <div className="reviewCard" key={b.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <div>
            <h3><Link href={`/admin/market/${b.id}`} style={{ textDecoration: 'underline' }}>{b.name}</Link> <span className="evChip amber" style={{ marginLeft: 8 }}>{b.status}</span>{!b.hero_image_url && <span className="noImageChip">no photo</span>}</h3>
            <div className="facts">
              <span>{b.category_name ?? 'No category'}{b.city && ` · ${b.city}`}</span>
              {b.website && <span><a href={b.website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>{b.website}</a></span>}
              {b.contact_email && <span>Contact: <b>{b.contact_name ?? ''}</b> {b.contact_email}</span>}
              <span>{b.offers} offer{b.offers === 1 ? '' : 's'} proposed · {b.team} account{b.team === 1 ? '' : 's'}</span>
            </div>
            {b.tagline && <div className="warnList" style={{ color: 'var(--text-muted)' }}>“{b.tagline}”</div>}
          </div>
          <div className="actions"><BusinessDecision businessId={b.id} status={b.status} /></div>
        </div>
      ))}

      <div className="sectionLabel" style={{ marginTop: 26 }}>Businesses ({rest.length})</div>
      {rest.length === 0 && <p className="adminSub">None yet — add one by hand or wait for applications.</p>}
      {rest.map((b) => (
        <div className="attentionRow" key={b.id}>
          <span>
            <Link href={`/admin/market/${b.id}`} style={{ textDecoration: 'underline' }}><b>{b.name}</b></Link>{' '}
            <span className={`evChip ${b.status === 'approved' ? 'green' : b.status === 'paused' || b.status === 'invited' ? 'amber' : 'red'}`}>{b.status}</span>
            {b.featured && <span className="evChip" style={{ marginLeft: 6 }}>featured</span>}
            {!b.hero_image_url && <span className="noImageChip">no photo</span>}
            <span style={{ color: 'var(--text-faint)', fontSize: 12, marginLeft: 8 }}>{b.category_name ?? ''}{b.city && ` · ${b.city}`} · {b.live_offers} live offer{b.live_offers === 1 ? '' : 's'} · {b.claims} claims · {b.redemptions} redeemed</span>
          </span>
          <BusinessDecision businessId={b.id} status={b.status} />
        </div>
      ))}

      {stats.top_businesses.length > 0 && (
        <>
          <div className="sectionLabel" style={{ marginTop: 30 }}>Most interest</div>
          {stats.top_businesses.map((b) => (
            <div className="attentionRow" key={b.id}>
              <span><Link href={`/market/${b.slug}`} style={{ textDecoration: 'underline' }}><b>{b.name}</b></Link></span>
              <span style={{ fontSize: 12.5 }}>{b.views_30d} views · {b.claims} claims · {b.redemptions} redeemed</span>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
