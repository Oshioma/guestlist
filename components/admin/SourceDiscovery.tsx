'use client';

// FIND SOURCES: search a country (optionally one city) for clubs, promoters,
// festivals and calendars that programme the genres we care about, test each
// one against the real scanner, and add the ones that work.
//
// Suggestions come from a model, so nothing here is taken on trust: a
// candidate cannot be added until it has been fetched and we have seen what
// the scanner would find on it. A suggestion that does not resolve just
// fails its test and stays out.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GenrePicker, type GenreOpt } from '@/components/admin/GenrePicker';
import { probeLabel, testVerdict, type ProbeResult } from '@/lib/supply/verdict';
import { sourceTypeLabel } from '@/lib/util';

type Candidate = {
  name: string;
  url: string;
  homepage: string | null;
  kind: string;
  city: string | null;
  country: string;
  genres: string[];
  note: string | null;
  known: boolean;
};

type RowState = {
  testing: boolean;
  result: ProbeResult | null;
  adding: boolean;
  addedId: string | null;
  error: string;
};

const blankRow = (): RowState => ({ testing: false, result: null, adding: false, addedId: null, error: '' });

export function SourceDiscovery({
  genres, countries,
}: {
  genres: GenreOpt[];
  countries: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [genreIds, setGenreIds] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [testingAll, setTestingAll] = useState(false);

  const setRow = (url: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [url]: { ...(prev[url] ?? blankRow()), ...patch } }));

  async function search() {
    if (!country.trim()) { setError('Choose a country first'); return; }
    setSearching(true);
    setError('');
    setCandidates([]);
    setRows({});
    try {
      const res = await fetch('/api/admin/sources/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, city: city || null, genreIds, limit: 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCandidates(data.candidates ?? []);
        setSearched(true);
      } else {
        setError(data?.error ?? 'Search failed');
      }
    } catch {
      setError('Could not reach the server — try again');
    } finally {
      setSearching(false);
    }
  }

  async function test(url: string): Promise<ProbeResult | null> {
    setRow(url, { testing: true, error: '', result: null });
    try {
      const res = await fetch('/api/admin/sources/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setRow(url, { testing: false, result: data }); return data as ProbeResult; }
      setRow(url, { testing: false, error: data?.error ?? 'Test failed' });
    } catch {
      setRow(url, { testing: false, error: 'Could not reach the server' });
    }
    return null;
  }

  // Sequential on purpose — testing ten sites at once is a small burst of
  // traffic at other people's servers, and the per-fetch delay is the whole
  // politeness contract of the scanner.
  async function testAll() {
    setTestingAll(true);
    for (const c of candidates) {
      if (c.known || rows[c.url]?.result) continue;
      await test(c.url);
    }
    setTestingAll(false);
  }

  async function add(c: Candidate) {
    setRow(c.url, { adding: true, error: '' });
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          url: c.url,
          sourceType: c.kind,
          city: c.city,
          country: c.country,
          genreIds,
          notes: c.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRow(c.url, { adding: false, addedId: data.id ?? 'added' });
        router.refresh();
      } else {
        setRow(c.url, { adding: false, error: data?.error ?? 'Could not add' });
      }
    } catch {
      setRow(c.url, { adding: false, error: 'Could not reach the server' });
    }
  }

  return (
    <div className="discoverPanel">
      <div className="discoverHead">
        <div>
          <strong>Find clubs &amp; events</strong>
          <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
            Search a country for venues, promoters and festivals playing your genres,
            test each one against the scanner, then add the ones that work.
          </div>
        </div>
        <button className="btnGhost" type="button" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Search by country'}
        </button>
      </div>

      {open && (
        <>
          <div className="discoverForm">
            <div>
              <label htmlFor="d-country">Country *</label>
              <input id="d-country" value={country} onChange={(e) => setCountry(e.target.value)}
                     placeholder="e.g. Tanzania" maxLength={80} list="d-countries" />
              <datalist id="d-countries">
                {countries.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="d-city">City (optional)</label>
              <input id="d-city" value={city} onChange={(e) => setCity(e.target.value)}
                     placeholder="e.g. Dar es Salaam" maxLength={80} />
            </div>
          </div>
          <label style={{ display: 'block', marginTop: 10 }}>Genres</label>
          <GenrePicker genres={genres} selected={genreIds} onChange={setGenreIds} wrap />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btnAccent" type="button" onClick={search} disabled={searching}>
              {searching ? 'Searching…' : 'Find sources'}
            </button>
            {candidates.length > 0 && (
              <button className="btnGhost" type="button" onClick={testAll} disabled={testingAll}>
                {testingAll ? 'Testing…' : 'Test all'}
              </button>
            )}
            {error && <span style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</span>}
          </div>

          {searched && candidates.length === 0 && !error && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 12 }}>
              Nothing found for that country and genre mix — try the country on its own,
              or fewer genres.
            </p>
          )}

          {candidates.length > 0 && (
            <div className="adminTableWrap" style={{ marginTop: 14 }}>
              <table className="adminTable">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Where</th>
                    <th>Type</th>
                    <th>Test result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const row = rows[c.url] ?? blankRow();
                    const v = row.result ? testVerdict(row.result) : null;
                    return (
                      <tr key={c.url}>
                        <td>
                          <strong>{c.name}</strong>
                          <div style={{ fontSize: 11.5 }}>
                            <a href={c.url} target="_blank" rel="noopener noreferrer"
                               style={{ textDecoration: 'underline', wordBreak: 'break-all' }}>
                              {c.url}
                            </a>
                          </div>
                          {c.note && (
                            <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{c.note}</div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {c.city ?? '—'}
                          <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{c.country}</div>
                        </td>
                        <td style={{ fontSize: 12 }}>{sourceTypeLabel(c.kind)}</td>
                        <td style={{ minWidth: 220 }}>
                          {c.known ? (
                            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                              Already a source
                            </span>
                          ) : row.testing ? (
                            <span style={{ fontSize: 12 }}>Testing…</span>
                          ) : v && row.result ? (
                            <div style={{ fontSize: 11.5, lineHeight: 1.5,
                                          color: v.bad ? 'var(--danger)' : 'var(--text-soft)' }}>
                              {v.text}
                              <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                                bot: {probeLabel(row.result.bot)} · browser: {probeLabel(row.result.browser)}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Not tested</span>
                          )}
                          {row.error && (
                            <div style={{ color: 'var(--danger)', fontSize: 11.5 }}>{row.error}</div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {c.known || row.addedId ? (
                            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                              {row.addedId ? 'Added ✓' : '—'}
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="btnGhost" type="button"
                                      style={{ padding: '4px 10px', fontSize: 11 }}
                                      onClick={() => test(c.url)} disabled={row.testing || testingAll}>
                                {row.result ? 'Retest' : 'Test'}
                              </button>
                              {/* Add stays shut until we have fetched the page
                                  ourselves: an untested suggestion is just a
                                  sentence from a model. */}
                              <button
                                className={v && !v.bad ? 'btnAccent' : 'btnGhost'}
                                type="button"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => add(c)}
                                disabled={!row.result || row.adding}
                                title={row.result ? undefined : 'Test it first'}
                              >
                                {row.adding ? 'Adding…' : v?.bad ? 'Add anyway' : 'Add source'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
