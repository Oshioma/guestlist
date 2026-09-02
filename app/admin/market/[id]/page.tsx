// ADMIN → MARKET → one business: listing, offers, team, placement.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query, queryOne } from '@/lib/db';
import { businessStats, getBusinessById, listCategories } from '@/lib/market';
import { BusinessControls, BusinessDecision, TeamControls } from '@/components/admin/MarketDesk';
import { BusinessProfileForm } from '@/components/business/BusinessProfileForm';
import { OfferList } from '@/components/business/OfferEditor';

export const dynamic = 'force-dynamic';

export default async function AdminMarketBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await getBusinessById(id);
  if (!b) notFound();
  const [categories, extra, team, stats] = await Promise.all([
    listCategories(),
    queryOne<{ contact_name: string | null; contact_email: string | null; admin_notes: string | null }>(
      `select contact_name, contact_email, admin_notes from market_businesses where id = $1`, [id]),
    query<{ member_id: string; display_name: string; email: string; role: string }>(
      `select m.id as member_id, m.display_name, m.email, bm.role from market_business_members bm join members m on m.id = bm.member_id where bm.business_id = $1`, [id]),
    businessStats(id),
  ]);

  return (
    <main>
      <p className="adminSub" style={{ marginBottom: 6 }}><Link href="/admin/market" style={{ textDecoration: 'underline' }}>← Market</Link></p>
      <h1 className="adminTitle" style={{ marginBottom: 4 }}>{b.name}</h1>
      <p className="adminSub">
        <span className={`evChip ${b.status === 'approved' ? 'green' : b.status === 'rejected' ? 'red' : 'amber'}`}>{b.status}</span>
        {b.featured && <span className="evChip" style={{ marginLeft: 6 }}>featured</span>}
        {b.status === 'approved' && <> · <Link href={`/market/${b.slug}`} style={{ textDecoration: 'underline' }}>view in the Market</Link></>}
        {' · '}{stats.claims_total} claims · {stats.redemptions_total} redeemed · {stats.views_30d} views in 30d
      </p>
      <BusinessDecision businessId={b.id} status={b.status} />

      <div className="deskGrid" style={{ marginTop: 18 }}>
        <div>
          <div className="sectionLabel">Listing</div>
          <BusinessProfileForm
            businessId={b.id}
            endpoint="admin"
            categories={categories}
            initial={{
              name: b.name, tagline: b.tagline ?? '', description: b.description ?? '', categoryId: b.category_id ?? '',
              city: b.city ?? '', country: b.country ?? '', address: b.address ?? '', website: b.website ?? '',
              logoUrl: b.logo_url ?? '', heroImageUrl: b.hero_image_url ?? '',
              contactName: extra?.contact_name ?? '', contactEmail: extra?.contact_email ?? '', socials: b.socials ?? {},
            }}
          />
        </div>
        <div>
          <div className="sectionLabel">Placement</div>
          <BusinessControls businessId={b.id} featured={b.featured} sortOrder={b.sort_order} adminNotes={extra?.admin_notes ?? ''} />
          <div className="sectionLabel" style={{ marginTop: 20 }}>Offers</div>
          <OfferList businessId={b.id} offers={b.offers} endpoint="admin" />
          <div className="sectionLabel" style={{ marginTop: 20 }}>Portal access</div>
          <TeamControls businessId={b.id} team={team} />
        </div>
      </div>
    </main>
  );
}
