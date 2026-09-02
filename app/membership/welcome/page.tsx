// After Stripe Checkout. The webhook usually lands before the redirect; if
// it has not yet, say so honestly rather than pretending.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentMemberWithMembership } from '@/lib/membership';
import { reconcileCheckoutSession, type ReconcileOutcome } from '@/lib/stripeReconcile';

export const dynamic = 'force-dynamic';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  let me = await currentMemberWithMembership();
  if (!me) redirect('/login?next=/you/membership');
  // Stripe sends people here with the Checkout session id. If the webhook
  // has not activated them yet (or never will, because the endpoint is
  // misconfigured), ask Stripe directly and activate on the spot.
  const { session_id: sessionId } = await searchParams;
  let outcome: ReconcileOutcome | null = null;
  if (!me.isMember && sessionId) {
    const r = await reconcileCheckoutSession(me.id, sessionId).catch(() => ({ outcome: 'error' as const }));
    outcome = r.outcome;
    if (r.outcome === 'activated' || r.outcome === 'applied' || r.outcome === 'already') me = (await currentMemberWithMembership()) ?? me;
  }
  const waiting = outcome === 'unpaid' ? 'Stripe says this payment has not completed yet. If you finished paying, give it a minute and refresh — or check your card was accepted.'
    : outcome === 'error' ? 'We could not confirm the payment with Stripe just now. Refresh in a moment; your membership page will show it as soon as it lands.'
    : 'Your payment is being confirmed — this usually takes a few seconds. Refresh in a moment, or check your membership page.';
  const first = me.display_name.split(' ')[0];
  return (
    <main className="wrap">
      <section className="mbHero" style={{ textAlign: 'center' }}>
        <div className="mbKicker">Guestlist Membership</div>
        <h1 className="mbTitle" style={{ fontSize: 'clamp(44px, 10vw, 110px)' }}>{me.isMember ? 'You’re in.' : 'Nearly there.'}</h1>
        <p className="mbLead" style={{ margin: '0 auto 30px' }}>
          {me.isMember
            ? `${first}, welcome to Guestlist. See something you want to go to? Ask us to get you in.`
            : waiting}
        </p>
        <div className="mbCtaRow" style={{ justifyContent: 'center' }}>
          <Link href="/events" className="mbCta">Find something tonight</Link>
          <Link href="/you/membership" className="btnGhost">Your membership</Link>
        </div>
      </section>
    </main>
  );
}
