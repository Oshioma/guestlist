// The webhook is how Stripe tells us someone paid. It is also the one piece
// of the flow that lives in Stripe's dashboard rather than our code, so a
// wrong URL, a stale signing secret or an endpoint in the other mode leaves
// a paid member staring at the sales page. The welcome page carries the
// Checkout session id, so it can simply ask Stripe: did this session pay?
// If yes, activate through exactly the code the webhook would have used.
//
// Ownership is checked against the session (it must carry this member's
// id), the result is written to the billing ledger under the session id so
// a refresh is a no-op, and a later webhook for the same subscription
// re-applies harmlessly.

import { billingEnabled, applyStripeSubscription, recordBillingEvent, rememberStripeCustomer } from './membership';
import { getSubscription, stripeRequest, StripeError } from './stripe';
import { track } from './analytics';
import { welcomeNewMember } from './membershipWelcome';

export type ReconcileOutcome =
  | 'off'            // billing not switched on
  | 'already'        // this session was reconciled before
  | 'activated'      // paid, and the membership is now active
  | 'applied'        // paid, subscription applied but not active (e.g. incomplete)
  | 'unpaid'         // Stripe says the session has not paid
  | 'no_subscription'
  | 'not_yours'      // the session belongs to another account
  | 'error';

type CheckoutSession = {
  id: string;
  mode: string;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  client_reference_id: string | null;
  customer: string | null;
  subscription: string | null;
  metadata?: Record<string, string>;
};

export async function reconcileCheckoutSession(memberId: string, sessionId: string): Promise<{ outcome: ReconcileOutcome; detail?: string }> {
  if (!billingEnabled()) return { outcome: 'off' };
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { outcome: 'error', detail: 'Not a Checkout session id' };
  let session: CheckoutSession;
  try {
    session = await stripeRequest<CheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    return { outcome: 'error', detail: err instanceof StripeError ? `Stripe ${err.status}: ${err.message}` : String(err) };
  }
  const owner = session.metadata?.member_id ?? session.client_reference_id;
  if (owner !== memberId) return { outcome: 'not_yours' };
  if (session.status !== 'complete' || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) {
    return { outcome: 'unpaid', detail: `${session.status} · ${session.payment_status}` };
  }
  if (!session.subscription) return { outcome: 'no_subscription' };

  // Ledger first, keyed by the session: a refresh of the welcome page does
  // the work once. A real webhook for the same payment has its own event id
  // and still lands in the ledger as normal.
  const fresh = await recordBillingEvent({
    stripeEventId: `reconcile:${session.id}`,
    type: 'checkout.session.reconciled',
    memberId,
    payload: { id: session.id, customer: session.customer, subscription: session.subscription, status: session.status, via: 'welcome_page' },
  });
  if (!fresh) return { outcome: 'already' };

  if (session.customer) await rememberStripeCustomer(memberId, session.customer);
  const sub = await getSubscription(session.subscription);
  const change = await applyStripeSubscription(memberId, sub);
  const nowMember = change.after === 'active' || change.after === 'trialing';
  const wasMember = change.before === 'active' || change.before === 'trialing';
  if (nowMember && !wasMember) {
    await track('membership_started', { memberId, metadata: { via: 'welcome_reconcile' } });
    await welcomeNewMember(memberId);
  }
  return { outcome: nowMember ? 'activated' : 'applied', detail: change.after };
}
