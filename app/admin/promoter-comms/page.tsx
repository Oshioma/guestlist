// ADMIN → PROMOTER COMMUNICATIONS. Recent announcements with delivery and
// complaints, per-promoter pause, per-announcement block, central caps,
// global pause, and the audit trail. Oversight, not a CRM.

import { query } from '@/lib/db';
import { announcementCaps, announcementsGloballyPaused } from '@/lib/announcements';
import { CapsForm, CommsActions, GlobalPause } from '@/components/admin/PromoterComms';

export const dynamic = 'force-dynamic';

export default async function AdminPromoterCommsPage() {
  const [announcements, promoters, auditRows, caps, paused] = await Promise.all([
    query<{
      id: string; status: string; update_type: string; audience: string; note: string | null;
      created_at: string; sent_at: string | null; delivered_inapp: number; delivered_email: number;
      blocked_reason: string | null; promoter_name: string; promoter_id: string; event_title: string;
      unsubs: number; clicks: number;
    }>(
      `select a.id, a.status, a.update_type, a.audience, a.note, a.created_at::text,
              a.sent_at::text, a.delivered_inapp, a.delivered_email, a.blocked_reason,
              p.name as promoter_name, p.id as promoter_id, e.title as event_title,
              (select count(*)::int from email_suppressions s
                where s.scope = 'promoter_announcements' and a.sent_at is not null
                  and s.created_at > a.sent_at) as unsubs,
              (select count(*)::int from analytics_events ae
                where ae.event_type = 'event_viewed' and ae.event_id = a.event_id
                  and ae.metadata->>'src' = 'ann-' || left(a.id::text, 8)) as clicks
         from promoter_announcements a
         join promoters p on p.id = a.promoter_id
         join events e on e.id = a.event_id
        order by a.created_at desc limit 30`
    ),
    query<{ id: string; name: string; announcements_paused: boolean; sent: number }>(
      `select p.id, p.name, p.announcements_paused,
              (select count(*)::int from promoter_announcements a
                where a.promoter_id = p.id and a.status = 'sent') as sent
         from promoters p
        where p.claim_status = 'verified'
        order by sent desc, p.name limit 30`
    ),
    query<{ action: string; detail: string | null; created_at: string; promoter_name: string; actor: string | null }>(
      `select au.action, au.detail, au.created_at::text, p.name as promoter_name,
              m.display_name as actor
         from promoter_announcement_audit au
         join promoters p on p.id = au.promoter_id
         left join members m on m.id = au.actor_member_id
        order by au.created_at desc limit 30`
    ),
    announcementCaps(),
    announcementsGloballyPaused(),
  ]);

  return (
    <main>
      <h1 className="adminTitle">Promoter communications</h1>
      <GlobalPause paused={paused} />
      <CapsForm caps={caps} />

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>{`Recent announcements (${announcements.length})`}</h2>
      {announcements.length === 0 && <p className="adminSub">None yet.</p>}
      {announcements.map((a) => (
        <div className="adminRow" key={a.id} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{a.promoter_name}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{a.event_title}</span>
            <span className={`statePill${a.status === 'sent' ? ' active' : ''}`}>{a.status}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {a.update_type.replace(/_/g, ' ')} · {a.audience.replace(/_/g, ' ')}
            </span>
            <CommsActions announcementId={a.id} status={a.status} />
          </div>
          {a.note && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>“{a.note}”</div>}
          <div className="youHistoryMeta">
            {`${a.delivered_inapp} in-app · ${a.delivered_email} email · ${a.clicks} attributed views · ${a.unsubs} unsubscribed since`}
            {a.blocked_reason && ` · blocked: ${a.blocked_reason}`}
          </div>
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>Verified promoters</h2>
      {promoters.map((p) => (
        <div className="adminRow" key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ flex: 1, minWidth: 160 }}>{p.name}</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{`${p.sent} sent`}</span>
          <CommsActions promoterId={p.id} paused={p.announcements_paused} />
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>Audit trail</h2>
      {auditRows.map((r, i) => (
        <div className="adminRow" key={i} style={{ fontSize: 13 }}>
          <strong>{r.promoter_name}</strong>{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            {r.action}{r.detail ? ` · ${r.detail}` : ''}{r.actor ? ` · by ${r.actor}` : ''} ·{' '}
            {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </main>
  );
}
