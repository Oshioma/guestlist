'use client';

// ADD TO THE ARCHIVE — three light questions, the system does the rest.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Vercel rejects request bodies over ~4.5MB, so anything bigger is shrunk
// in the browser first; images that still exceed the cap are refused with a
// clear message instead of a connection that dies mid-upload.
const UPLOAD_LIMIT = 4 * 1024 * 1024;

async function shrinkImage(file: File): Promise<File> {
  if (file.size <= UPLOAD_LIMIT) return file;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // gif: recompressing loses animation
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2200; // plenty for flyer OCR + the 1280px display variant
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) {
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
  } catch {
    /* fall through — the size check below still guards the upload */
  }
  return file;
}

export function ContributeForm({ initialEventName = '' }: { initialEventName?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'flyer' | 'event'>(initialEventName ? 'event' : 'flyer');
  const [file, setFile] = useState<File | null>(null);
  const [itemType, setItemType] = useState('flyer');
  const [what, setWhat] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [notes, setNotes] = useState('');
  const [credit, setCredit] = useState(true);
  const [manual, setManual] = useState({ title: initialEventName, year: '', circa: '', venue: '', promoter: '', city: '', country: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitFlyer(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const upload = await shrinkImage(file);
      if (upload.size > UPLOAD_LIMIT) {
        setError('That image is too large to upload (about 4MB max). Try a photo or screenshot of it instead.');
        return;
      }
      const form = new FormData();
      form.set('file', upload);
      form.set('itemType', itemType);
      form.set('what', what);
      form.set('when', when);
      form.set('where', where);
      form.set('notes', notes);
      form.set('credit', String(credit));
      const res = await fetch('/api/archive/contribute', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setResult(data.note); router.refresh(); }
      else setError(data.error ?? 'Upload failed');
    } catch {
      setError('Upload failed — check your connection and try again. Smaller images upload more reliably.');
    } finally {
      setBusy(false);
    }
  }

  async function submitEvent(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/archive/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setResult(data.note); router.refresh(); }
      else setError(data.error ?? 'Something went wrong');
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="clubJoin">
        <p>✓ {result}</p>
        <button className="btnGhost" type="button" onClick={() => { setResult(null); setFile(null); }}>
          Add something else
        </button>
      </div>
    );
  }

  return (
    <div className="youPanel">
      <div className="chipRow" style={{ marginBottom: 14 }}>
        <button type="button" className={`chip${mode === 'flyer' ? ' active' : ''}`} onClick={() => setMode('flyer')}>
          Upload a flyer / photo
        </button>
        <button type="button" className={`chip${mode === 'event' ? ' active' : ''}`} onClick={() => setMode('event')}>
          Add an old event
        </button>
      </div>

      {mode === 'flyer' ? (
        <form className="youProfileForm" onSubmit={submitFlyer}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="youNewGrid">
            <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
              <option value="flyer">Flyer</option>
              <option value="poster">Poster</option>
              <option value="photo">Photo</option>
              <option value="ticket_stub">Ticket stub</option>
              <option value="memorabilia">Memorabilia</option>
            </select>
            <input placeholder="What was this? (Metalheadz at Blue Note)" value={what} maxLength={200}
                   onChange={(e) => setWhat(e.target.value)} />
            <input placeholder="Roughly when? (1996, Summer 1996…)" value={when} maxLength={80}
                   onChange={(e) => setWhen(e.target.value)} />
            <input placeholder="Where? (London)" value={where} maxLength={120}
                   onChange={(e) => setWhere(e.target.value)} />
          </div>
          <textarea placeholder="Anything else you remember (optional)" value={notes} maxLength={500} rows={2}
                    onChange={(e) => setNotes(e.target.value)} />
          <label className="notifPrefRow">
            <input type="checkbox" checked={credit} onChange={() => setCredit((c) => !c)} />
            Credit me by name (“Contributed by …”)
          </label>
          <div className="youPanelActions">
            <button className="btnAccent" type="submit" disabled={busy || !file}>
              {busy ? 'Uploading…' : 'Add to the archive'}
            </button>
          </div>
        </form>
      ) : (
        <form className="youProfileForm" onSubmit={submitEvent}>
          <div className="youNewGrid">
            <input placeholder="Event name" required value={manual.title}
                   onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            <input placeholder="Year (1996)" inputMode="numeric" maxLength={4} value={manual.year}
                   onChange={(e) => setManual({ ...manual, year: e.target.value.replace(/\D/g, '') })} />
            <input placeholder="Or in words (Summer 1996)" value={manual.circa}
                   onChange={(e) => setManual({ ...manual, circa: e.target.value })} />
            <input placeholder="Venue" value={manual.venue}
                   onChange={(e) => setManual({ ...manual, venue: e.target.value })} />
            <input placeholder="Promoter" value={manual.promoter}
                   onChange={(e) => setManual({ ...manual, promoter: e.target.value })} />
            <input placeholder="City" value={manual.city}
                   onChange={(e) => setManual({ ...manual, city: e.target.value })} />
            <input placeholder="Country" value={manual.country}
                   onChange={(e) => setManual({ ...manual, country: e.target.value })} />
          </div>
          <textarea placeholder="What you remember (optional)" value={manual.notes} maxLength={1000} rows={2}
                    onChange={(e) => setManual({ ...manual, notes: e.target.value })} />
          <div className="youPanelActions">
            <button className="btnAccent" type="submit" disabled={busy || manual.title.length < 2}>
              Add to the archive
            </button>
          </div>
        </form>
      )}
      {error && <div className="formError">{error}</div>}
      <p className="youPanelSub" style={{ marginTop: 12 }}>
        Everything is reviewed by the Guestlist team before it appears.
        Only upload images you took or have the right to share.
      </p>
    </div>
  );
}
