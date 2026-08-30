'use client';

// Event create/edit for promoter teams. Posts to the promoter APIs; no
// Guestlist curation fields (featured etc.) and no raw status control.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EVENT_TYPES } from '@/lib/util';

type Opt = { id: string; name: string };
type GenreOpt = { slug: string; name: string; parent_name: string | null };

export type PromoterEventValues = {
  id?: string;
  title: string; shortDescription: string; description: string;
  startAt: string; endAt: string; timezone: string;
  venueId: string; city: string; country: string;
  eventType: string; ticketUrl: string;
  priceFrom: string; priceTo: string; currency: string;
  primaryImageUrl: string;
  genreSlugs: string[]; lineup: string;
};

export const EMPTY_PROMOTER_EVENT: PromoterEventValues = {
  title: '', shortDescription: '', description: '', startAt: '', endAt: '',
  timezone: 'Europe/London', venueId: '', city: '', country: '',
  eventType: 'club_night', ticketUrl: '', priceFrom: '', priceTo: '', currency: 'GBP',
  primaryImageUrl: '', genreSlugs: [], lineup: '',
};

const TIMEZONES = [
  'Europe/London', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Berlin',
  'Europe/Zagreb', 'Europe/Paris', 'Africa/Dar_es_Salaam', 'America/New_York',
];

export function PromoterEventForm({
  promoterId,
  initial,
  genres,
  venues,
}: {
  promoterId: string;
  initial: PromoterEventValues;
  genres: GenreOpt[];
  venues: Opt[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (patch: Partial<PromoterEventValues>) => setValues((v) => ({ ...v, ...patch }));

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
      startAt: values.startAt,
      endAt: values.endAt || null,
      timezone: values.timezone,
      venueId: values.venueId || null,
      city: values.city || null,
      country: values.country || null,
      eventType: values.eventType,
      ticketUrl: values.ticketUrl || null,
      priceFrom: values.priceFrom === '' ? null : Number(values.priceFrom),
      priceTo: values.priceTo === '' ? null : Number(values.priceTo),
      currency: values.currency || null,
      primaryImageUrl: values.primaryImageUrl || null,
      genreSlugs: values.genreSlugs,
      lineup: values.lineup.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    const res = await fetch(
      values.id
        ? `/api/promoter/${promoterId}/events/${values.id}`
        : `/api/promoter/${promoterId}/events`,
      {
        method: values.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    setBusy(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!values.id && data.status === 'needs_review') {
        alert('This looks similar to an existing event, so Guestlist will double-check it before it goes live.');
      }
      router.push('/promoter/events');
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? 'Save failed');
    }
  }

  const parents = genres.filter((g) => !g.parent_name);
  const children = genres.filter((g) => g.parent_name);

  return (
    <form className="formCard" style={{ maxWidth: 720, margin: '10px 0 80px' }} onSubmit={onSubmit}>
      <label htmlFor="p-title">Title *</label>
      <input id="p-title" value={values.title} onChange={(e) => upd({ title: e.target.value })} required />
      <label htmlFor="p-short">Short description</label>
      <input id="p-short" value={values.shortDescription} onChange={(e) => upd({ shortDescription: e.target.value })} />
      <label htmlFor="p-desc">Description</label>
      <textarea id="p-desc" rows={5} value={values.description} onChange={(e) => upd({ description: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="p-start">Starts *</label>
          <input id="p-start" type="datetime-local" value={values.startAt} onChange={(e) => upd({ startAt: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="p-end">Ends</label>
          <input id="p-end" type="datetime-local" value={values.endAt} onChange={(e) => upd({ endAt: e.target.value })} />
        </div>
      </div>
      <label htmlFor="p-tz">Timezone</label>
      <select id="p-tz" value={values.timezone} onChange={(e) => upd({ timezone: e.target.value })}>
        {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="p-venue">Venue</label>
          <select id="p-venue" value={values.venueId} onChange={(e) => upd({ venueId: e.target.value })}>
            <option value="">— none —</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="p-city">City</label>
          <input id="p-city" value={values.city} onChange={(e) => upd({ city: e.target.value })} />
        </div>
      </div>
      <label htmlFor="p-country">Country</label>
      <input id="p-country" value={values.country} onChange={(e) => upd({ country: e.target.value })} />

      <label htmlFor="p-type">Event type *</label>
      <select id="p-type" value={values.eventType} onChange={(e) => upd({ eventType: e.target.value })}>
        {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      <label>Genres</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {parents.map((g) => (
          <button key={g.slug} type="button"
                  className={`chip${values.genreSlugs.includes(g.slug) ? ' active' : ''}`}
                  onClick={() => toggleGenre(g.slug)}>
            {g.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {children.map((g) => (
          <button key={g.slug} type="button"
                  className={`chip${values.genreSlugs.includes(g.slug) ? ' active' : ''}`}
                  onClick={() => toggleGenre(g.slug)} title={g.parent_name ?? undefined}>
            {g.name}
          </button>
        ))}
      </div>

      <label htmlFor="p-lineup">Lineup (one artist per line, top billing first)</label>
      <textarea id="p-lineup" rows={4} value={values.lineup} onChange={(e) => upd({ lineup: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div>
          <label htmlFor="p-pfrom">Price from</label>
          <input id="p-pfrom" type="number" min="0" step="0.01" value={values.priceFrom} onChange={(e) => upd({ priceFrom: e.target.value })} />
        </div>
        <div>
          <label htmlFor="p-pto">Price to</label>
          <input id="p-pto" type="number" min="0" step="0.01" value={values.priceTo} onChange={(e) => upd({ priceTo: e.target.value })} />
        </div>
        <div>
          <label htmlFor="p-cur">Currency</label>
          <input id="p-cur" value={values.currency} maxLength={3} onChange={(e) => upd({ currency: e.target.value.toUpperCase() })} />
        </div>
      </div>

      <label htmlFor="p-ticket">Ticket URL</label>
      <input id="p-ticket" type="url" value={values.ticketUrl} onChange={(e) => upd({ ticketUrl: e.target.value })} />
      <label htmlFor="p-img">Image URL</label>
      <input id="p-img" value={values.primaryImageUrl} onChange={(e) => upd({ primaryImageUrl: e.target.value })} />

      <div className="formError">{error}</div>
      <button className="btnAccent" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
        {busy ? 'Saving…' : values.id ? 'Save changes' : 'Publish event'}
      </button>
    </form>
  );
}
