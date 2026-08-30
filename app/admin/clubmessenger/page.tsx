// ADMIN → CLUB MESSENGER: reported room messages + club suspensions.

import { query } from '@/lib/db';
import { ClubModerationRow, ClubSuspendControl } from '@/components/admin/ClubModeration';

export const dynamic = 'force-dynamic';

export default async function AdminClubMessengerPage() {
  const [reported, suspended, stats] = await Promise.all([
    query<{
      id: string; body: string; created_at: string; report_count: number;
      deleted_at: string | null; event_title: string; member_id: string;
      author_name: string; author_suspended: string | null;
      reasons: (string | null)[];
    }>(
      `select msg.id, msg.body, msg.created_at::text, msg.report_count,
              msg.deleted_at::text, e.title as event_title,
              m.id as member_id, m.display_name as author_name,
              m.club_suspended_at::text as author_suspended,
              coalesce(array_agg(r.reason) filter (where r.reason is not null), '{}') as reasons
         from event_room_messages msg
         join events e on e.id = msg.event_id
         join members m on m.id = msg.member_id
         left join room_message_reports r on r.message_id = msg.id
        where msg.report_count > 0 or msg.deleted_at is not null
        group by msg.id, e.title, m.id
        order by (msg.deleted_at is null) desc, msg.report_count desc, msg.created_at desc
        limit 100`
    ),
    query<{ id: string; display_name: string; email: string; club_suspended_at: string }>(
      `select id, display_name, email, club_suspended_at::text
         from members where club_suspended_at is not null
        order by club_suspended_at desc`
    ),
    query<{ messages_24h: number; presences_24h: number; pings_24h: number }>(
      `select
         (select count(*)::int from event_room_messages where created_at > now() - interval '24 hours') as messages_24h,
         (select count(*)::int from event_presence where arrived_at > now() - interval '24 hours') as presences_24h,
         (select count(*)::int from club_pings where created_at > now() - interval '24 hours') as pings_24h`
    ),
  ]);
  const s = stats[0];

  return (
    <main>
      <h1 className="adminTitle">Club Messenger</h1>
      <p className="adminSub">
        Last 24h: {s.presences_24h} check-ins · {s.messages_24h} room messages ·{' '}
        {s.pings_24h} pings. Removal is a soft delete and is audit-logged.
      </p>

      <h2 className="sectionLabel">Reported messages</h2>
      {reported.length === 0 && <p className="adminSub">No reported messages.</p>}
      {reported.map((r) => (
        <ClubModerationRow
          key={r.id}
          message={{
            id: r.id,
            body: r.body,
            createdAt: r.created_at,
            reportCount: r.report_count,
            deleted: !!r.deleted_at,
            eventTitle: r.event_title,
            authorId: r.member_id,
            authorName: r.author_name,
            authorSuspended: !!r.author_suspended,
            reasons: r.reasons.filter(Boolean) as string[],
          }}
        />
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 28 }}>Suspended members</h2>
      {suspended.length === 0 && <p className="adminSub">Nobody is suspended from Club Messenger.</p>}
      {suspended.map((m) => (
        <div className="adminRow" key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <strong>{m.display_name}</strong>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              {m.email} · suspended {new Date(m.club_suspended_at).toLocaleString()}
            </span>
          </div>
          <ClubSuspendControl memberId={m.id} suspended />
        </div>
      ))}
    </main>
  );
}
