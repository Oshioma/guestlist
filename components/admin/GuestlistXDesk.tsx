'use client';

// Client controls for the @guestlist Desk.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function useDeskAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/guestlist-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const problems = Array.isArray(data.problems) && data.problems.length
        ? ` — ${data.problems.join(' · ')}` : '';
      setError(`${data.error ?? 'Failed'}${problems}`);
      return null;
    }
    router.refresh();
    return data;
  }
  return { run, busy, error };
}

export function RunDiscovery() {
  const { run, busy, error } = useDeskAction();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btnAccent" type="button" disabled={busy}
              onClick={async () => {
                const data = await run({ action: 'find_opportunities' });
                if (data) setResult(`${data.created} new · ${data.considered} considered · ${data.expired} expired`);
              }}>
        {busy ? 'Looking…' : 'Look for opportunities'}
      </button>
      {result && <span className="youHistoryMeta">{result}</span>}
      {error && <span className="formError">{error}</span>}
    </div>
  );
}

export function DeskActions({ opportunityId, drafted }: { opportunityId: string; drafted: boolean }) {
  const { run, busy, error } = useDeskAction();
  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btnAccent" type="button" disabled={busy}
              onClick={() => run({ action: 'create_draft', opportunityId })}>
        {drafted ? 'Draft again' : 'Create draft'}
      </button>
      <button className="btnGhost" type="button" disabled={busy}
              onClick={() => run({ action: 'create_draft', opportunityId, channel: 'website' })}>
        Draft for website
      </button>
      <button className="recHide" type="button" disabled={busy}
              onClick={() => run({ action: 'dismiss_opportunity', opportunityId })}>
        dismiss
      </button>
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

const REJECTION_REASONS: [string, string][] = [
  ['not_interesting', 'Not interesting'],
  ['too_promotional', 'Too promotional'],
  ['wrong_tone', 'Wrong tone'],
  ['factually_weak', 'Factually weak'],
  ['repetitive', 'Repetitive'],
  ['bad_timing', 'Bad timing'],
  ['already_covered', 'Already covered'],
  ['other', 'Other'],
];

export function DraftCard({ draft }: {
  draft: {
    id: string; channel: string; kind: string; body: string; status: string;
    link_url: string | null; estimated_cost_usd: number; scheduled_for: string | null;
    schedule_timezone: string | null; needs_review_reason: string | null; error: string | null;
    headline: string | null; media: unknown[];
  };
}) {
  const { run, busy, error } = useDeskAction();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('not_interesting');
  const [note, setNote] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState('');
  const [tz, setTz] = useState('Europe/London');

  const canApprove = ['drafted', 'edited', 'needs_review'].includes(draft.status);
  const canPost = ['approved', 'scheduled', 'budget_paused'].includes(draft.status);

  return (
    <div className="adminRow" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>@guestlist</strong>
        <span className="statePill">{draft.kind === 'reply' ? 'reply' : draft.channel}</span>
        <span className={`statePill${['approved', 'scheduled'].includes(draft.status) ? ' active' : ''}`}>
          {draft.status.replace(/_/g, ' ')}
        </span>
        {draft.headline && <span className="youHistoryMeta">{draft.headline}</span>}
      </div>
      {draft.needs_review_reason && (
        <div className="formError">{`NEEDS REVIEW: ${draft.needs_review_reason}`}</div>
      )}
      {editing ? (
        <>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)}
                    style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                             borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 14 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btnAccent" type="button" disabled={busy}
                    onClick={async () => {
                      const ok = await run({ action: 'edit_draft', draftId: draft.id, body });
                      if (ok) setEditing(false);
                    }}>Save edit</button>
            <button className="btnGhost" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{draft.body}</div>
      )}
      <div className="youHistoryMeta">
        {`${draft.body.length} characters`}
        {draft.link_url && ' + Guestlist link'}
        {Array.isArray(draft.media) && draft.media.length > 0 && ` · ${draft.media.length} media`}
        {draft.channel === 'x' && ` · estimated X cost $${Number(draft.estimated_cost_usd).toFixed(3)}`}
        {draft.scheduled_for &&
          ` · scheduled ${new Date(draft.scheduled_for).toLocaleString('en-GB')} (${draft.schedule_timezone})`}
        {draft.error && ` · last error: ${draft.error}`}
      </div>
      {!editing && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {['drafted', 'edited', 'needs_review'].includes(draft.status) && (
            <button className="btnGhost" type="button" onClick={() => setEditing(true)}>Edit</button>
          )}
          {canApprove && (
            <button className="btnAccent" type="button" disabled={busy}
                    onClick={() => run({ action: 'approve', draftId: draft.id })}>Approve</button>
          )}
          {canPost && (
            <button className="btnAccent" type="button" disabled={busy}
                    onClick={() => run({ action: 'post_now', draftId: draft.id })}>
              {draft.status === 'budget_paused' ? 'Retry post' : 'Post now'}
            </button>
          )}
          {draft.status === 'budget_paused' && (
            <button className="btnGhost" type="button" disabled={busy}
                    onClick={() => run({ action: 'post_now', draftId: draft.id, override: true })}>
              Post once anyway
            </button>
          )}
          {draft.status === 'approved' && (
            <button className="btnGhost" type="button" onClick={() => setScheduling((s) => !s)}>Schedule</button>
          )}
          {!['posted', 'rejected'].includes(draft.status) && (
            <button className="recHide" type="button" onClick={() => setRejecting((r) => !r)}>reject</button>
          )}
        </div>
      )}
      {scheduling && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '7px 10px' }} />
          <input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Europe/London"
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '7px 10px', width: 160 }} />
          <button className="btnAccent" type="button" disabled={busy || !when}
                  onClick={async () => {
                    const ok = await run({
                      action: 'schedule', draftId: draft.id,
                      when: new Date(when).toISOString(), timezone: tz,
                    });
                    if (ok) setScheduling(false);
                  }}>Confirm schedule</button>
        </div>
      )}
      {rejecting && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                           borderRadius: 8, color: 'var(--text)', padding: '7px 10px' }}>
            {REJECTION_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note"
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '7px 10px', minWidth: 200 }} />
          <button className="recHide" type="button" disabled={busy}
                  onClick={async () => {
                    const ok = await run({ action: 'reject', draftId: draft.id, reason, note });
                    if (ok) setRejecting(false);
                  }}>Confirm reject</button>
        </div>
      )}
      {error && <div className="formError">{error}</div>}
    </div>
  );
}

export function MentionActions({ mentionId, canDraft, sync }: {
  mentionId?: string; canDraft?: boolean; sync?: boolean;
}) {
  const { run, busy, error } = useDeskAction();
  const [result, setResult] = useState<string | null>(null);
  return (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {sync && (
        <button className="btnGhost" type="button" disabled={busy}
                onClick={async () => {
                  const data = await run({ action: 'sync_mentions' });
                  if (data) {
                    setResult(data.skipped
                      ? `Skipped: ${data.skipped}`
                      : `Fetched ${data.fetched}, ${data.stored} new`);
                  }
                }}>Sync mentions</button>
      )}
      {mentionId && canDraft && (
        <button className="btnAccent" type="button" disabled={busy}
                onClick={() => run({ action: 'draft_reply', mentionId })}>
          Draft grounded reply
        </button>
      )}
      {mentionId && (
        <button className="recHide" type="button" disabled={busy}
                onClick={() => run({ action: 'ignore_mention', mentionId })}>ignore</button>
      )}
      {result && <span className="youHistoryMeta">{result}</span>}
      {error && <span className="formError">{error}</span>}
    </span>
  );
}

export function XConnectPanel({ account, mock }: {
  account: {
    handle: string | null; status: string; connected_at: string | null;
    last_api_call_at: string | null; last_post_at: string | null;
    last_mention_sync_at: string | null; last_error: string | null;
  } | null;
  mock: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true);
    const res = await fetch('/api/admin/x/oauth/start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && data.url) window.location.href = data.url;
    else setError(data.error ?? 'Could not start the X connection');
  }
  const fmt = (v: string | null) => v ? new Date(v).toLocaleString('en-GB') : 'never';
  return (
    <div className="adminRow" style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{`X account: @${account?.handle ?? 'guestlist'}`}</strong>
        <span className={`statePill${account?.status === 'connected' ? ' active' : ''}`}>
          {account?.status === 'connected' ? 'CONNECTED' : 'NOT CONNECTED'}
        </span>
        {mock && <span className="statePill">MOCK MODE (no real X calls)</span>}
      </div>
      <div className="youHistoryMeta" style={{ lineHeight: 1.8 }}>
        {`Last API call: ${fmt(account?.last_api_call_at ?? null)} · Last post: ${fmt(account?.last_post_at ?? null)} · Last mention sync: ${fmt(account?.last_mention_sync_at ?? null)}`}
        {account?.last_error && <div className="formError">{`Recent error: ${account.last_error}`}</div>}
      </div>
      <div>
        <button className="btnAccent" type="button" disabled={busy} onClick={connect}>
          {account?.status === 'connected' ? 'Reconnect @guestlist' : 'Connect @guestlist'}
        </button>
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}

export function BudgetPanel({ status, ledger }: {
  status: {
    period_start: string; period_end: string; budget_usd: number; spent_usd: number;
    reserved_usd: number; available_usd: number; pct_used: number; warnings: number[];
    conservation: boolean; exhausted: boolean;
    by_operation: { operation: string; cost: number; n: number }[];
  };
  ledger: { operation: string; n: number; cost: number }[];
}) {
  const { run, busy, error } = useDeskAction();
  const [budget, setBudget] = useState(String(status.budget_usd));
  const [start, setStart] = useState(status.period_start);
  const [end, setEnd] = useState(status.period_end);
  void ledger;
  return (
    <div className="adminRow" style={{ display: 'grid', gap: 8 }}>
      <div className="sectionLabel" style={{ margin: 0 }}>
        {`X API budget · ${status.period_start} → ${status.period_end}`}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>
        {`$${status.spent_usd.toFixed(2)} / $${status.budget_usd.toFixed(0)}`}
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
          {` · ${status.pct_used.toFixed(0)}% used`}
          {status.exhausted ? ' · ⛔ BUDGET PAUSED' : status.conservation ? ' · ⚠ CONSERVATION MODE' : ''}
        </span>
      </div>
      <div className="youHistoryMeta" style={{ lineHeight: 1.8 }}>
        {status.by_operation.map((o) => `${o.operation.replace(/_/g, ' ')}: $${o.cost.toFixed(2)} (${o.n})`).join(' · ') || 'No X spend yet this period'}
        <div>{`Reserved for scheduled: $${status.reserved_usd.toFixed(2)} · Available: $${status.available_usd.toFixed(2)}`}</div>
        {status.warnings.length > 0 && <div>{`Warnings crossed: ${status.warnings.join('% · ')}%`}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))}
               style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                        borderRadius: 8, color: 'var(--text)', padding: '7px 10px', width: 90 }} />
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => run({ action: 'set_budget', budgetUsd: Number(budget) })}>
          Edit budget
        </button>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
               style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                        borderRadius: 8, color: 'var(--text)', padding: '7px 10px' }} />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
               style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                        borderRadius: 8, color: 'var(--text)', padding: '7px 10px' }} />
        <button className="btnGhost" type="button" disabled={busy}
                onClick={() => run({ action: 'set_billing_period', periodStart: start, periodEnd: end })}>
          Align billing period
        </button>
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}

export function SettingsSwitches({ switches }: {
  switches: { automation: boolean; posting: boolean; mention_sync: boolean; replies: boolean; analytics: boolean };
}) {
  const { run, busy, error } = useDeskAction();
  const LABELS: [keyof typeof switches, string][] = [
    ['automation', 'X automation (master)'],
    ['posting', 'Posting'],
    ['mention_sync', 'Mention sync'],
    ['replies', 'Replies'],
    ['analytics', 'Analytics reads'],
  ];
  return (
    <div className="adminRow" style={{ display: 'grid', gap: 8 }}>
      <div className="sectionLabel" style={{ margin: 0 }}>Kill switches (no deployment needed)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {LABELS.map(([k, label]) => (
          <button key={k} type="button" disabled={busy}
                  className={switches[k] ? 'btnGhost isActive' : 'recHide'}
                  onClick={() => run({ action: 'set_switches', [k]: !switches[k] })}>
            {`${label}: ${switches[k] ? 'ON' : 'PAUSED'}`}
          </button>
        ))}
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
