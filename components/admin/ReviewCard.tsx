'use client';

// One event in the admin review queue: all key facts at a glance, per-field
// evidence (where the value came from + confidence, coloured green/amber/
// red), and fast actions: PUBLISH / EDIT / REJECT / REPROCESS / VIEW SOURCE
// — plus duplicate resolution (LINK SOURCE) when flagged.

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
  field_confidence: Record<string, number> | null;
  field_sources: Record<string, string> | null;
  extraction_warnings: string[] | null;
  duplicate_state: string | null;
  duplicate_score: string | null;
  ai_used: boolean | null;
  structured_data_found: boolean | null;
  source_count: number;
};

const SOURCE_LABEL: Record<string, string> = {
  'json-ld': 'JSON-LD', opengraph: 'OpenGraph', meta: 'Meta', page: 'Page',
  url: 'URL', feed: 'Feed', ai: 'AI', 'entity-match': 'Matched',
};

function Evidence({ field, label, conf, src }: {
  field: string; label: string;
  conf: Record<string, number> | null; src: Record<string, string> | null;
}) {
  const c = conf?.[field];
  const s = src?.[field];
  if (c == null && !s) return null;
  const tone = c == null ? 'red' : c >= 85 ? 'green' : c >= 60 ? 'amber' : 'red';
  return (
    <span className={`evChip ${tone}`} title={`${label}: ${c ?? '—'}%`}>
      {label} · {s ? SOURCE_LABEL[s] ?? s : '?'}{s === 'ai' && c != null ? ` ${Math.round(c)}%` : ''}
    </span>
  );
}

// A sourced image that 404s must never show as a broken-image icon — the
// desk falls back to the same "no image" tile it uses when there is none.
function AdminThumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  // Images that 404 before hydration never fire onError — catch them on mount.
  const ref = (node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setBroken(true);
  };
  if (!src || broken) return <div className="thumb empty">no image</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} className="thumb" src={src} alt="" onError={() => setBroken(true)} />
  );
}

export function ReviewCard({ event }: { event: AdminEventRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function call(label: string, path: string, body?: unknown, method?: string) {
    setBusy(label);
    setError('');
    const res = await fetch(path, {
      method: method ?? (body === undefined ? 'POST' : 'PATCH'),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? 'Failed');
  }

  const setStatus = (status: 'live' | 'rejected' | 'new') =>
    call(status, `/api/admin/events/${event.id}`,
      status === 'live' ? { status, clearDuplicateFlag: true } : { status });

  const price = formatPrice(event.price_from, event.price_to, event.currency);
  const conf = event.field_confidence;
  const src = event.field_sources;
  const warnings = event.extraction_warnings ?? [];

  return (
    <div className="reviewCard">
      <AdminThumb src={event.primary_image_url} />

      <div>
        {event.possible_duplicate_of && (
          <div className="dupWarning">
            {(event.duplicate_state === 'likely' ? 'Likely duplicate' : 'Possible duplicate') +
              (event.duplicate_score ? ` — ${Math.round(Number(event.duplicate_score))}%` : '')}
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
          <span><b>{fmtEventDate(event.start_at, event.end_at, event.timezone)}</b> · {fmtEventTime(event.start_at, event.end_at, event.timezone)} · {event.timezone}</span>
          {event.venue_name && <span>Venue: <b>{event.venue_name}</b></span>}
          {(event.city || event.country) && (
            <span>Location: <b>{[event.city, event.country].filter(Boolean).join(', ')}</b></span>
          )}
          <span>Type: <b>{eventTypeLabel(event.event_type)}</b></span>
          {event.genres.length > 0 && <span>Genres: <b>{event.genres.join(', ')}</b></span>}
          {event.lineup.length > 0 && <span>Lineup: <b>{event.lineup.join(', ')}</b></span>}
          {event.promoter_name && <span>Promoter: <b>{event.promoter_name}</b></span>}
          {price && <span>Price: <b>{price}</b></span>}
          {event.ticket_url && (
            <span>
              Tickets:{' '}
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>link ↗</a>
            </span>
          )}
          <span>
            Source: <b>{sourceTypeLabel(event.source_type)}</b>
            {event.source_count > 1 && <b> ×{event.source_count}</b>}
          </span>
        </div>

        {(conf || src) && (
          <div className="evRow">
            <Evidence field="title" label="Title" conf={conf} src={src} />
            <Evidence field="date" label="Date" conf={conf} src={src} />
            <Evidence field="start_time" label="Time" conf={conf} src={src} />
            <Evidence field="venue" label="Venue" conf={conf} src={src} />
            <Evidence field="city" label="City" conf={conf} src={src} />
            <Evidence field="genres" label="Genres" conf={conf} src={src} />
            <Evidence field="lineup" label="Lineup" conf={conf} src={src} />
            <Evidence field="promoter" label="Promoter" conf={conf} src={src} />
            <Evidence field="image" label="Image" conf={conf} src={src} />
            <Evidence field="ticket_url" label="Tickets" conf={conf} src={src} />
            <Evidence field="price" label="Price" conf={conf} src={src} />
          </div>
        )}
        {warnings.length > 0 && (
          <div className="warnList">
            {warnings.slice(0, 5).map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="confidencePill">
            {event.confidence_score != null
              ? `Confidence ${Number(event.confidence_score).toFixed(0)}%`
              : 'Confidence —'}
          </span>
          {event.ai_used != null && (
            <span className="confidencePill">{event.structured_data_found ? 'Structured data' : 'No structured data'}{event.ai_used ? ' + AI' : ''}</span>
          )}
          {event.featured && <span className="confidencePill" style={{ color: 'var(--accent-ink, var(--accent))' }}>Featured</span>}
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
        {event.possible_duplicate_of && event.status !== 'live' && event.status !== 'rejected' && (
          <button
            className="btnGhost"
            onClick={() => call('link', `/api/admin/events/${event.id}/link-source`, undefined)}
            disabled={!!busy}
            title="Attach this URL as a source of the existing event and drop this draft"
            type="button"
          >
            {busy === 'link' ? '…' : 'Link source'}
          </button>
        )}
        {event.source_url && event.status !== 'live' && (
          <button
            className="btnGhost"
            onClick={() => call('reprocess', `/api/admin/events/${event.id}/reprocess`, undefined)}
            disabled={!!busy}
            type="button"
          >
            {busy === 'reprocess' ? '…' : 'Reprocess'}
          </button>
        )}
        {event.source_url && (
          <a className="btnGhost" style={{ textAlign: 'center' }} href={event.source_url} target="_blank" rel="noopener noreferrer">
            View source
          </a>
        )}
        <Link className="btnGhost" style={{ textAlign: 'center' }} href={`/events/${event.slug}`}>
          Preview
        </Link>
        {/* Permanent — two clicks required, never a browser popup. */}
        <button
          className="btnGhost"
          style={{ color: 'var(--danger)', borderColor: confirmDelete ? 'var(--danger)' : undefined }}
          disabled={!!busy}
          type="button"
          onClick={() => {
            if (!confirmDelete) { setConfirmDelete(true); return; }
            call('delete', `/api/admin/events/${event.id}`, undefined, 'DELETE');
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {busy === 'delete' ? '…' : confirmDelete ? 'Really delete?' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
