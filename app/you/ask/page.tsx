// ASK GUESTLIST — the wider member service. "If I want to go somewhere, I
// ask Guestlist first." Members only; everyone else sees why they'd want it.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { billingEnabled, currentMemberWithMembership, formatPence, getPlan } from '@/lib/membership';
import { AskGuestlist } from '@/components/membership/AskGuestlist';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask Guestlist' };

const CONTEXTS = new Set(['event_page', 'membership_area', 'events_empty', 'ask_panel', 'you']);

export default async function AskPage({ searchParams }: { searchParams: Promise<{ context?: string; q?: string; city?: string }> }) {
  const sp = await searchParams;
  const me = await currentMemberWithMembership();
  if (!me) redirect('/login?next=/you/ask');
  const context = CONTEXTS.has(sp.context ?? '') ? String(sp.context) : 'membership_area';
  if (!me.isMember) {
    const plan = await getPlan();
    const price = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');
    return (
      <main className="wrap" style={{ maxWidth: 720 }}>
        <div className="homeKicker" style={{ marginTop: 34 }}>Guestlist membership</div>
        <h1 style={{ fontSize: 'clamp(30px, 7vw, 54px)', letterSpacing: -1.2, margin: '0 0 10px' }}>Ask Guestlist.</h1>
        <p className="pageStandfirst">Found a party somewhere else — Instagram, a flyer, a promoter’s site? Members send it to Guestlist and we see if we can get them in. Free entrance when we can make it happen, member prices when we can’t, +1s when there’s room.</p>
        <Link href="/membership" className="mbCta" style={{ marginTop: 10 }}>{billingEnabled() ? `Join Guestlist — ${price}/month` : 'Membership coming soon'}</Link>
      </main>
    );
  }
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <div className="homeKicker" style={{ marginTop: 34 }}>Guestlist member</div>
      <h1 style={{ fontSize: 'clamp(30px, 7vw, 54px)', letterSpacing: -1.2, margin: '0 0 8px' }}>Ask Guestlist.</h1>
      <p className="pageStandfirst" style={{ marginBottom: 18 }}>Want to go somewhere? Need a +1? Found an event we don’t have? Paste the link and we’ll see what we can do.</p>
      <AskGuestlist context={context} initialText={(sp.q ?? '').slice(0, 500)} initialCity={(sp.city ?? '').slice(0, 100)} />
      <p className="adminSub" style={{ marginTop: 18 }}>Already looking at an event on Guestlist? Use <b>GET ME IN</b> on the event page — it’s faster. <Link href="/you/membership" style={{ textDecoration: 'underline' }}>Your requests →</Link></p>
    </main>
  );
}
