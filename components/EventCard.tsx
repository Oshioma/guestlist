import Link from 'next/link';
import type { EventCard as EventCardData } from '@/lib/events';
import { eventTypeLabel, fmtDate, fmtEventTime, formatPrice } from '@/lib/util';
import { SaveButton } from './SaveButton';

export function EventCard({
  event,
  saved,
  isSignedIn,
}: {
  event: EventCardData;
  saved: boolean;
  isSignedIn: boolean;
}) {
  const day = fmtDate(event.start_at, event.timezone, { day: 'numeric' });
  const month = fmtDate(event.start_at, event.timezone, { month: 'short' });
  const price = formatPrice(event.price_from, event.price_to, event.currency);
  const genres = event.genres.slice(0, 3);
  const location = [event.city, event.venue_name].filter(Boolean).join(' · ');

  return (
    <article className="eventCard">
      <div className="media">
        {event.primary_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.primary_image_url} alt={event.title} loading="lazy" />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#141414,#1e1a10)' }} />
        )}
        <div className="dateBadge">
          <div className="d">{day}</div>
          <div className="m">{month}</div>
        </div>
        {event.featured && <div className="featuredBadge">Featured</div>}
      </div>
      <SaveButton eventId={event.id} initialSaved={saved} isSignedIn={isSignedIn} />
      <Link href={`/events/${event.slug}`} className="cardOverlayLink" aria-label={event.title} />
      <div className="body">
        <h3>{event.title}</h3>
        <div className="cardMeta">
          {location && <span className="city">{location}</span>}
          <span>{fmtEventTime(event.start_at, event.end_at, event.timezone)}</span>
        </div>
        <div className="tagRow">
          <span className="tag type">{eventTypeLabel(event.event_type)}</span>
          {genres.map((g) => (
            <span className="tag" key={g.slug}>{g.name}</span>
          ))}
        </div>
        <div className="socialRow">
          {event.going_count > 0 && (
            <>
              <span className="avatarStack">
                {event.going_avatars.slice(0, 4).map((a, i) =>
                  a.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatar_url} alt={a.display_name} key={i} title={a.display_name} />
                  ) : null
                )}
              </span>
              <span>{event.going_count} going</span>
            </>
          )}
          {price && <span className="priceNote">{price}</span>}
        </div>
      </div>
    </article>
  );
}
