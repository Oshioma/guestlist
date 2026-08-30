'use client';

// One event in the admin review queue: everything an admin needs to check
// at a glance, plus PUBLISH / EDIT / REJECT.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { eventTypeLabel, fmtEventDate, fmtEventTime, formatPrice, sourceTypeLabel } from '@/lib/util';

export type AdminEventRow = {
  id: string;
  title: string;
  slug: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  city: string | null;
  country: string | null;
  event_type: string;
  ticket_url: string | null;
  price_from: string | null;
  price_to: string | null;
  currency: string | null;
  primary_image_url: string | null;
  source_url: string | null;
  source_type: string;
  status: string;
  confidence_score: string | null;
  featured: boolean;
  possible_duplicate_of: string | null;
  venue_name: string | null;
  promoter_name: string | null;
  duplicate_of_title: string | null;
  duplicate_of_slug: string | null;
  genres: string[];
  lineup: string[];
};

export function ReviewCard({ event }: { event: AdminEventRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function setStatus(status: 'live' | 'rejected' | 'new') {
    setBusy(status);
    setError('');
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        // Publishing something flagged as a duplicate is an explicit admin
        // decision that it isn't one — clear the flag with it.
        status === 'live' ? { status, clearDuplicateFlag: true } : { status }
      ),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  const price = formatPrice(event.price_from, event.price_to, event.currency);

  return (
    <div className="reviewCard">
      {event.primary_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={event.primary_image_url} alt="" />
      ) : (
        <div className="thumb empty">no image</div>
      )}

      <div>
        {event.possible_duplicate_of && (
          <div className="dupWarning">
            Possible duplicate
            {event.duplicate_of_slug && (
              <>
                {' '}of{' '}
                <Link href={`/events/${event.duplicate_of_slug}`} style={{ textDecoration: 'underline' }}>
                  {event.duplicate_of_title}
                </Link>
              </>
            )}
          </div>
        )}
        <h3>{event.title}</h3>
        <div className="facts">
          <span><b>{fmtEventDate(event.start_at, event.end_at, event.timezone)}</b> · {fmtEventTime(event.start_at, event.end_at, event.timezone)}</span>
          {event.venue_name && <span>Venue: <b>{event.venue_name}</b></span>}
          {event.city && <span>City: <b>{event.city}</b></span>}
          <span>Type: <b>{eventTypeLabel(event.event_type)}</b></span>
          {event.genres.length > 0 && <span>Genres: <b>{event.genres.join(', ')}</b></span>}
          {event.lineup.length > 0 && <span>Lineup: <b>{event.lineup.join(', ')}</b></span>}
          {event.promoter_name && <span>Promoter: <b>{event.promoter_name}</b></span>}
          {price && <span>Price: <b>{price}</b></span>}
          {event.ticket_url && (
            <span>
              Tickets:{' '}
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                link ↗
              </a>
            </span>
          )}
          <span>Source: <b>{sourceTypeLabel(event.source_type)}</b>{' '}
            {event.source_url && (
              <a href={event.source_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>↗</a>
            )}
          </span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="confidencePill">
            {event.confidence_score != null
              ? `Confidence ${Number(event.confidence_score).toFixed(0)}%`
              : 'Confidence —'}
          </span>
          {event.featured && <span className="confidencePill" style={{ color: 'var(--accent)' }}>Featured</span>}
          {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
        </div>
      </div>

      <div className="actions">
        {event.status !== 'live' && (
          <button className="btnAccent" onClick={() => setStatus('live')} disabled={!!busy} type="button">
            {busy === 'live' ? '…' : 'Publish'}
          </button>
        )}
        <Link className="btnGhost" style={{ textAlign: 'center' }} href={`/admin/events/${event.id}`}>
          Edit
        </Link>
        {event.status === 'live' ? (
          <button className="btnGhost" onClick={() => setStatus('new')} disabled={!!busy} type="button">
            {busy === 'new' ? '…' : 'Unpublish'}
          </button>
        ) : (
          event.status !== 'rejected' && (
            <button className="btnGhost" onClick={() => setStatus('rejected')} disabled={!!busy} type="button">
              {busy === 'rejected' ? '…' : 'Reject'}
            </button>
          )
        )}
        <Link className="btnGhost" style={{ textAlign: 'center' }} href={`/events/${event.slug}`}>
          View
        </Link>
      </div>
    </div>
  );
}
