'use client';

// An admin reading the site is still an admin. When something is wrong with a
// night or a piece, the fix should be one press away from where the problem is
// visible — not a trip back through the admin desk to find it again.
//
// Delete arms first and confirms second, the same two-press contract as
// DeleteMember: there is no undo, so one stray click must never be enough.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function AdminItemActions({
  editHref, deleteUrl, noun, name, afterDelete,
}: {
  editHref: string;
  deleteUrl: string;
  noun: string;          // 'event' / 'article' — used in the button and the warning
  name: string;
  afterDelete: string;   // where to land once it is gone
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    const res = await fetch(deleteUrl, { method: 'DELETE' });
    if (res.ok) {
      router.push(afterDelete);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setError(data.error ?? `Could not delete that ${noun}`);
    setArmed(false);
  }

  return (
    <div className="adminItemActions">
      <span className="adminItemActionsTag">Admin</span>
      <Link href={editHref} className="btnGhost adminItemActionsBtn">{`Edit ${noun}`}</Link>
      {!armed ? (
        <button type="button" className="btnGhost adminItemActionsBtn adminItemActionsDanger"
                onClick={() => setArmed(true)}>
          {`Delete ${noun}`}
        </button>
      ) : (
        <>
          <span className="adminItemActionsWarn">
            {`Delete “${name}” for good? This cannot be undone.`}
          </span>
          <button type="button" className="btnAccent adminItemActionsBtn" disabled={busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button type="button" className="btnGhost adminItemActionsBtn" disabled={busy}
                  onClick={() => setArmed(false)}>
            Cancel
          </button>
        </>
      )}
      {error && <span className="adminItemActionsWarn">{error}</span>}
    </div>
  );
}
