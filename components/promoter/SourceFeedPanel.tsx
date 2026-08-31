'use client';

// Connect-your-website UI + feed status + scan now / pause / change URL.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type SourceInfo = {
  url: string; active: boolean; blocked: boolean; trusted: boolean;
  lastChecked: string | null; failureCount: number;
  pollingHours: number | null; hasFeed: boolean;
};
type LastScan = {
  when: string; candidates: number; newCandidates: number;
  extracted: number; failed: number; ok: boolean;
};
type ScanResult = {
  ok: boolean; found: number; alreadyOnGuestlist: number;
  newEvents: number; failed: number; pendingReview: number; error?: string;
};

export function SourceFeedPanel({
  promoterId,
  canManage,
  canScan,
  source,
  upcomingFound,
  pendingReview,
  lastScan,
}: {
  promoterId: string;
  canManage: boolean;
  canScan: boolean;
  source: SourceInfo | null;
  upcomingFound: number;
  pendingReview: number;
  lastScan: LastScan | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!source);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  async function connect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = new FormData(e.currentTarget).get('url');
    setBusy('connect');
    setError('');
    const res = await fetch(`/api/promoter/${promoterId}/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      setBusy(null);
      setError((await res.json().catch(() => ({})))?.error ?? 'Could not connect');
      return;
    }
    setEditing(false);
    // First-connection experience: scan immediately.
    await scanNow();
    setBusy(null);
    router.refresh();
  }

  async function scanNow() {
    setBusy('scan');
    setError('');
    setScanResult(null);
    const res = await fetch(`/api/promoter/${promoterId}/source/scan`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setScanResult(data);
      router.refresh();
    } else {
      setError(data.error ?? 'Scan failed');
    }
  }

  async function toggle() {
    setBusy('toggle');
    await fetch(`/api/promoter/${promoterId}/source`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: source?.active ? 'pause' : 'resume' }),
    });
    setBusy(null);
    router.refresh();
  }

  if (!source || editing) {
    return (
      <div className="sideCard" style={{ maxWidth: 560 }}>
        <div className="big">Connect your website</div>
        <div className="muted" style={{ margin: '6px 0 14px' }}>
          Keep your Guestlist events updated automatically. Enter your events
          page (or RSS feed) and we’ll take it from there.
        </div>
        {canManage ? (
          <form className="urlRow" onSubmit={connect}>
            <input name="url" type="url" required placeholder="https://yoursite.com/events" defaultValue={source?.url ?? ''} />
            <button className="btnAccent" disabled={busy === 'connect' || busy === 'scan'} type="submit">
              {busy ? 'Connecting…' : 'Connect →'}
            </button>
          </form>
        ) : (
          <div className="muted">Ask a team admin to connect the website.</div>
        )}
        {source && (
          <button className="btnGhost" style={{ marginTop: 10 }} onClick={() => setEditing(false)} type="button">
            Cancel
          </button>
        )}
        {error && <div className="formError">{error}</div>}
      </div>
    );
  }

  return (
    <div className="sideCard" style={{ maxWidth: 640 }}>
      <div className="big">{source.url.replace(/^https?:\/\/(www\.)?/, '')}</div>
      <div className="muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
        Status:{' '}
        <b style={{ color: source.blocked ? 'var(--danger)' : source.active ? 'var(--ok)' : 'var(--text-muted)' }}>
          {source.blocked ? 'BLOCKED' : source.active ? 'CONNECTED' : 'PAUSED'}
        </b>
        {source.hasFeed && ' · RSS detected'}
        <br />
        Last checked: <b>{source.lastChecked ?? 'never'}</b>
        <br />
        Upcoming events on Guestlist: <b>{upcomingFound}</b>
        {pendingReview > 0 && (
          <>
            {' · '}
            <Link href="/promoter/events" style={{ color: 'var(--accent-ink, var(--accent))', textDecoration: 'underline' }}>
              {pendingReview} awaiting your review
            </Link>
          </>
        )}
        <br />
        Next scan: <b>{source.blocked ? '—' : !source.active ? 'paused' : source.pollingHours ? `scheduled (every ${source.pollingHours}h)` : 'manual only'}</b>
      </div>

      {source.failureCount >= 3 && (
        <div className="cancelBanner" style={{ marginTop: 12, fontSize: 13 }}>
          We couldn’t read your website on the last {source.failureCount} attempts.
          Check the page is public, isn’t blocking robots, and lists your events
          — then try Scan now. Still stuck? info@guestlist.net.
        </div>
      )}

      {lastScan && !scanResult && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          Last scan ({lastScan.when}): {lastScan.candidates} candidate links ·{' '}
          {lastScan.newCandidates} new · {lastScan.extracted} extracted · {lastScan.failed} failed
        </div>
      )}
      {scanResult && (
        <div className="joinPrompt" style={{ marginTop: 12, textAlign: 'left' }}>
          {scanResult.ok ? (
            <>
              We found <b>{scanResult.found}</b> event link{scanResult.found === 1 ? '' : 's'} —{' '}
              {scanResult.alreadyOnGuestlist} already on Guestlist, <b>{scanResult.newEvents} new</b>.
              {scanResult.pendingReview > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Link href="/promoter/events" className="btnAccent">
                    Review {scanResult.pendingReview} event{scanResult.pendingReview === 1 ? '' : 's'} →
                  </Link>
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--danger)' }}>Scan failed: {scanResult.error}</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {canScan && !source.blocked && source.active && (
          <button className="btnAccent" onClick={scanNow} disabled={!!busy} type="button">
            {busy === 'scan' ? 'Scanning…' : 'Scan now'}
          </button>
        )}
        {canManage && !source.blocked && (
          <>
            <button className="btnGhost" onClick={toggle} disabled={!!busy} type="button">
              {source.active ? 'Pause sync' : 'Resume sync'}
            </button>
            <button className="btnGhost" onClick={() => setEditing(true)} type="button">
              Change URL
            </button>
          </>
        )}
      </div>
      {error && <div className="formError">{error}</div>}
    </div>
  );
}
