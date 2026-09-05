'use client';

// Manual event create/edit form for admins.
//
// The picture can be a URL or a file. An event typed in by hand has no source
// page to scrape a flyer from — somebody was sent a JPEG on WhatsApp — and
// pasting a URL means hosting the file somewhere else first, which is a job
// nobody should have to do to add a night.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EVENT_TYPES } from '@/lib/util';

type Opt = { id: string; name: string };
type GenreOpt = { slug: string; name: string; parent_name: string | null };

export type EventFormValues = {
  id?: string;
  title: string;
  shortDescription: string;
  description: string;
  startAt: string; // datetime-local value
  endAt: string;
  timezone: string;
  venueId: string;
  promoterId: string;
  city: string;
  country: string;
  eventType: string;
  ticketUrl: string;
  priceFrom: string;
  priceTo: string;
  currency: string;
  primaryImageUrl: string;
  sourceUrl: string;
  worthTravelling: boolean;
  featured: boolean;
  status: string;
  genreSlugs: string[];
  lineup: string; // one artist per line
};

export const EMPTY_EVENT: EventFormValues = {
  title: '', shortDescription: '', description: '', startAt: '', endAt: '',
  timezone: 'Europe/London', venueId: '', promoterId: '', city: '', country: '',
  eventType: 'club_night', ticketUrl: '', priceFrom: '', priceTo: '', currency: 'GBP',
  primaryImageUrl: '', sourceUrl: '', worthTravelling: false, featured: false,
  status: 'new', genreSlugs: [], lineup: '',
};

const TIMEZONES = [
  'Europe/London', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Berlin',
  'Europe/Zagreb', 'Europe/Paris', 'Africa/Dar_es_Salaam', 'America/New_York',
];

export function EventForm({
  initial,
  genres,
  venues,
  promoters,
}: {
  initial: EventFormValues;
  genres: GenreOpt[];
  venues: Opt[];
  promoters: Opt[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const upd = (patch: Partial<EventFormValues>) => setValues((v) => ({ ...v, ...patch }));

  function toggleGenre(slug: string) {
    upd({
      genreSlugs: values.genreSlugs.includes(slug)
        ? values.genreSlugs.filter((s) => s !== slug)
        : [...values.genreSlugs, slug],
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      title: values.title,
      shortDescription: values.shortDescription || null,
      description: values.description || null,
      // Raw wall-clock values; the server interprets them in the event's
      // timezone (never this browser's timezone).
      startAt: values.startAt,
      endAt: values.endAt || null,
      timezone: values.timezone,
      venueId: values.venueId || null,
      promoterId: values.promoterId || null,
      city: values.city || null,
      country: values.country || null,
      eventType: values.eventType,
      ticketUrl: values.ticketUrl || null,
      priceFrom: values.priceFrom === '' ? null : Number(values.priceFrom),
      priceTo: values.priceTo === '' ? null : Number(values.priceTo),
      currency: values.currency || null,
      primaryImageUrl: values.primaryImageUrl || null,
      sourceUrl: values.sourceUrl || null,
      worthTravelling: values.worthTravelling,
      featured: values.featured,
      status: values.status,
      genreSlugs: values.genreSlugs,
      lineup: values.lineup.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    const res = await fetch(
      values.id ? `/api/admin/events/${values.id}` : '/api/admin/events',
      {
        method: values.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    setBusy(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!values.id && data.possibleDuplicateOf) {
        // Surface the dedupe outcome instead of silently queueing it.
        alert('Heads up: this looks like a possible duplicate, so it went to Needs Review.');
      }
      router.push('/admin/events' + (payload.status === 'live' ? '?state=live' : `?state=${data.status ?? payload.status}`));
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? 'Save failed');
    }
  }

  const parents = genres.filter((g) => !g.parent_name);
  const children = genres.filter((g) => g.parent_name);

  return (
    <form className="formCard" style={{ maxWidth: 720, margin: '30px 0 80px' }} onSubmit={onSubmit}>
      <label htmlFor="f-title">Title *</label>
      <input id="f-title" value={values.title} onChange={(e) => upd({ title: e.target.value })} required />

      <label htmlFor="f-short">Short description</label>
      <input id="f-short" value={values.shortDescription} onChange={(e) => upd({ shortDescription: e.target.value })} />

      <label htmlFor="f-desc">Description</label>
      <textarea id="f-desc" rows={5} value={values.description} onChange={(e) => upd({ description: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="f-start">Starts *</label>
          <input id="f-start" type="datetime-local" value={values.startAt} onChange={(e) => upd({ startAt: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="f-end">Ends</label>
          <input id="f-end" type="datetime-local" value={values.endAt} onChange={(e) => upd({ endAt: e.target.value })} />
        </div>
      </div>

      <label htmlFor="f-tz">Timezone</label>
      <select id="f-tz" value={values.timezone} onChange={(e) => upd({ timezone: e.target.value })}>
        {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="f-venue">Venue</label>
          <select id="f-venue" value={values.venueId} onChange={(e) => upd({ venueId: e.target.value })}>
            <option value="">— none —</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-promoter">Promoter</label>
          <select id="f-promoter" value={values.promoterId} onChange={(e) => upd({ promoterId: e.target.value })}>
            <option value="">— none —</option>
            {promoters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="f-city">City</label>
          <input id="f-city" value={values.city} onChange={(e) => upd({ city: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-country">Country</label>
          <input id="f-country" value={values.country} onChange={(e) => upd({ country: e.target.value })} />
        </div>
      </div>

      <label htmlFor="f-type">Event type *</label>
      <select id="f-type" value={values.eventType} onChange={(e) => upd({ eventType: e.target.value })}>
        {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      <label>Genres</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {parents.map((g) => (
          <button
            key={g.slug}
            type="button"
            className={`chip${values.genreSlugs.includes(g.slug) ? ' active' : ''}`}
            onClick={() => toggleGenre(g.slug)}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {children.map((g) => (
          <button
            key={g.slug}
            type="button"
            className={`chip${values.genreSlugs.includes(g.slug) ? ' active' : ''}`}
            onClick={() => toggleGenre(g.slug)}
            title={g.parent_name ?? undefined}
          >
            {g.name}
          </button>
        ))}
      </div>

      <label htmlFor="f-lineup">Lineup (one artist per line, top billing first)</label>
      <textarea id="f-lineup" rows={4} value={values.lineup} onChange={(e) => upd({ lineup: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="f-pfrom">Price from</label>
          <input id="f-pfrom" type="number" min="0" step="0.01" value={values.priceFrom} onChange={(e) => upd({ priceFrom: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-pto">Price to</label>
          <input id="f-pto" type="number" min="0" step="0.01" value={values.priceTo} onChange={(e) => upd({ priceTo: e.target.value })} />
        </div>
        <div>
          <label htmlFor="f-cur">Currency</label>
          <input id="f-cur" value={values.currency} maxLength={3} onChange={(e) => upd({ currency: e.target.value.toUpperCase() })} />
        </div>
      </div>

      <label htmlFor="f-ticket">Ticket URL</label>
      <input id="f-ticket" type="url" value={values.ticketUrl} onChange={(e) => upd({ ticketUrl: e.target.value })} />

      <label htmlFor="f-img">Primary image</label>
      <div className="evImgRow">
        <input id="f-img" value={values.primaryImageUrl} placeholder="https://… or upload a file →"
               onChange={(e) => upd({ primaryImageUrl: e.target.value })} />
        {/* A label wrapping a hidden input, because a bare file input cannot be
            styled to look like the rest of this form in any browser. */}
        <label className="btnGhost evImgUpload" style={{ margin: 0 }}>
          {uploading ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              // Clear it either way, so choosing the same file twice still fires.
              e.target.value = '';
              if (!file) return;
              setUploading(true);
              setUploadError('');
              try {
                const body = new FormData();
                body.append('file', file);
                const res = await fetch('/api/admin/events/image', { method: 'POST', body });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error ?? 'Could not upload that');
                upd({ primaryImageUrl: data.url });
              } catch (err) {
                setUploadError(err instanceof Error ? err.message : 'Could not upload that');
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
      </div>
      {uploadError && <div className="formError">{uploadError}</div>}
      {values.primaryImageUrl && (
        // Looking at it beats saving and finding out.
        // eslint-disable-next-line @next/next/no-img-element
        <div className="evImgPreview"><img src={values.primaryImageUrl} alt="" /></div>
      )}

      <label htmlFor="f-src">Source URL</label>
      <input id="f-src" value={values.sourceUrl} onChange={(e) => upd({ sourceUrl: e.target.value })} />

      <div style={{ display: 'flex', gap: 22, marginTop: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0.3, fontSize: 13, color: 'var(--text-soft)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={values.featured} onChange={(e) => upd({ featured: e.target.checked })} />
          Featured
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'none', letterSpacing: 0.3, fontSize: 13, color: 'var(--text-soft)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={values.worthTravelling} onChange={(e) => upd({ worthTravelling: e.target.checked })} />
          Worth travelling for
        </label>
      </div>

      <label htmlFor="f-status">Status</label>
      <select id="f-status" value={values.status} onChange={(e) => upd({ status: e.target.value })}>
        <option value="new">New</option>
        <option value="needs_review">Needs review</option>
        <option value="live">Live (published)</option>
        <option value="rejected">Rejected</option>
      </select>

      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
        {busy ? 'Saving…' : values.id ? 'Save changes' : 'Create event'}
      </button>
    </form>
  );
}
