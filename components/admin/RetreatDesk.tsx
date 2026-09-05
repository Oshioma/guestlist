'use client';

// PASTE A LINK, CHECK WHAT CAME BACK, PUT IT ON BALANCE.
//
// The paste box does not save anything. It reads the retreat's own page and
// fills the form in below it, and then a person looks at it — because what a
// retreat's website says about itself is marketing, and what goes on Balance
// is ours. The line under each read says which fields actually came off the
// page, so nobody has to guess whether the blurb is theirs or ours.
//
// When it runs is always typed by hand. Retreats do not publish a start date
// the way a club night does; they run in seasons. "Monthly, October to April"
// is the true answer, and no amount of reading the page will produce it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/retreats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j } as { ok: boolean; error?: string; draft?: Record<string, string | null>; found?: string[]; images?: string[]; sourceUrl?: string };
}

export type RetreatForm = {
  id?: string; title: string; location: string; whenText: string; blurb: string;
  imageUrl: string; url: string; priceText: string; status: string; sortOrder: string; sourceUrl: string;
};

export const EMPTY_RETREAT: RetreatForm = {
  title: '', location: '', whenText: '', blurb: '', imageUrl: '', url: '',
  priceText: '', status: 'draft', sortOrder: '0', sourceUrl: '',
};

const FOUND_LABEL: Record<string, string> = {
  title: 'name', location: 'where', blurb: 'description', image: 'picture', price: 'price',
};

export function RetreatEditor({ initial, onDone }: { initial: RetreatForm; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<string[] | null>(null);
  // Every picture the page had, so the first pick is a suggestion rather than
  // a verdict — the top one is usually right, and when it is not the right
  // one is nearly always three thumbnails along.
  const [pics, setPics] = useState<string[]>(initial.imageUrl ? [initial.imageUrl] : []);

  async function read() {
    setReading(true); setErr(''); setFound(null);
    const r = await post({ action: 'read_link', url: link });
    setReading(false);
    if (!r.ok || !r.draft) { setErr(r.error ?? 'Couldn’t read that link'); return; }
    setPics(r.images ?? []);
    setV((cur) => ({
      ...cur,
      title: (r.draft!.title as string) || cur.title,
      location: (r.draft!.location as string) ?? cur.location,
      blurb: (r.draft!.blurb as string) ?? cur.blurb,
      imageUrl: (r.draft!.imageUrl as string) ?? cur.imageUrl,
      url: (r.draft!.url as string) || link,
      priceText: (r.draft!.priceText as string) ?? cur.priceText,
      sourceUrl: r.sourceUrl ?? link,
    }));
    setFound(r.found ?? []);
  }

  return (
    <form
      className="deskForm"
      onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        const r = await post({ action: 'save', ...v, sortOrder: Number(v.sortOrder) });
        setBusy(false);
        if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
        router.refresh(); onDone?.();
      }}
    >
      {/* Only offered on a new card. Re-reading the page over a card somebody
          has already edited would quietly throw their words away. */}
      {!v.id && (
        <div className="retreatRead">
          <label>Paste the retreat’s link</label>
          <div className="retreatReadRow">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://escapespacezanzibar.paradisebeyond.com/"
              // Enter inside this box means "read it", not "save the card".
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (link) void read(); } }}
            />
            <button type="button" className="btnGhost" onClick={read} disabled={reading || !link}>
              {reading ? 'Reading…' : 'Read it'}
            </button>
          </div>
          {found && (
            <div className="retreatFound">
              {found.length
                ? `Read from the page: ${found.map((f) => FOUND_LABEL[f] ?? f).join(', ')}. Check it, then add when it runs.`
                : 'That page gave us nothing usable — fill the card in by hand.'}
            </div>
          )}
        </div>
      )}

      <label>Name</label>
      <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required placeholder="Escape Space Zanzibar" />

      <div className="row">
        <div><label>Where</label><input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} placeholder="Zanzibar, Tanzania" /></div>
        <div><label>When it runs</label><input value={v.whenText} onChange={(e) => setV({ ...v, whenText: e.target.value })} placeholder="Monthly, October to April" /></div>
      </div>

      <label>The line under the name</label>
      <textarea rows={3} value={v.blurb} onChange={(e) => setV({ ...v, blurb: e.target.value })} placeholder="A week on the east coast with nothing on the schedule." />

      <div className="row">
        <div><label>Picture URL</label><input value={v.imageUrl} onChange={(e) => setV({ ...v, imageUrl: e.target.value })} placeholder="https://…" /></div>
        <div><label>Link (where the card sends you)</label><input value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} required placeholder="https://…" /></div>
      </div>

      <div className="row">
        <div><label>Price</label><input value={v.priceText} onChange={(e) => setV({ ...v, priceText: e.target.value })} placeholder="From £1,200" /></div>
        <div>
          <label>Status</label>
          <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="live">Live</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div><label>Order</label><input type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></div>
      </div>

      {pics.length > 1 && (
        <div className="retreatPics">
          <label>Pictures on that page — pick the one people should see</label>
          <div className="retreatPicGrid">
            {pics.map((src) => (
              <button
                key={src}
                type="button"
                className={`retreatPic${src === v.imageUrl ? ' on' : ''}`}
                onClick={() => setV({ ...v, imageUrl: src })}
                title={src}
                aria-pressed={src === v.imageUrl}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {v.imageUrl && (
        // Checking a picture URL by eye beats saving it and looking at Balance.
        <div className="retreatPreview"><img src={v.imageUrl} alt="" /></div>
      )}

      {err && <div className="formError">{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btnAccent" disabled={busy} type="submit">{busy ? '…' : 'Save retreat'}</button>
        {onDone && <button className="btnGhost" type="button" onClick={onDone}>Close</button>}
      </div>
    </form>
  );
}

export function RetreatRow({ initial }: { initial: RetreatForm }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (open) return <RetreatEditor initial={initial} onDone={() => { setOpen(false); router.refresh(); }} />;

  // Arm then confirm, the same two-press contract as everything else that
  // deletes here: there is no undo, so one stray click must never be enough.
  return (
    <span className="adminItemActions">
      <button type="button" className="btnGhost adminItemActionsBtn" onClick={() => setOpen(true)}>Edit</button>
      {!armed ? (
        <button type="button" className="btnGhost adminItemActionsBtn adminItemActionsDanger" onClick={() => setArmed(true)}>
          Delete
        </button>
      ) : (
        <>
          <span className="adminItemActionsWarn">{`Delete \u201c${initial.title}\u201d for good? This cannot be undone.`}</span>
          <button
            type="button" className="btnAccent adminItemActionsBtn" disabled={busy}
            onClick={async () => {
              setBusy(true); setErr('');
              const r = await post({ action: 'delete', id: initial.id });
              setBusy(false);
              if (r.ok) { router.refresh(); return; }
              setErr(r.error ?? 'Could not delete that retreat'); setArmed(false);
            }}
          >
            {busy ? 'Deleting\u2026' : 'Yes, delete'}
          </button>
          <button type="button" className="btnGhost adminItemActionsBtn" disabled={busy} onClick={() => setArmed(false)}>Cancel</button>
        </>
      )}
      {err && <span className="adminItemActionsWarn">{err}</span>}
    </span>
  );
}

export function NewRetreat() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (open) return <RetreatEditor initial={EMPTY_RETREAT} onDone={() => { setOpen(false); router.refresh(); }} />;
  return <button type="button" className="btnAccent" onClick={() => setOpen(true)}>+ Add a retreat from a link</button>;
}
