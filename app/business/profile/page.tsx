// Business portal — LISTING.

import { businessDashContext } from '@/lib/marketAuth';
import { getBusinessById, listCategories } from '@/lib/market';
import { queryOne } from '@/lib/db';
import { BusinessShell } from '@/components/business/BusinessShell';
import { BusinessProfileForm } from '@/components/business/BusinessProfileForm';

export const dynamic = 'force-dynamic';

export default async function BusinessProfilePage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const ctx = await businessDashContext((await searchParams).b);
  if (ctx.kind !== 'ok') return <BusinessShell ctx={ctx} tab="/profile">{null}</BusinessShell>;
  const [b, categories, contact] = await Promise.all([
    getBusinessById(ctx.active.id), listCategories(),
    queryOne<{ contact_name: string | null; contact_email: string | null }>(`select contact_name, contact_email from market_businesses where id = $1`, [ctx.active.id]),
  ]);
  if (!b) return <BusinessShell ctx={ctx} tab="/profile">{null}</BusinessShell>;
  return (
    <BusinessShell ctx={ctx} tab="/profile">
      <div className="sectionLabel">Your listing</div>
      <p className="adminSub">What members see on your Market page. A change to your name or website is checked by Guestlist.</p>
      <BusinessProfileForm
        businessId={b.id}
        endpoint="portal"
        categories={categories}
        initial={{
          name: b.name, tagline: b.tagline ?? '', description: b.description ?? '', categoryId: b.category_id ?? '',
          city: b.city ?? '', country: b.country ?? '', address: b.address ?? '', website: b.website ?? '',
          logoUrl: b.logo_url ?? '', heroImageUrl: b.hero_image_url ?? '',
          contactName: contact?.contact_name ?? '', contactEmail: contact?.contact_email ?? '', socials: b.socials ?? {},
        }}
      />
    </BusinessShell>
  );
}
