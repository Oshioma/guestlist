// ADMIN → NETWORK: scene-entity moderation, member reports, promoter
// duplicate requests, city health, email outbox.

import { query } from '@/lib/db';
import { cityHealth } from '@/lib/cityHealth';
import {
  DuplicateActions, ReportActions, SceneEntityActions,
} from '@/components/admin/NetworkModeration';

export const dynamic = 'force-dynamic';

export default async function AdminNetworkPage() {
  const [pendingEntities, reports, duplicates, cities, emails] = await Promise.all([
    query<{
      id: string; name: string; entity_type: string; city: string | null;
      country_name: string | null; active_from_year: number | null; active_to_year: number | null;
      created_by_name: string | null; created_at: string;
    }>(
      `select se.id, se.name, se.entity_type, se.city, se.country_name,
              se.active_from_year, se.active_to_year, m.display_name as created_by_name,
              se.created_at::text
         from scene_entities se left join members m on m.id = se.created_by
        where se.status = 'pending' order by se.created_at limit 50`
    ),
    query<{
      id: string; reason: string | null; created_at: string;
      reporter_name: string; reported_name: string; reported_id: string;
    }>(
      `select r.id, r.reason, r.created_at::text,
              m1.display_name as reporter_name, m2.display_name as reported_name, m2.id as reported_id
         from member_reports r
         join members m1 on m1.id = r.reporter_id
         join members m2 on m2.id = r.reported_id
        where r.status = 'open' order by r.created_at limit 50`
    ),
    query<{
      id: string; action: string; note: string | null; created_at: string;
      event_title: string; duplicate_title: string; promoter_name: string;
    }>(
      `select r.id, r.action, r.note, r.created_at::text,
              e1.title as event_title, e2.title as duplicate_title, p.name as promoter_name
         from event_duplicate_requests r
         join events e1 on e1.id = r.event_id
         join events e2 on e2.id = r.duplicate_of_event_id
         join promoters p on p.id = r.promoter_id
        where r.status = 'pending' order by r.created_at limit 50`
    ),
    cityHealth(),
    query<{ email_type: string; status: string; n: number }>(
      `select email_type, status, count(*)::int as n from email_outbox
        where created_at > now() - interval '7 days'
        group by email_type, status order by n desc limit 20`
    ),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Network</h1>
      <p className="adminSub">
        The global cultural graph: historical places awaiting review, member
        reports, duplicate requests, and whether Guestlist is actually useful
        in each city yet.
      </p>

      <h2 className="sectionLabel">Pending scene entities ({pendingEntities.length})</h2>
      {pendingEntities.length === 0 && <p className="adminSub">Nothing waiting.</p>}
      {pendingEntities.map((e) => (
        <div className="adminRow" key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{e.name}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {e.entity_type} · {[e.city, e.country_name].filter(Boolean).join(', ') || 'location unknown'}
              {e.active_from_year && ` · ${e.active_from_year}–${e.active_to_year ?? '?'}`}
              {e.created_by_name && ` · added by ${e.created_by_name}`}
            </span>
          </div>
          <SceneEntityActions entityId={e.id} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 26 }}>Member reports ({reports.length})</h2>
      {reports.length === 0 && <p className="adminSub">No open reports.</p>}
      {reports.map((r) => (
        <div className="adminRow" key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{r.reported_name}</strong>{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              reported by {r.reporter_name}{r.reason && ` — “${r.reason}”`}
            </span>
          </div>
          <ReportActions reportId={r.id} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 26 }}>Duplicate requests ({duplicates.length})</h2>
      {duplicates.length === 0 && <p className="adminSub">No pending duplicate requests.</p>}
      {duplicates.map((d) => (
        <div className="adminRow" key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{d.promoter_name}</strong>: “{d.duplicate_title}” is a duplicate of “{d.event_title}”{' '}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              ({d.action}{d.note && ` — ${d.note}`})
            </span>
          </div>
          <DuplicateActions requestId={d.id} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 26 }}>City health</h2>
      <div className="adminRow" style={{ overflowX: 'auto' }}>
        <table className="cityHealthTable">
          <thead>
            <tr>
              <th>City</th><th>Status</th><th>Upcoming</th><th>Promoters</th>
              <th>Venues</th><th>Members</th><th>Views 30d</th><th>Going 30d</th><th>Clicks 30d</th>
            </tr>
          </thead>
          <tbody>
            {cities.map((c) => (
              <tr key={c.location_id}>
                <td>{c.name}{c.country_code && ` (${c.country_code})`}</td>
                <td><span className={`cityStatus ${c.status}`}>{c.status}</span></td>
                <td>{c.upcoming_events}</td>
                <td>{c.active_promoters}</td>
                <td>{c.active_venues}</td>
                <td>{c.members}</td>
                <td>{c.views_30d}</td>
                <td>{c.going_30d}</td>
                <td>{c.ticket_clicks_30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sectionLabel" style={{ marginTop: 26 }}>Email (last 7 days)</h2>
      {emails.length === 0 && <p className="adminSub">No email activity.</p>}
      {emails.map((e, i) => (
        <div key={i} className="adminSub" style={{ marginBottom: 4 }}>
          {e.email_type} · {e.status} · {e.n}
        </div>
      ))}
    </main>
  );
}
