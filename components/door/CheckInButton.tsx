'use client';

// One press at a door, and it must be obvious which way it went. Undo is
// there because door staff misfire — a check-in on the wrong Sam is a real
// thing, and it should take a second to put right.

import { useState } from 'react';

export function CheckInButton({ token, initialCheckedIn, disabled }: {
  token: string; initialCheckedIn: boolean; disabled: boolean;
}) {
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/door/${token}/check-in`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Could not do that'); return; }
    setCheckedIn(!!data.checkedInAt);
  }

  return (
    <div className="doorAction">
      <button type="button" className={checkedIn ? 'doorBtn undo' : 'doorBtn'}
              onClick={toggle} disabled={busy || disabled}>
        {busy ? 'Working…' : checkedIn ? 'Undo check-in' : 'Check in'}
      </button>
      {error && <div className="doorError">{error}</div>}
    </div>
  );
}
