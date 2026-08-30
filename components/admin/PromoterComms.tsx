'use client';

// Admin controls for the promoter announcement channel.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function useCommsAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/promoter-comms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Failed'); return; }
    router.refresh();
  }
  return { run, busy, error };
}

export function GlobalPause({ paused }: { paused: boolean }) {
  const { run, busy } = useCommsAction();
  return (
    <div className="adminRow" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <strong style={{ flex: 1 }}>
        {paused ? '⏸ ALL promoter announcements are PAUSED' : 'Announcement channel running'}
      </strong>
      <button className={paused ? 'btnAccent' : 'btnGhost'} type="button" disabled={busy}
              onClick={() => run({ action: paused ? 'unpause_all' : 'pause_all' })}>
        {paused ? 'Resume channel' : 'Pause everything'}
      </button>
    </div>
  );
}

export function CapsForm({ caps }: { caps: Record<string, number> }) {
  const { run, busy, error } = useCommsAction();
  const [form, setForm] = useState({ ...caps });
  const LABELS: [string, string][] = [
    ['per_promoter_per_7d', 'Max announcements / promoter / 7 days'],
    ['same_event_type_days', 'Same event+type suppression (days)'],
    ['min_aggregate', 'Privacy floor (min group size)'],
    ['batch_size', 'Delivery batch size'],
  ];
  return (
    <div className="adminRow" style={{ display: 'grid', gap: 8 }}>
      <div className="sectionLabel" style={{ margin: 0 }}>Central caps</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {LABELS.map(([k, label]) => (
          <label key={k} style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            {label}
            <input type="number" min={0} value={form[k] ?? 0}
                   onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                   style={{ width: 90, background: 'var(--bg)', border: '1px solid var(--border-strong)',
                            borderRadius: 8, color: 'var(--text)', padding: '6px 8px' }} />
          </label>
        ))}
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => run({ action: 'set_caps', ...form })}>
          Save caps
        </button>
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}

export function CommsActions({
  announcementId, status, promoterId, paused,
}: {
  announcementId?: string;
  status?: string;
  promoterId?: string;
  paused?: boolean;
}) {
  const { run, busy, error } = useCommsAction();
  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {announcementId && ['draft', 'scheduled', 'queued', 'sending'].includes(status ?? '') && (
        <button className="recHide" type="button" disabled={busy}
                onClick={() => run({ action: 'block_announcement', announcementId, reason: 'Blocked by admin' })}>
          block
        </button>
      )}
      {promoterId && (
        <button className={paused ? 'btnAccent' : 'btnGhost'} type="button" disabled={busy}
                style={{ padding: '5px 10px', fontSize: 11 }}
                onClick={() => run({ action: paused ? 'unpause_promoter' : 'pause_promoter', promoterId })}>
          {paused ? 'Resume' : 'Pause announcements'}
        </button>
      )}
      {error && <span className="formError">{error}</span>}
    </span>
  );
}
