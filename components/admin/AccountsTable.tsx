'use client';

// WHO ACTUALLY HAS AN ACCOUNT, AND WHICH OF THEM ARE SCRIPTS.
//
// The signup form is public, so some of what lands in it is not a person.
// Removing those one at a time is a job nobody finishes, so this is the list
// with the addresses on it, tick boxes, and one delete.
//
// Nothing is ever ticked automatically. The two columns that give a script
// away — never confirmed the address, and several accounts from one
// connection — are shown rather than acted on, because a flatshare and an
// office also share a connection, and somebody who has not got round to
// clicking a link is not a bot. "Tick the unconfirmed" is offered as a
// starting point that a person then reads through.
//
// Delete arms and confirms, and the confirmation says the number out loud.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export type Account = {
  id: string; display_name: string; email: string; slug: string | null;
  city: string | null; role: string; created_at: string;
  verified: boolean; same_connection: number; actions: number;
};

export function AccountsTable({ accounts, meId }: { accounts: Account[]; meId: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [onlyRisky, setOnlyRisky] = useState(false);

  // An account that can never be deleted from here should not be tickable:
  // an admin, and yourself.
  const deletable = useMemo(
    () => accounts.filter((a) => a.role !== 'admin' && a.id !== meId),
    [accounts, meId]);

  const risky = useMemo(
    () => deletable.filter((a) => !a.verified && a.actions === 0),
    [deletable]);

  const shown = onlyRisky ? risky : accounts;

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setArmed(false);
  }

  async function remove() {
    setBusy(true);
    setResult('');
    const res = await fetch('/api/admin/members/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...picked] }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setArmed(false);
    if (!res.ok) { setResult(data.error ?? 'Could not delete those'); return; }
    setPicked(new Set());
    const kept = (data.kept ?? []) as { why: string }[];
    setResult(`${data.deleted} deleted.${kept.length ? ` ${kept.length} kept: ${kept[0].why}` : ''}`);
    router.refresh();
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="acTable">
      <div className="acBar">
        <span className="acCount">
          <b>{accounts.length}</b> account{accounts.length === 1 ? '' : 's'}
          {risky.length > 0 && <> · <b>{risky.length}</b> unconfirmed and never did anything</>}
        </span>
        <span className="acBarActions">
          <button type="button" className="btnGhost" onClick={() => setOnlyRisky((v) => !v)}>
            {onlyRisky ? 'Show everyone' : 'Show only those'}
          </button>
          <button
            type="button" className="btnGhost"
            onClick={() => { setPicked(new Set(risky.map((a) => a.id))); setArmed(false); }}
            disabled={risky.length === 0}
          >
            Tick those {risky.length > 0 && `(${risky.length})`}
          </button>
          {picked.size > 0 && (
            <button type="button" className="btnGhost" onClick={() => { setPicked(new Set()); setArmed(false); }}>
              Clear
            </button>
          )}
        </span>
      </div>

      {picked.size > 0 && (
        <div className="acDeleteBar">
          {!armed ? (
            <>
              <span><b>{picked.size}</b> selected</span>
              <button type="button" className="btnGhost adminItemActionsDanger" onClick={() => setArmed(true)}>
                Delete selected
              </button>
            </>
          ) : (
            <>
              {/* The number, out loud. There is no undo on the other side. */}
              <span className="adminItemActionsWarn">
                Delete {picked.size} account{picked.size === 1 ? '' : 's'} for good? Their profiles,
                saved nights and messages go with them. This cannot be undone.
              </span>
              <button type="button" className="btnAccent" disabled={busy} onClick={remove}>
                {busy ? 'Deleting…' : `Yes, delete ${picked.size}`}
              </button>
              <button type="button" className="btnGhost" disabled={busy} onClick={() => setArmed(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {result && <div className="acResult">{result}</div>}

      <div className="acRow acHead">
        <span />
        <span>Name</span><span>Email</span><span>Where</span>
        <span>Joined</span><span>Confirmed</span><span>Same line</span><span>Did anything</span>
      </div>
      {shown.map((a) => {
        const locked = a.role === 'admin' || a.id === meId;
        return (
          <label className={`acRow${picked.has(a.id) ? ' on' : ''}`} key={a.id}>
            <span>
              <input
                type="checkbox" checked={picked.has(a.id)} disabled={locked}
                onChange={() => toggle(a.id)}
                aria-label={`Select ${a.display_name}`}
              />
            </span>
            <span className="acName">
              {a.slug ? <Link href={`/members/${a.slug}`}>{a.display_name}</Link> : a.display_name}
              {locked && <em>{a.id === meId ? 'you' : 'admin'}</em>}
            </span>
            <span className="acEmail">{a.email}</span>
            <span>{a.city ?? '—'}</span>
            <span>{when(a.created_at)}</span>
            <span className={a.verified ? 'acYes' : 'acNo'}>{a.verified ? 'yes' : 'no'}</span>
            <span className={a.same_connection > 2 ? 'acNo' : ''}>
              {a.same_connection > 1 ? `${a.same_connection} accounts` : '—'}
            </span>
            <span className={a.actions === 0 ? 'acNo' : ''}>{a.actions === 0 ? 'nothing' : a.actions}</span>
          </label>
        );
      })}
      {shown.length === 0 && <div className="adminSub" style={{ padding: 14 }}>Nobody matches that.</div>}
    </div>
  );
}
