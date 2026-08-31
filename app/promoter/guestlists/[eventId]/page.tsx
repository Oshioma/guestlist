import { notFound } from 'next/navigation';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { GuestlistManager } from '@/components/promoter/GuestlistManager';
import { roleAtLeast } from '@/lib/promoterAuth';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function GuestlistEventPage({ params, searchParams }: { params: Promise<{ eventId:string }>; searchParams: Promise<{ p?:string }> }) {
  const [{eventId},sp] = await Promise.all([params,searchParams]);
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') return <DashShell ctx={ctx} tab="/guestlists">{null}</DashShell>;
  const event = await queryOne<{id:string}>(`select id from events where id=$1 and promoter_id=$2`,[eventId,ctx.active.id]);
  if(!event) notFound();
  return <DashShell ctx={ctx} tab="/guestlists">
    <GuestlistManager promoterId={ctx.active.id} eventId={eventId} canEdit={roleAtLeast(ctx.active.role,'editor')}/>
  </DashShell>;
}
