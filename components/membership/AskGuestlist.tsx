'use client';

// ASK GUESTLIST — built for a phone. Paste a link or say what you're after,
// JUST ME / ME +1, optional note, one button. Details are behind a fold and
// never required. Submits into the same pipeline as GET ME IN.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { track } from '@/lib/track';

const TYPES: [string, string][] = [
  ['event_access', 'Get me in'], ['plus_one', '+1'], ['sold_out_event', 'Sold out'],
  ['event_recommendation', 'Recommend me'], ['afterparty', 'Afterparty'], ['city_recommendation', 'I’m in a city'], ['other', 'Something else'],
];

type Outcome = { kind: 'guestlisted' | 'requested'; friendly: { key: string; title: string; body: string } | null; matched: string | null; eventSlug: string | null };

export function AskGuestlist({ context, initialText = '', initialCity = '' }: { context: string; initialText?: string; initialCity?: string }) {
  const [text, setText] = useState(initialText);
  const [type, setType] = useState<string>('event_access');
  const [places, setPlaces] = useState<1 | 2>(1);
  const [details, setDetails] = useState({ name: '', venue: '', city: initialCity, startsAt: '', ticketPrice: '', lineup: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Outcome | null>(null);

  useEffect(() => { track('ask_guestlist_opened', { context }); }, [context]);

  const link = text.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0] ?? null;
  const effectiveType = places === 2 && type === 'event_access' ? 'plus_one' : type;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/membership/ask', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, requestType: effectiveType, places, context, ...details }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send that');
      setDone(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const f = done.friendly;
    return (
      <div className="askBox">
        <div className={`reqState ${f?.key ?? 'working'}`}>
          <p className="t">{f?.title ?? 'WE’RE WORKING ON IT'}</p>
          <p className="b">{f?.body ?? 'Guestlist is on it. We’ll let you know as soon as we hear back.'}</p>
          {done.matched === 'url' && done.eventSlug && <p className="b" style={{ marginTop: 6 }}>That one’s on Guestlist: <Link href={`/events/${done.eventSlug}`} style={{ textDecoration: 'underline' }}>see the event</Link>.</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link href="/you/membership" className="btnAccent">Your requests</Link>
          <button className="btnGhost" onClick={() => { setDone(null); setText(''); setDetails({ name: '', venue: '', city: initialCity, startsAt: '', ticketPrice: '', lineup: '' }); }}>Ask something else</button>
        </div>
      </div>
    );
  }

  return (
    <form className="askBox" onSubmit={submit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 1500))}
        placeholder="Paste the event link, or tell us what you’re after. “Can you get me +1 for this on Saturday?”"
        autoFocus
      />
      {link && <div className="askLinkChip">🔗 {link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</div>}
      <div className="askTypes" role="group" aria-label="What kind of ask">
        {TYPES.map(([k, l]) => (
          <button type="button" key={k} className={`chip${(effectiveType === k) ? ' active' : ''}`} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>
      <div className="placesToggle" role="group" aria-label="How many places">
        <button type="button" className={places === 1 ? 'active' : ''} onClick={() => setPlaces(1)}>Just me</button>
        <button type="button" className={places === 2 ? 'active' : ''} onClick={() => setPlaces(2)}>Me +1</button>
      </div>
      <details className="askDetails">
        <summary>Add details (optional) — name, venue, date, price, lineup</summary>
        <label htmlFor="ask-name">Event name</label>
        <input id="ask-name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
        <div className="row">
          <div><label htmlFor="ask-venue">Venue</label><input id="ask-venue" value={details.venue} onChange={(e) => setDetails({ ...details, venue: e.target.value })} /></div>
          <div><label htmlFor="ask-city">City</label><input id="ask-city" value={details.city} onChange={(e) => setDetails({ ...details, city: e.target.value })} /></div>
        </div>
        <div className="row">
          <div><label htmlFor="ask-when">Date / time</label><input id="ask-when" type="datetime-local" value={details.startsAt} onChange={(e) => setDetails({ ...details, startsAt: e.target.value })} /></div>
          <div><label htmlFor="ask-price">Ticket price (£)</label><input id="ask-price" type="number" min={0} step="0.01" value={details.ticketPrice} onChange={(e) => setDetails({ ...details, ticketPrice: e.target.value })} /></div>
        </div>
        <label htmlFor="ask-lineup">Artists / lineup</label>
        <input id="ask-lineup" value={details.lineup} onChange={(e) => setDetails({ ...details, lineup: e.target.value })} />
      </details>
      {error && <p className="getMeInQualifier" style={{ color: 'var(--danger)', textAlign: 'left' }}>{error}</p>}
      <button className="getMeInBtn" type="submit" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Ask Guestlist'}</button>
      <p className="getMeInQualifier">Free entrance when we can make it happen. Subject to availability and fair use. +1s when we can.</p>
    </form>
  );
}
