// Business portal — REDEEM. Built to be used on a phone behind the counter.

import { businessDashContext } from '@/lib/marketAuth';
import { BusinessShell } from '@/components/business/BusinessShell';
import { RedeemBox } from '@/components/business/RedeemBox';

export const dynamic = 'force-dynamic';

export default async function BusinessRedeemPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const ctx = await businessDashContext((await searchParams).b);
  if (ctx.kind !== 'ok') return <BusinessShell ctx={ctx} tab="/redeem">{null}</BusinessShell>;
  return (
    <BusinessShell ctx={ctx} tab="/redeem">
      <div className="sectionLabel">Redeem a member offer</div>
      <p className="adminSub">The member shows a code on their phone. Type it in. Codes are personal, single-use and expire.</p>
      {ctx.active.status !== 'approved' && ctx.active.status !== 'paused'
        ? <p className="claimStrip">Redemption switches on once your business is in the Market.</p>
        : <RedeemBox businessId={ctx.active.id} />}
    </BusinessShell>
  );
}
