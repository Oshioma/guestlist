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

export function SourceControls({
  id, active, trust, pollingEnabled, pollFrequencyHours,
  city, country, genreIds, genres, countries,
}: {
  id: string;
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
  const [error, setError] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tagCity, setTagCity] = useState(city ?? '');
  const [tagCountry, setTagCountry] = useState(country ?? '');
  const [tagGenres, setTagGenres] = useState<string[]>(genreIds);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/admin/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
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
          onClick={() => setTagOpen((o) => !o)}
          disabled={busy}
          type="button"
        >
          {tagOpen ? 'Close tags' : 'Tag place/genres'}
        </button>
      </div>
      {tagOpen && (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)',
                      borderRadius: 10, minWidth: 230 }}>
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
              await patch({ city: tagCity, country: tagCountry, genreIds: tagGenres });
              setTagOpen(false);
            }}
          >
            Save tags
          </button>
        </div>
      )}
      {scanResult && (
        <div style={{ fontSize: 11.5, color: 'var(--text-soft)', lineHeight: 1.5 }}>
          {scanResult.status === 'succeeded' ? (
            <>
              {scanResult.candidatesFound} candidate URL{scanResult.candidatesFound === 1 ? '' : 's'} ·{' '}
              {scanResult.newCandidates} new · {scanResult.extracted} extracted ·{' '}
              {scanResult.duplicates} duplicate · {scanResult.failed} failed
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
      {error && <div style={{ color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>}
    </div>
  );
}
