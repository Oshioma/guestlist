// After Stripe Checkout. The webhook usually lands before the redirect; if
// it has not yet, say so honestly rather than pretending.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMemberWithMembership } from '@/lib/membership';

export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const me = await currentMemberWithMembership();
  if (!me) redirect('/login?next=/you/membership');
  const first = me.display_name.split(' ')[0];
  return (
    <main className="wrap">
      <section className="mbHero" style={{ textAlign: 'center' }}>
        <div className="mbKicker">Guestlist Membership</div>
        <h1 className="mbTitle" style={{ fontSize: 'clamp(44px, 10vw, 110px)' }}>{me.isMember ? 'You’re in.' : 'Nearly there.'}</h1>
        <p className="mbLead" style={{ margin: '0 auto 30px' }}>
          {me.isMember
            ? `${first}, welcome to Guestlist. See something you want to go to? Ask us to get you in.`
            : 'Your payment is being confirmed — this usually takes a few seconds. Refresh in a moment, or check your membership page.'}
        </p>
        <div className="mbCtaRow" style={{ justifyContent: 'center' }}>
          <Link href="/events" className="mbCta">Find something tonight</Link>
          <Link href="/you/membership" className="btnGhost">Your membership</Link>
        </div>
      </section>
    </main>
  );
}
