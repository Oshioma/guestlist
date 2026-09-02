'use client';

// Per-source admin controls: trust level, polling, frequency, Scan Now.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GenrePicker, type GenreOpt } from '@/components/admin/GenrePicker';
import { probeLabel, testVerdict, type ProbeResult } from '@/lib/supply/verdict';
import { explainScan, type OutcomeTally } from '@/lib/supply/outcomes';

type ScanSummary = {
  status: string; method: string | null; candidatesFound: number;
  newCandidates: number; extracted: number; failed: number; duplicates: number;
  error: string | null; outcomes: OutcomeTally; note?: string | null;
};

// How often the desk asks a running scan how it is doing, and how long it
// keeps asking before it stops rather than spinning for ever.
const WATCH_EVERY_MS = 2_000;
const WATCH_FOR_MS = 6 * 60_000;

export function SourceControls({
  id, name, url, feedUrl, active, trust, pollingEnabled, pollFrequencyHours, renderJs, maxCandidates,
  city, country, genreIds, genres, countries,
}: {
  id: string;
  name: string;
  url: string;
  feedUrl: string | null;
  active: boolean;
  trust: string;
  pollingEnabled: boolean;
  renderJs: boolean;
  maxCandidates: number | null;
  pollFrequencyHours: number;
  city: string | null;
  country: string | null;
  genreIds: string[];
  genres: GenreOpt[];
  countries: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanSummary | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tagName, setTagName] = useState(name);
  const [tagUrl, setTagUrl] = useState(url);
  const [tagFeedUrl, setTagFeedUrl] = useState(feedUrl ?? '');
  const [tagCity, setTagCity] = useState(city ?? '');
  const [tagCountry, setTagCountry] = useState(country ?? '');
  const [tagGenres, setTagGenres] = useState<string[]>(genreIds);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The scan this component is currently watching. Cleared on unmount so the
  // watch loop stops instead of setting state on a component that is gone.
  const watching = useRef<string | null>(null);
  useEffect(() => () => { watching.current = null; }, []);

  async function remove() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/admin/sources/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/admin/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) { router.refresh(); return true; }
    setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
    return false;
  }

  // A SCAN IS WATCHED, NOT WAITED ON. The POST returns the moment the job
  // exists; from there the desk asks the row how it is doing. A big site whose
  // scan outlives its request used to leave this button spinning for ever.
  async function scanNow() {
    setScanning(true);
    setError('');
    setScanResult(null);
    setProgress(null);
    // A test fetch from a previous URL left on screen under a fresh scan
    // reads as though it described the scan. It cost us two rounds of
    // "why does it say HTML when I scanned the sitemap".
    setTestResult(null);
    const res = await fetch(`/api/admin/sources/${id}/scan`, { method: 'POST' });
    if (!res.ok) {
      setScanning(false);
      setError((await res.json().catch(() => ({})))?.error ?? 'Scan failed');
      return;
    }
    const { scanId } = await res.json();
    watching.current = scanId;
    const until = Date.now() + WATCH_FOR_MS;
    while (watching.current === scanId) {
      await new Promise((r) => setTimeout(r, WATCH_EVERY_MS));
      if (watching.current !== scanId) return;   // unmounted, or a newer scan
      if (Date.now() > until) {
        setScanning(false);
        setError('Still running. It keeps going without this page — reload to see how it finished.');
        return;
      }
      const poll = await fetch(`/api/admin/sources/${id}/scan?scanId=${scanId}`).catch(() => null);
      if (!poll?.ok) continue;                    // a blip is not a verdict
      const scan: ScanSummary & { running: boolean } = await poll.json();
      // Progress is written down as it happens, so a running scan has
      // something honest to show rather than an indefinite spinner.
      if (scan.running) { setProgress(scan.note ?? null); continue; }
      setProgress(null);
      setScanning(false);
      setScanResult(scan);
      router.refresh();
      return;
    }
  }

  async function testFetch() {
    setTesting(true);
    setError('');
    setTestResult(null);
    setScanResult(null);
    const res = await fetch(`/api/admin/sources/${id}/test-fetch`, { method: 'POST' });
    setTesting(false);
    if (res.ok) setTestResult(await res.json());
    else setError((await res.json().catch(() => ({})))?.error ?? 'Test fetch failed');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 170 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={trust}
          onChange={(e) => patch({ trust: e.target.value })}
          disabled={busy}
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-soft)', borderRadius: 999, padding: '4px 8px', fontSize: 11,
          }}
          aria-label="Trust level"
        >
          <option value="new">NEW</option>
          <option value="trusted">TRUSTED</option>
          <option value="restricted">RESTRICTED</option>
          <option value="blocked">BLOCKED</option>
        </select>
        <button
          className="btnGhost"
          style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={() => patch({ active: !active })}
          disabled={busy}
          type="button"
        >
          {active ? 'Pause' : 'Resume'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pollingEnabled}
            onChange={(e) => patch({ pollingEnabled: e.target.checked })}
            disabled={busy}
          />
          poll
        </label>
        {/* Only for the handful of sites that hand a bot an empty shell. It
            costs a hosted browser per scan, so it is a decision, not a
            default — the test fetch says when it is the right one. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
               title="Fetch this source through a real browser, for sites that build their listings in the browser">
          <input
            type="checkbox"
            checked={renderJs}
            onChange={(e) => patch({ renderJs: e.target.checked })}
            disabled={busy}
          />
          render
        </label>
        {/* Forty suits a venue and truncates a festival. A source that needs a
            different ceiling says so here rather than everyone getting one. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}
               title="How many candidate links one scan of this source may take. Blank uses the default of 40.">
          max
          <input
            type="number"
            min={1}
            max={1000}
            defaultValue={maxCandidates ?? ''}
            placeholder="40"
            disabled={busy}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === '' ? null : Number(raw);
              if (next === (maxCandidates ?? null)) return;
              patch({ maxCandidates: next });
            }}
            style={{
              width: 52, background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text-soft)', borderRadius: 999, padding: '3px 6px', fontSize: 11,
            }}
          />
        </label>
        <select
          value={pollFrequencyHours}
          onChange={(e) => patch({ pollFrequencyHours: Number(e.target.value) })}
          disabled={busy || !pollingEnabled}
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-soft)', borderRadius: 999, padding: '3px 6px', fontSize: 11,
          }}
          aria-label="Poll frequency"
        >
          {[6, 12, 24, 48, 168].map((h) => (
            <option key={h} value={h}>{h < 24 ? `${h}h` : `${h / 24}d`}</option>
          ))}
        </select>
        <button
          className="btnGhost"
          style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={scanNow}
          disabled={scanning || trust === 'blocked'}
          type="button"
        >
          {scanning ? (progress ?? 'Scanning…') : 'Scan now'}
        </button>
        <button
          className="btnGhost"
          style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={testFetch}
          disabled={testing}
          type="button"
          title="Fetch the source once as GuestlistBot and once as a browser, to diagnose blocking or empty pages"
        >
          {testing ? 'Testing…' : 'Test fetch'}
        </button>
        <button
          className="btnGhost"
          style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={() => setTagOpen((o) => !o)}
          disabled={busy}
          type="button"
        >
          {tagOpen ? 'Close edit' : 'Edit'}
        </button>
        {/* Permanent — two clicks required. Events found through this
            source survive (their source link just clears). */}
        <button
          className="btnGhost"
          style={{ padding: '4px 10px', fontSize: 10.5, color: 'var(--danger)',
                   borderColor: confirmDelete ? 'var(--danger)' : undefined }}
          onClick={() => { if (confirmDelete) remove(); else setConfirmDelete(true); }}
          onBlur={() => setConfirmDelete(false)}
          disabled={busy}
          type="button"
        >
          {confirmDelete ? 'Really delete?' : 'Delete'}
        </button>
      </div>
      {tagOpen && (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)',
                      borderRadius: 10, minWidth: 230 }}>
          <input value={tagName} onChange={(e) => setTagName(e.target.value)}
                 placeholder="Source name" maxLength={200}
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '6px 8px', fontSize: 12 }} />
          <input value={tagUrl} onChange={(e) => setTagUrl(e.target.value)}
                 placeholder="https://…" type="url"
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '6px 8px', fontSize: 12 }} />
          {/* Empty clears the saved feed, sending scans back to the listing page. */}
          <input value={tagFeedUrl} onChange={(e) => setTagFeedUrl(e.target.value)}
                 placeholder="Feed URL (blank = scan the page)" type="url"
                 title="Leave blank to scan the listing page instead of a feed"
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '6px 8px', fontSize: 12 }} />
          <input value={tagCity} onChange={(e) => setTagCity(e.target.value)}
                 placeholder="City (London)" maxLength={80}
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '6px 8px', fontSize: 12 }} />
          <input value={tagCountry} onChange={(e) => setTagCountry(e.target.value)}
                 placeholder="Country (United Kingdom)" maxLength={80} list={`countries-${id}`}
                 style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, color: 'var(--text)', padding: '6px 8px', fontSize: 12 }} />
          <datalist id={`countries-${id}`}>
            {countries.map((c) => <option key={c} value={c} />)}
          </datalist>
          <GenrePicker genres={genres} selected={tagGenres} onChange={setTagGenres} />
          <button
            className="btnAccent"
            style={{ padding: '5px 12px', fontSize: 11 }}
            disabled={busy}
            type="button"
            onClick={async () => {
              // The panel stays open on failure so a URL clash or typo can
              // be corrected without losing the edits.
              const ok = await patch({
                name: tagName, url: tagUrl, feedUrl: tagFeedUrl.trim() || null,
                city: tagCity, country: tagCountry, genreIds: tagGenres,
              });
              // Both results describe the OLD URL the moment this saves.
              if (ok) { setTagOpen(false); setTestResult(null); setScanResult(null); }
            }}
          >
            Save
          </button>
        </div>
      )}
      {/* The scan is a job on the server. Saying so is the difference between
          waiting and wondering. */}
      {scanning && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Running on the server — this carries on if you leave the page.
        </div>
      )}
      {scanResult && (
        <div style={{ fontSize: 11.5, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          {scanResult.status === 'succeeded' ? (
            <>
              {scanResult.candidatesFound} candidate URL{scanResult.candidatesFound === 1 ? '' : 's'} ·{' '}
              {scanResult.newCandidates} new · {scanResult.extracted} extracted ·{' '}
              {scanResult.duplicates} duplicate ·{' '}
              {/* Failures carry a stored reason — link straight to it. */}
              {scanResult.failed > 0 ? (
                <a href={`/admin/supply?source=${id}&status=failures`}
                   style={{ textDecoration: 'underline', color: 'var(--danger)' }}>
                  {scanResult.failed} failed — why?
                </a>
              ) : (
                <>{scanResult.failed} failed</>
              )}
              {scanResult.method && <> · via {scanResult.method.toUpperCase()}</>}
              {scanResult.extracted > 0 && (
                <> — <a href="/admin/events?state=new" style={{ textDecoration: 'underline' }}>review →</a></>
              )}
              {/* Why, not just how many. */}
              {explainScan(scanResult.outcomes, scanResult.extracted) && (
                <div style={{ marginTop: 3 }}>{explainScan(scanResult.outcomes, scanResult.extracted)}</div>
              )}
              {/* A scan that ran out of links and one that ran out of time
                  both stop; only one of them is finished. */}
              {scanResult.note && <div style={{ marginTop: 3 }}>{scanResult.note}</div>}
            </>
          ) : (
            <span style={{ color: 'var(--danger)' }}>{scanResult.error ?? 'Scan failed'}</span>
          )}
        </div>
      )}
      {testResult && (() => {
        const v = testVerdict(testResult);
        return (
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: v.bad ? 'var(--danger)' : 'var(--text-soft)' }}>
            {v.text}
            {/* The target is the scanner's own choice (feed URL if set, else
                the listing page). Showing it stops a feed-vs-page mismatch
                from reading as a contradiction against the scan summary. */}
            <div style={{ color: 'var(--text-faint)', fontSize: 11, wordBreak: 'break-all' }}>
              fetched {testResult.method ? `as ${testResult.method.toUpperCase()}: ` : ': '}
              {testResult.target}
            </div>
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
              bot: {probeLabel(testResult.bot)} ({testResult.bot.ms}ms) · browser:{' '}
              {probeLabel(testResult.browser)} ({testResult.browser.ms}ms)
              {testResult.bodyBytes != null && (
                <> · {testResult.bodyBytes.toLocaleString()} bytes
                  {testResult.responseType ? ` of ${testResult.responseType.split(';')[0]}` : ''}
                  {testResult.browserBytes != null && testResult.browserBytes !== testResult.bodyBytes
                    ? ` (browser got ${testResult.browserBytes.toLocaleString()})`
                    : ''}
                </>
              )}
            </div>
            {/* WHAT WE ACTUALLY RECEIVED. Every "reachable but nothing found"
                has been settled by looking at the response rather than
                reasoning about it — an empty results list, a bot challenge and
                a body we cannot decode all read as the same HTTP 200. */}
            {testResult.bodyPreview && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-faint)', fontSize: 11 }}>
                  what came back
                </summary>
                <pre style={{
                  margin: '4px 0 0', padding: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text-faint)', fontSize: 10.5, maxHeight: 220, overflow: 'auto',
                }}>{testResult.bodyPreview}</pre>
              </details>
            )}
            {/* The links themselves. "4 candidates" on a page full of events is
                a mystery until you can see that all four are the site's own
                navigation — at which point the answer is obvious. */}
            {!!testResult.candidateUrls?.length && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-faint)', fontSize: 11 }}>
                  {`the ${testResult.candidateUrls.length} link${testResult.candidateUrls.length === 1 ? '' : 's'} we took`}
                </summary>
                <ul style={{ margin: '4px 0 0 14px', padding: 0, color: 'var(--text-faint)', fontSize: 11 }}>
                  {testResult.candidateUrls.map((u) => (
                    <li key={u} style={{ wordBreak: 'break-all' }}>{u}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })()}
      {error && <div style={{ color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>}
    </div>
  );
}
