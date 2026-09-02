'use client';

// The two honest moves on somebody who has not confirmed: send it again, or
// vouch for them. Vouching asks twice, because it puts a profile in the
// directory without the address ever having been proved.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function VerificationControls({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'resend' | 'verify' | null>(null);
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState('');

  async function act(action: 'resend' | 'mark_verified') {
    setBusy(action === 'resend' ? 'resend' : 'verify');
    setNote('');
    const res = await fetch(`/api/admin/members/${memberId}/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setArmed(false);
    if (!res.ok) { setNote(data.error ?? 'Could not do that'); return; }
    if (action === 'resend') { setNote('Sent again.'); return; }
    router.refresh();
  }

  return (
    <span className="verifyActions">
      <button type="button" className="btnGhost verifyBtn" disabled={busy !== null}
              onClick={() => act('resend')}>
        {busy === 'resend' ? 'Sending…' : 'Send again'}
      </button>
      {armed ? (
        <>
          <span className="verifyWarn">{`Vouch for ${name} without a confirmed address?`}</span>
          <button type="button" className="btnAccent verifyBtn" disabled={busy !== null}
                  onClick={() => act('mark_verified')}>
            {busy === 'verify' ? 'Working…' : 'Yes, vouch'}
          </button>
          <button type="button" className="btnGhost verifyBtn" onClick={() => setArmed(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className="btnGhost verifyBtn" disabled={busy !== null}
                onClick={() => setArmed(true)}>
          Vouch for them
        </button>
      )}
      {note && <span className="verifyNote">{note}</span>}
    </span>
  );
}
