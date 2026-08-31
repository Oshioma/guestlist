'use client';

// Per-source admin controls: trust level, polling, frequency, Scan Now.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GenrePicker, type GenreOpt } from '@/components/admin/GenrePicker';

type ScanSummary = {
  status: string; method: string | null; candidatesFound: number;
  newCandidates: number; extracted: number; failed: number; duplicates: number;
  error: string | null;
};

type FetchProbe = {
  ok: boolean; status: number | null; code: string | null; detail: string | null; ms: number;
};
type TestFetchResult = {
  target: string; bot: FetchProbe; browser: FetchProbe;
  method: 'rss' | 'html' | null; candidates: number | null;
};

const probeLabel = (p: FetchProbe) =>
  p.ok ? `HTTP ${p.status}` : `${p.code}${p.detail ? ` (${p.detail})` : ''}`;

// Turn the two probes into the sentence an admin actually needs.
function testVerdict(t: TestFetchResult): { text: string; bad: boolean } {
  if (t.bot.ok && (t.candidates ?? 0) > 0) {
    return { text: `OK — ${t.candidates} candidate event link${t.candidates === 1 ? '' : 's'} via ${t.method?.toUpperCase()}`, bad: false };
  }
  if (t.bot.ok) {
    // Naming the method matters: a zero-candidate RSS result means the saved
    // feed is the problem, not the listing page's markup.
    return {
      text: t.method === 'rss'
        ? 'Reachable, but this feed contains no event links — it is probably a generic blog or news feed. Clear the feed URL below so scans use the listing page again.'
        : 'Reachable, but no event links found in the raw HTML — the page may render its listings with JavaScript, or its link paths are unrecognised',
      bad: true,
    };
  }
  if (t.browser.ok) {
    return { text: `The site filters by user agent: GuestlistBot got ${probeLabel(t.bot)} while a browser user agent got ${probeLabel(t.browser)}`, bad: true };
  }
  return { text: `Unreachable with both user agents (bot: ${probeLabel(t.bot)}, browser: ${probeLabel(t.browser)}) — wrong URL, or the site blocks this server's IP`, bad: true };
}

export function SourceControls({
  id, name, url, feedUrl, active, trust, pollingEnabled, pollFrequencyHours,
  city, country, genreIds, genres, countries,
}: {
  id: string;
  name: string;
  url: string;
  feedUrl: string | null;
  active: boolean;
  trust: string;
  pollingEnabled: boolean;
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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestFetchResult | null>(null);
  const [error, setError] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tagName, setTagName] = useState(name);
  const [tagUrl, setTagUrl] = useState(url);
  const [tagFeedUrl, setTagFeedUrl] = useState(feedUrl ?? '');
  const [tagCity, setTagCity] = useState(city ?? '');
  const [tagCountry, setTagCountry] = useState(country ?? '');
  const [tagGenres, setTagGenres] = useState<string[]>(genreIds);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  async function scanNow() {
    setScanning(true);
    setError('');
    setScanResult(null);
    const res = await fetch(`/api/admin/sources/${id}/scan`, { method: 'POST' });
    setScanning(false);
    if (res.ok) {
      setScanResult(await res.json());
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? 'Scan failed');
    }
  }

  async function testFetch() {
    setTesting(true);
    setError('');
    setTestResult(null);
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
          {scanning ? 'Scanning…' : 'Scan now'}
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
              if (ok) setTagOpen(false);
            }}
          >
            Save
          </button>
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
            </div>
          </div>
        );
      })()}
      {error && <div style={{ color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>}
    </div>
  );
}
