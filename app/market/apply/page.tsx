// Apply to join Guestlist Market. Sign in first: the applicant becomes the
// business's owner in the portal once approved.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { listCategories } from '@/lib/market';
import { getMemberBusinesses } from '@/lib/marketAuth';
import { ApplyForm } from '@/components/market/ApplyForm';

export const dynamic = 'force-dynamic';

export default async function MarketApplyPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/market/apply');
  const [categories, mine] = await Promise.all([listCategories(), getMemberBusinesses(member.id)]);
  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <div className="homeKicker" style={{ marginTop: 34 }}>Guestlist Market</div>
      <h1 style={{ fontSize: 'clamp(30px, 6vw, 48px)', letterSpacing: -1, margin: '0 0 10px' }}>Independent business? Give Guestlist members something extra.</h1>
      <p className="pageStandfirst">
        Guestlist Market is a small, chosen set of independent businesses — restaurants, bars, record shops, studios, clothing, places to stay.
        Tell us who you are and what you’d offer members. Guestlist decides who’s in.
      </p>
      {mine.length > 0 && (
        <p className="claimStrip">
          <span>You already manage {mine.map((b) => b.name).join(', ')}.</span>
          <Link href="/business" className="btnGhost">Open your portal →</Link>
        </p>
      )}
      <ApplyForm categories={categories} />
    </main>
  );
}
