'use client';

// Block / report controls on a member profile.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MemberActions({ memberId, blocked }: { memberId: string; blocked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, message: string) {
    await fetch('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
    setDone(message);
    setOpen(false);
    setReporting(false);
    router.refresh();
  }

  if (done) return <span className="youHistoryMeta">{done}</span>;

  return (
    <span className="memberActions">
      <button className="recHide" type="button" onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && (
        <span className="memberActionsMenu">
          {blocked ? (
            <button className="recHide" type="button"
                    onClick={() => act({ action: 'unblock', memberId }, 'Unblocked')}>
              Unblock
            </button>
          ) : (
            <button className="recHide" type="button"
                    onClick={() => act({ action: 'block', memberId }, 'Blocked')}>
              Block
            </button>
          )}
          <button className="recHide" type="button" onClick={() => setReporting(true)}>Report</button>
        </span>
      )}
      {reporting && (
        <form className="pingCustomForm" onSubmit={(e) => {
          e.preventDefault();
          act({ action: 'report', memberId, reason }, 'Reported — thank you');
        }}>
          <input placeholder="What's wrong?" value={reason} maxLength={500}
                 onChange={(e) => setReason(e.target.value)} autoFocus />
          <button className="btnGhost" type="submit">Send</button>
        </form>
      )}
    </span>
  );
}
