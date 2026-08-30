// Promoter dashboard — EVENTS: import queue (new events found) on top,
// then all events with performance + lifecycle actions.

import Link from 'next/link';
import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { eventPerformance } from '@/lib/promoterAnalytics';
import { PerfCard } from '@/components/promoter/PerfCard';
import { ConfirmAll } from '@/components/promoter/ConfirmAll';
import { roleAtLeast } from '@/lib/promoterAuth';

export const dynamic = 'force-dynamic';

export default async function PromoterEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/events">{null}</DashShell>;
  }
  const promoter = ctx.active;
  const canEdit = roleAtLeast(promoter.role, 'editor');

  const all = await eventPerformance(promoter.id, { limit: 60 });
  const queue = all.filter((e) => e.status === 'new' || e.status === 'needs_review');
  const rest = all.filter((e) => e.status !== 'new' && e.status !== 'needs_review');

  return (
    <DashShell ctx={ctx} tab="/events">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <p className="adminSub" style={{ margin: 0 }}>
          {canEdit
            ? 'Confirm what we found, keep details sharp, and your events stay live everywhere Guestlist reaches.'
            : 'Read-only view — your role can see performance but not edit events.'}
        </p>
        {canEdit && <Link className="btnAccent" href="/promoter/events/new">+ New event</Link>}
      </div>

      {queue.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div className="sectionLabel">New events found — review</div>
            {canEdit && (
              <ConfirmAll
                promoterId={promoter.id}
                eventIds={queue.filter((e) => !e.possible_duplicate_of).map((e) => e.id)}
              />
            )}
          </div>
          {queue.map((e) => (
            <PerfCard key={e.id} event={e} promoterId={promoter.id} showModeration={canEdit} />
          ))}
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: queue.length ? 26 : 0 }}>Your events</div>
      {rest.length ? (
        rest.map((e) => (
          <PerfCard key={e.id} event={e} promoterId={promoter.id} showModeration={canEdit} />
        ))
      ) : (
        <p className="adminSub">No events yet.</p>
      )}
    </DashShell>
  );
}
