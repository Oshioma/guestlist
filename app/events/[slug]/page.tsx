import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getEventBySlug, getMemberAction } from '@/lib/events';
import { eventTypeLabel, fmtEventDate, fmtEventTime, formatPrice, isPast } from '@/lib/util';
import { SocialPanel } from '@/components/SocialPanel';
import { TrackView } from '@/components/TrackView';
import { ShareButton } from '@/components/ShareButton';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await getCurrentMember();
  // Admins can preview unpublished events at their canonical URL.
  const event = await getEventBySlug(slug, member?.role === 'admin');
  if (!event) notFound();

  const action = member
    ? await getMemberAction(member.id, event.id)
    : { saved: false, rsvp: null as null };

  const price = formatPrice(event.price_from, event.price_to, event.currency);
  const past = isPast(event);
  const location = [event.city, event.country].filter(Boolean).join(', ');
  const mapsUrl =
    event.latitude != null && event.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=15/${event.latitude}/${event.longitude}`
      : null;

  return (
    <main className="wrap">
      <TrackView eventId={event.id} />

      <section className="detailHero">
        {event.primary_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bg" src={event.primary_image_url} alt="" />
        )}
        <div className="detailHeroInner">
          <div className="detailKicker">
            {eventTypeLabel(event.event_type)}
            {past && ' · Past event'}
            {event.status !== 'live' && ` · ${event.status.replace('_', ' ')} (admin preview)`}
          </div>
          <h1 className="detailTitle">{event.title}</h1>
          <div className="detailMetaRow">
            <span><strong>{fmtEventDate(event.start_at, event.end_at, event.timezone)}</strong></span>
            <span>{fmtEventTime(event.start_at, event.end_at, event.timezone)}</span>
            {event.venue && <span>{event.venue.name}</span>}
            {location && <span>{location}</span>}
          </div>
          {event.genres.length > 0 && (
            <div className="tagRow" style={{ marginTop: 16 }}>
              {event.genres.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">
                  {g.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="detailColumns">
        <div>
          {event.short_description && (
            <p className="prose" style={{ fontSize: 18, color: 'var(--text)' }}>
              {event.short_description}
            </p>
          )}
          {event.description && (
            <>
              <div className="sectionLabel">About</div>
              <p className="prose">{event.description}</p>
            </>
          )}

          {event.lineup.length > 0 && (
            <>
              <div className="sectionLabel">Lineup</div>
              <div className="lineupList">
                {event.lineup.map((a) => (
                  <div className="act" key={a.slug}>
                    <span>{a.name}</span>
                    {a.billing && <span className="billing">{a.billing.replace('_', ' ')}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {event.promoter && (
            <>
              <div className="sectionLabel">Presented by</div>
              <div className="sideCard promoCard">
                {event.promoter.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="logo" src={event.promoter.image_url} alt="" />
                ) : (
                  <div className="logo">{event.promoter.name[0]}</div>
                )}
                <div>
                  <div className="big">
                    {event.promoter.name}{' '}
                    {event.promoter.verified && <span className="verifiedMark" title="Verified promoter">✓</span>}
                  </div>
                  {event.promoter.description && (
                    <div className="muted">{event.promoter.description}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <aside>
          <div className="sideCard">
            <div className="big">{fmtEventDate(event.start_at, event.end_at, event.timezone)}</div>
            <div className="muted">{fmtEventTime(event.start_at, event.end_at, event.timezone)} · {event.timezone}</div>
            {event.venue && (
              <>
                <hr />
                <div className="big">{event.venue.name}</div>
                <div className="muted">
                  {[event.venue.address, event.venue.city, event.venue.country].filter(Boolean).join(', ')}
                </div>
              </>
            )}
            {mapsUrl && (
              <a className="mapLink" href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 14 }}>
                View on map ↗
                <div className="coords">
                  {Number(event.latitude).toFixed(4)}, {Number(event.longitude).toFixed(4)}
                </div>
              </a>
            )}
            <hr />
            <div className="muted">{price ?? 'Price to be announced'}</div>
            {event.ticket_url && !past && (
              <a className="ctaTickets" href={`/out/${event.id}`}>
                Get Tickets →
              </a>
            )}
            {past && <div className="muted" style={{ marginTop: 10 }}>This event has already happened.</div>}
          </div>

          <SocialPanel
            eventId={event.id}
            isSignedIn={!!member}
            initial={action}
            goingCount={event.going_count}
            interestedCount={event.interested_count}
            avatars={event.going_avatars}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <ShareButton eventId={event.id} title={event.title} />
          </div>
        </aside>
      </div>
    </main>
  );
}
