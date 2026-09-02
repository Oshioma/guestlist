'use client';

// The button belongs where the problem is seen. An admin who has just opened a
// profile full of gibberish should not have to go and find it again in a list.
//
// Two presses, because there is no undo: the first arms it, the second does
// it. Anything less than that on a destructive action is a trap, and anything
// more is theatre.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteMember({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/admin/members/${memberId}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      router.push('/people');
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? 'Could not delete that member');
    setArmed(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {!armed ? (
        <button type="button" className="btnGhost" onClick={() => setArmed(true)}
                style={{ fontSize: 11.5, color: 'var(--danger)' }}>
          Delete member
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>
            Delete {name} and everything they posted? This cannot be undone.
          </span>
          <button type="button" className="btnAccent" disabled={busy} onClick={remove}
                  style={{ fontSize: 11.5 }}>
            {busy ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button type="button" className="btnGhost" disabled={busy} onClick={() => setArmed(false)}
                  style={{ fontSize: 11.5 }}>
            Cancel
          </button>
        </div>
      )}
      {error && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
