'use client';

// THE PICTURES ON THE SITE, WHERE SOMEBODY CAN CHANGE THEM.
//
// Each card is a slot: what it is, where it appears, what the picture has to
// do, and the picture currently in it. Changing one is a file picker or an
// address, and there is always a way back to the original — which is the
// thing that makes experimenting safe.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = {
  key: string; label: string; where: string; guidance: string;
  url: string; overridden: boolean;
};

export function SiteImages({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [urlOpen, setUrlOpen] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const files = useRef<Record<string, HTMLInputElement | null>>({});

  function apply(row: Row) {
    setRows((xs) => xs.map((x) => (x.key === row.key ? row : x)));
    // The pictures are on public pages, so the pages have to hear about it.
    router.refresh();
  }
  function fail(key: string, message: string) {
    setError((e) => ({ ...e, [key]: message }));
  }

  async function send(key: string, init: RequestInit) {
    setBusy(key);
    setError((e) => ({ ...e, [key]: '' }));
    const res = await fetch('/api/admin/site/images', init).catch(() => null);
    setBusy(null);
    if (!res) { fail(key, 'Could not reach the server'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { fail(key, data.error ?? 'Could not change that picture'); return; }
    apply(data.image);
    setUrlOpen(null);
  }

  async function upload(key: string, file: File) {
    const form = new FormData();
    form.set('slot', key);
    form.set('file', file);
    await send(key, { method: 'POST', body: form });
  }

  const asJson = (key: string, url: string | null) => send(key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot: key, url }),
  });

  return (
    <div className="siteImgGrid">
      {rows.map((row) => (
        <div className="siteImgCard" key={row.key}>
          <div className="siteImgThumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.url} alt="" />
            {row.overridden && <span className="siteImgBadge">Changed</span>}
          </div>
          <div className="siteImgBody">
            <div className="siteImgLabel">{row.label}</div>
            <div className="siteImgWhere">{row.where}</div>
            <div className="siteImgGuide">{row.guidance}</div>

            {urlOpen === row.key ? (
              <div className="siteImgUrlRow">
                <input
                  autoFocus value={urlDraft} placeholder="https://…"
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') asJson(row.key, urlDraft); }}
                />
                <button type="button" className="btnAccent siteImgBtn" disabled={busy === row.key}
                        onClick={() => asJson(row.key, urlDraft)}>Use it</button>
                <button type="button" className="btnGhost siteImgBtn"
                        onClick={() => setUrlOpen(null)}>Cancel</button>
              </div>
            ) : (
              <div className="siteImgActions">
                <input
                  type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
                  ref={(n) => { files.current[row.key] = n; }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ''; // so the same file can be picked twice
                    if (file) upload(row.key, file);
                  }}
                />
                <button type="button" className="btnAccent siteImgBtn" disabled={busy === row.key}
                        onClick={() => files.current[row.key]?.click()}>
                  {busy === row.key ? 'Working…' : 'Replace'}
                </button>
                <button type="button" className="btnGhost siteImgBtn" disabled={busy === row.key}
                        onClick={() => { setUrlDraft(''); setUrlOpen(row.key); }}>Use an address</button>
                {/* Only offered when there is something to undo. */}
                {row.overridden && (
                  <button type="button" className="btnGhost siteImgBtn" disabled={busy === row.key}
                          onClick={() => asJson(row.key, null)}>Put the original back</button>
                )}
              </div>
            )}
            {error[row.key] && <div className="siteImgError">{error[row.key]}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
