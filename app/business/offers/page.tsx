// Business portal — OFFERS.

import { businessDashContext } from '@/lib/marketAuth';
import { getBusinessById } from '@/lib/market';
import { BusinessShell } from '@/components/business/BusinessShell';
import { OfferList } from '@/components/business/OfferEditor';

export const dynamic = 'force-dynamic';

export default async function BusinessOffersPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const ctx = await businessDashContext((await searchParams).b);
  if (ctx.kind !== 'ok') return <BusinessShell ctx={ctx} tab="/offers">{null}</BusinessShell>;
  const b = await getBusinessById(ctx.active.id);
  return (
    <BusinessShell ctx={ctx} tab="/offers">
      <div className="sectionLabel">Member offers</div>
      <p className="adminSub">
        A percentage, an amount off, a free item or upgrade, a package, something only members can have — whatever suits you.
        New offers and changes to what an offer is are checked by Guestlist before they go live; pausing or changing dates is instant.
      </p>
      <OfferList businessId={ctx.active.id} offers={b?.offers ?? []} endpoint="portal" />
    </BusinessShell>
  );
}
