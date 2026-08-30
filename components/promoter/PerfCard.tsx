// Event performance card in the promoter dashboard.

import Link from 'next/link';
import type { EventPerformance } from '@/lib/promoterAnalytics';
import { fmtEventDate } from '@/lib/util';
import { LifecycleButtons } from './LifecycleButtons';

export function PerfCard({
  event,
  promoterId,
  showModeration = false,
}: {
  event: EventPerformance;
  promoterId: string;
  showModeration?: boolean;
}) {
  const pending = event.status === 'new' || event.status === 'needs_review';
  const ctr = event.views > 0 ? ((event.ticket_clicks / event.views) * 100).toFixed(1) : null;
  return (
    <div className="perfCard">
      {event.primary_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={event.primary_image_url} alt="" />
      ) : (
        <div className="thumb" />
      )}
      <div>
        <h3>{event.title}</h3>
        <div className="meta">
          {fmtEventDate(event.start_at, event.end_at, event.timezone)}
          {event.venue_name && ` · ${event.venue_name}`}
          {event.city && ` · ${event.city}`}
          {pending && <span style={{ color: 'var(--accent)' }}> · awaiting review</span>}
          {event.possible_duplicate_of && <span style={{ color: 'var(--danger)' }}> · possible duplicate</span>}
          {event.listing_status !== 'confirmed' && (
            <span style={{ color: 'var(--accent)' }}> · {event.listing_status.replace('_', ' ')}</span>
          )}
        </div>
        <div className="nums">
          <span>Views <b>{event.views.toLocaleString()}</b></span>
          <span>Ticket clicks <b>{event.ticket_clicks.toLocaleString()}</b>{ctr && ` (${ctr}%)`}</span>
          <span>Interested <b>{event.interested}</b></span>
          <span>Going <b>{event.going}</b></span>
        </div>
      </div>
      <div className="actions">
        <Link className="btnGhost" style={{ textAlign: 'center', padding: '6px 12px', fontSize: 11 }} href={`/events/${event.slug}`}>
          View
        </Link>
        <Link className="btnGhost" style={{ textAlign: 'center', padding: '6px 12px', fontSize: 11 }} href={`/promoter/events/${event.id}`}>
          Edit
        </Link>
        {showModeration && (
          <LifecycleButtons
            promoterId={promoterId}
            eventId={event.id}
            status={event.status}
            listingStatus={event.listing_status}
            duplicateFlagged={!!event.possible_duplicate_of}
          />
        )}
      </div>
    </div>
  );
}
