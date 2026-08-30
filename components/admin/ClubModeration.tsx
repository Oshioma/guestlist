'use client';

// Admin controls for Club Messenger moderation: remove/restore a message,
// suspend/unsuspend a member's club privileges.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function act(payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('/api/admin/clubmessenger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? 'Action failed';
}

export function ClubSuspendControl({ memberId, suspended }: { memberId: string; suspended: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(await act({ action: suspended ? 'unsuspend' : 'suspend', memberId }));
    setBusy(false);
    router.refresh();
  }

  return (
    <span>
      <button className="btnGhost" type="button" disabled={busy} onClick={toggle}>
        {suspended ? 'Unsuspend' : 'Suspend from Club'}
      </button>
      {error && <span className="formError" style={{ marginLeft: 8 }}>{error}</span>}
    </span>
  );
}

export function ClubModerationRow({
  message,
}: {
  message: {
    id: string; body: string; createdAt: string; reportCount: number;
    deleted: boolean; eventTitle: string; authorId: string; authorName: string;
    authorSuspended: boolean; reasons: string[];
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: 'remove_message' | 'restore_message') {
    setBusy(true);
    setError(await act({ action, messageId: message.id }));
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="adminRow" style={{ display: 'block' }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{message.authorName}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          in {message.eventTitle} · {new Date(message.createdAt).toLocaleString()} ·{' '}
          {message.reportCount} report{message.reportCount === 1 ? '' : 's'}
        </span>
        {message.deleted && <span className="listingBadge cancelled">removed</span>}
      </div>
      <div style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{message.body}</div>
      {message.reasons.length > 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
          Reasons: {message.reasons.join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {message.deleted ? (
          <button className="btnGhost" type="button" disabled={busy} onClick={() => run('restore_message')}>
            Restore
          </button>
        ) : (
          <button className="btnGhost" type="button" disabled={busy} onClick={() => run('remove_message')}>
            Remove message
          </button>
        )}
        <ClubSuspendControl memberId={message.authorId} suspended={message.authorSuspended} />
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
