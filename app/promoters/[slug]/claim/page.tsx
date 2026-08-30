import { notFound, redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getPromoterBySlug } from '@/lib/profiles';
import { ClaimForm } from '@/components/ClaimForm';

export const dynamic = 'force-dynamic';

export default async function ClaimPromoterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [promoter, member] = await Promise.all([getPromoterBySlug(slug), getCurrentMember()]);
  if (!promoter) notFound();
  if (!member) redirect(`/login?next=${encodeURIComponent(`/promoters/${slug}/claim`)}`);
  if (promoter.claim_status === 'verified') redirect(`/promoters/${slug}`);

  return (
    <main className="wrap">
      <ClaimForm
        promoterId={promoter.id}
        promoterName={promoter.name}
        promoterSlug={promoter.slug}
        promoterWebsite={promoter.website}
        memberEmail={member.email}
      />
    </main>
  );
}
