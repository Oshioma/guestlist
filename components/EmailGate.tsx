'use client';

// The original landing page's email gate, behaviour preserved:
// toggles open, posts to the existing Basin endpoint.

import { useState } from 'react';

export function EmailGate() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('…');
    const form = e.currentTarget;
    try {
      const res = await fetch('https://usebasin.com/f/13b8b3bd918f', {
        method: 'POST',
        body: new FormData(form),
      });
      if (res.ok) {
        setStatus('Submission logged.');
        form.reset();
      } else {
        setStatus(`Unable to submit (HTTP ${res.status}). Try again later.`);
      }
    } catch {
      setStatus('Unable to submit. Try again later.');
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <button className="btnGhost" onClick={() => setOpen(!open)} type="button">
        Submit details
      </button>
      {open && (
        <form
          onSubmit={onSubmit}
          style={{
            marginTop: 14, maxWidth: 520, padding: 16, borderRadius: 14,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <label
            style={{
              fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2,
              color: 'rgba(234,234,234,0.6)', display: 'block', marginBottom: 10,
            }}
          >
            Leave your email if you believe you are a good fit.
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="email" name="email" placeholder="Email" required autoComplete="email"
              style={{
                flex: 1, height: 42, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(0,0,0,0.3)', color: '#eaeaea', padding: '0 12px', fontSize: 14, outline: 'none',
              }}
            />
            <button type="submit" className="btnGhost">Submit</button>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(234,234,234,0.65)', lineHeight: 1.5 }}>
            Submissions are reviewed selectively. Silence should be considered the default outcome.
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(234,234,234,0.75)', minHeight: 18 }}>
            {status}
          </div>
        </form>
      )}
    </div>
  );
}
