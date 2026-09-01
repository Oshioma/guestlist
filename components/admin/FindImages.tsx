'use client';

// FIND THE MISSING FLYERS — for a whole queue at once.
//
// An event with no picture is the one thing a visitor notices, and a scan that
// imported thirty of them leaves thirty blank tiles. This walks the queue,
// opens each event's own page, and reads the artwork off it.
//
// It is slower than it looks and says so: each event is a real request to
// somebody else's website, spaced out the way the scanner spaces its own.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Result = { looked: number; found: number; remaining: number; error?: string };

export function FindImages({ state, missing }: { state: 'new' | 'needs_review' | 'live'; missing: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  if (missing === 0) return null;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/events/find-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { looked: 0, found: 0, remaining: 0, error: data.error ?? 'Could not look' });
      if (res.ok) router.refresh();
    } catch {
      setResult({ looked: 0, found: 0, remaining: 0, error: 'Could not look' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publishAllBar">
      <div className="publishAllText">
        <strong>{`${missing} without a picture`}</strong>
        <span>
          Guestlist will open each event’s own page and look for its flyer — including the
          ones the page never declared. Takes a few seconds each.
        </span>
        {result && !result.error && (
          <span className="publishAllDone">
            {`Looked at ${result.looked}, found ${result.found}.${result.remaining > 0 ? ` ${result.remaining} still to go — press again.` : ''}`}
          </span>
        )}
        {result?.error && <span className="publishAllError">{result.error}</span>}
      </div>
      <button className="btnGhost" onClick={run} disabled={busy} type="button">
        {busy ? 'Looking…' : 'Find missing images'}
      </button>
    </div>
  );
}
