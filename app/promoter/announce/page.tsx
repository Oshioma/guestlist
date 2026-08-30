// Promoter dashboard — ANNOUNCE TO FOLLOWERS. Structured flow, mobile
// first: pick your event, pick the update type, add an optional short
// note, see the aggregate audience, send or schedule. History below with
// honest attribution.

import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { AnnounceForm, AnnouncementHistory } from '@/components/promoter/Announce';
import { announcementStats, announcementCaps } from '@/lib/announcements';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PromoterAnnouncePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/announce">{null}</DashShell>;
  }
  const promoter = ctx.active;
  const [events, history, caps, cities] = await Promise.all([
    query<{ id: string; title: string; start_at: string; city: string | null; listing_status: string }>(
      `select id, title, start_at::text, city, listing_status from events
        where promoter_id = $1 and status = 'live' and start_at > now()
        order by start_at limit 30`,
      [promoter.id]
    ),
    announcementStats(promoter.id),
    announcementCaps(),
    query<{ id: string; name: string }>(
      `select distinct l.id, l.name
         from member_follows f
         join members m on m.id = f.member_id
         join locations l on l.id = m.home_location_id
        where f.entity_type = 'promoter' and f.entity_id = $1
        order by l.name limit 40`,
      [promoter.id]
    ),
  ]);

  return (
    <DashShell ctx={ctx} tab="/announce">
      <AnnounceForm
        promoterId={promoter.id}
        events={events}
        cities={cities}
        maxPer7Days={caps.per_promoter_per_7d}
      />
      <AnnouncementHistory promoterId={promoter.id} items={history} />
    </DashShell>
  );
}
