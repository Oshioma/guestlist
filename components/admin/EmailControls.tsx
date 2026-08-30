'use client';

// Safety switches: stop runaway email without a deployment.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SafetySwitches } from '@/lib/settings';

const SWITCHES: [keyof Omit<SafetySwitches, 'paused_alert_types'>, string][] = [
  ['pause_recommendation_emails', 'Pause all recommendation & alert email'],
  ['pause_promoter_digests', 'Pause promoter digests'],
  ['pause_event_reminders', 'Pause event reminders'],
];

export function EmailControls({ switches }: { switches: SafetySwitches }) {
  const router = useRouter();
  const [state, setState] = useState(switches);
  const [pauseType, setPauseType] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/admin/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.switches) setState(data.switches);
    else if (res.ok) setMsg(`Done — sent ${data.sent ?? 0}, failed ${data.failed ?? 0}, dev-logged ${data.devLogged ?? 0}`);
    else setMsg(data.error ?? 'Failed');
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="adminRow" style={{ display: 'grid', gap: 10 }}>
      <div className="sectionLabel" style={{ margin: 0 }}>Safety switches</div>
      {SWITCHES.map(([key, label]) => (
        <label className="notifPrefRow" key={key}>
          <input
            type="checkbox"
            checked={state[key]}
            disabled={busy}
            onChange={() => act({ action: 'set_switch', key, value: !state[key] })}
          />
          {label} {state[key] && <strong style={{ color: 'var(--danger)' }}>PAUSED</strong>}
        </label>
      ))}
      {state.paused_alert_types.length > 0 && (
        <div className="youHistoryMeta">
          Paused types: {state.paused_alert_types.map((t) => (
            <button key={t} className="chip" type="button" disabled={busy}
                    onClick={() => act({ action: 'resume_type', type: t })}>
              {t} ✕
            </button>
          ))}
        </div>
      )}
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (pauseType.trim()) act({ action: 'pause_type', type: pauseType.trim() });
          setPauseType('');
        }}
      >
        <input
          placeholder="Pause a type (e.g. alert:event, daily_digest)"
          value={pauseType}
          onChange={(e) => setPauseType(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 8,
                   color: 'var(--text)', padding: '8px 10px', minWidth: 260 }}
        />
        <button className="btnGhost" type="submit" disabled={busy}>Pause type</button>
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => act({ action: 'retry_failed' })}>
          Retry failed
        </button>
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => act({ action: 'process_queue' })}>
          Process queue now
        </button>
      </form>
      {msg && <div className="youHistoryMeta">{msg}</div>}
    </div>
  );
}
