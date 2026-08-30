import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { PromoterEventForm, EMPTY_PROMOTER_EVENT } from '@/components/promoter/PromoterEventForm';
import { roleAtLeast } from '@/lib/promoterAuth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function NewPromoterEventPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/events">{null}</DashShell>;
  }
  if (!roleAtLeast(ctx.active.role, 'editor')) {
    return (
      <DashShell ctx={ctx} tab="/events">
        <p className="adminSub">Your role can’t create events — ask a team admin.</p>
      </DashShell>
    );
  }
  const [genres, venues] = await Promise.all([
    query<{ slug: string; name: string; parent_name: string | null }>(
      `select g.slug, g.name, pg.name as parent_name
         from genres g left join genres pg on pg.id = g.parent_genre_id
        where g.active order by coalesce(pg.sort_order, g.sort_order), g.sort_order`
    ),
    query<{ id: string; name: string }>(`select id, name from venues order by name`),
  ]);
  return (
    <DashShell ctx={ctx} tab="/events">
      <div className="sectionLabel">New event</div>
      <PromoterEventForm promoterId={ctx.active.id} initial={EMPTY_PROMOTER_EVENT} genres={genres} venues={venues} />
    </DashShell>
  );
}
