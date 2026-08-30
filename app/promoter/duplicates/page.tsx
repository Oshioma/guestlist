// Promoter dashboard — DUPLICATES: flag duplicate representations of your
// own events. Uses V2A duplicate scoring for suggestions; final destructive
// merges stay with Guestlist admins.

import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { query } from '@/lib/db';
import { fmtDate } from '@/lib/util';
import { DuplicateRequestForm } from '@/components/promoter/DuplicateRequestForm';

export const dynamic = 'force-dynamic';

export default async function PromoterDuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/duplicates">{null}</DashShell>;
  }
  const promoter = ctx.active;

  const [flagged, events, requests] = await Promise.all([
    // The supply engine's own duplicate suspicions for this promoter.
    query<{ id: string; title: string; start_at: string; timezone: string; dup_title: string | null }>(
      `select e.id, e.title, e.start_at::text, e.timezone, d.title as dup_title
         from events e left join events d on d.id = e.possible_duplicate_of
        where e.promoter_id = $1 and e.possible_duplicate_of is not null
          and e.status <> 'rejected'
        order by e.start_at limit 20`,
      [promoter.id]
    ),
    query<{ id: string; title: string; start_at: string; timezone: string }>(
      `select id, title, start_at::text, timezone from events
        where promoter_id = $1 and status in ('live', 'needs_review')
          and coalesce(end_at, start_at + interval '6 hours') > now()
        order by start_at limit 60`,
      [promoter.id]
    ),
    query<{
      id: string; action: string; status: string; note: string | null;
      created_at: string; event_title: string; duplicate_title: string;
    }>(
      `select r.id, r.action, r.status, r.note, r.created_at::text,
              e1.title as event_title, e2.title as duplicate_title
         from event_duplicate_requests r
         join events e1 on e1.id = r.event_id
         join events e2 on e2.id = r.duplicate_of_event_id
        where r.promoter_id = $1 order by r.created_at desc limit 30`,
      [promoter.id]
    ),
  ]);

  return (
    <DashShell ctx={ctx} tab="/duplicates">
      <h2 className="sectionLabel">Possible duplicates the engine flagged</h2>
      {flagged.length === 0 ? (
        <p className="adminSub">Nothing flagged right now — your listings look clean.</p>
      ) : (
        flagged.map((e) => (
          <div className="adminRow" key={e.id}>
            <strong>{e.title}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {fmtDate(e.start_at, e.timezone, { day: 'numeric', month: 'short' })}
              {e.dup_title && ` — possibly the same as “${e.dup_title}”`}
            </span>
          </div>
        ))
      )}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>Flag a duplicate</h2>
      <p className="adminSub">
        Tell us when the same night is listed twice. Merges are reviewed by
        Guestlist before anything is removed.
      </p>
      <DuplicateRequestForm
        promoterId={promoter.id}
        events={events.map((e) => ({
          id: e.id, title: e.title,
          start: fmtDate(e.start_at, e.timezone, { day: 'numeric', month: 'short' }),
        }))}
      />

      {requests.length > 0 && (
        <>
          <h2 className="sectionLabel" style={{ marginTop: 24 }}>Your requests</h2>
          {requests.map((r) => (
            <div className="adminRow" key={r.id}>
              “{r.duplicate_title}” → “{r.event_title}”{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {r.action} · {r.status}
              </span>
            </div>
          ))}
        </>
      )}
    </DashShell>
  );
}
