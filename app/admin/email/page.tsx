// ADMIN → EMAIL: queue health, delivery outcomes, unsubscribe rate,
// safety switches. Not a marketing automation suite.

import { query } from '@/lib/db';
import { getSafetySwitches } from '@/lib/settings';
import { EmailControls } from '@/components/admin/EmailControls';

export const dynamic = 'force-dynamic';

export default async function AdminEmailPage() {
  const [today, byType, failures, suppressions, switches, notifStats] = await Promise.all([
    query<{ status: string; n: number }>(
      `select status, count(*)::int as n from email_outbox
        where created_at > now() - interval '24 hours' group by status order by n desc`
    ),
    query<{ email_type: string; n: number; sent: number; failed: number }>(
      `select split_part(email_type, ':', 1) as email_type, count(*)::int as n,
              count(*) filter (where status in ('sent', 'dev_logged'))::int as sent,
              count(*) filter (where status = 'failed')::int as failed
         from email_outbox where created_at > now() - interval '7 days'
        group by 1 order by n desc limit 20`
    ),
    query<{ recipient_email: string; email_type: string; error: string | null; attempt_count: number; created_at: string }>(
      `select recipient_email, email_type, error, attempt_count, created_at::text
         from email_outbox where status = 'failed'
        order by created_at desc limit 15`
    ),
    query<{ scope: string; n: number }>(
      `select scope, count(*)::int as n from email_suppressions group by scope order by n desc`
    ),
    getSafetySwitches(),
    query<{ type: string; n: number; unread: number }>(
      `select type, count(*)::int as n, count(*) filter (where read_at is null)::int as unread
         from notifications where created_at > now() - interval '7 days'
        group by type order by n desc`
    ),
  ]);

  const stat = (s: string) => today.find((t) => t.status === s)?.n ?? 0;
  const sentTotal = byType.reduce((a, t) => a + t.sent, 0);
  const unsubTotal = suppressions.reduce((a, s) => a + s.n, 0);
  const unsubRate = sentTotal > 0 ? ((unsubTotal / sentTotal) * 100).toFixed(1) : '0.0';

  return (
    <main>
      <h1 className="adminTitle">Email & notifications</h1>
      <p className="adminSub">
        Last 24h: {stat('sent') + stat('dev_logged')} delivered ({stat('dev_logged')} dev-logged) ·{' '}
        {stat('pending')} queued · {stat('failed')} failed · {stat('suppressed')} suppressed.
        Unsubscribed addresses: {unsubTotal} ({unsubRate}% of 7-day sends).
      </p>

      <EmailControls switches={switches} />

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>By type (7 days)</h2>
      <div className="adminRow" style={{ overflowX: 'auto' }}>
        <table className="cityHealthTable">
          <thead><tr><th>Type</th><th>Queued</th><th>Delivered</th><th>Failed</th></tr></thead>
          <tbody>
            {byType.map((t) => (
              <tr key={t.email_type}>
                <td>{t.email_type}</td><td>{t.n}</td><td>{t.sent}</td><td>{t.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>In-app notifications (7 days)</h2>
      {notifStats.map((n) => (
        <div key={n.type} className="adminSub" style={{ marginBottom: 3 }}>
          {n.type}: {n.n} created · {n.unread} unread
        </div>
      ))}

      <h2 className="sectionLabel" style={{ marginTop: 24 }}>Recent failures</h2>
      {failures.length === 0 && <p className="adminSub">No failures on record.</p>}
      {failures.map((f, i) => (
        <div className="adminRow" key={i}>
          <strong>{f.email_type}</strong>{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            → {f.recipient_email} · attempt {f.attempt_count} · {f.error?.slice(0, 140)}
          </span>
        </div>
      ))}
    </main>
  );
}
