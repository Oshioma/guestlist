import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getEventBySlug, getMemberAction } from '@/lib/events';
import { eventTypeLabel, fmtEventDate, fmtEventTime, formatPrice, isPast } from '@/lib/util';
import { SocialPanel } from '@/components/SocialPanel';
import { TrackView } from '@/components/TrackView';
import { ShareButton } from '@/components/ShareButton';
import { FollowButton } from '@/components/FollowButton';
import { ClaimEventPrompt } from '@/components/ClaimEventPrompt';
import { isFollowing } from '@/lib/profiles';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { queryOne } from '@/lib/db';
import { CLUB_LIMITS, PRESENCE_ACTIVE_SQL, presenceVisibleSql } from '@/lib/clubmessenger';

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

  const followingPromoter = event.promoter
    ? await isFollowing(member?.id, 'promoter', event.promoter.id)
    : false;
  const promoterSlug = event.promoter
    ? (await queryOne<{ slug: string }>(`select slug from promoters where id = $1`, [event.promoter.id]))?.slug
    : null;
  // "Is this your event?" — offered to verified promoter team members on
  // events with no promoter attached.
  const claimablePromoters =
    member && !event.promoter
      ? (await getMemberPromoters(member.id)).filter((p) => p.claim_status === 'verified')
      : [];

  // Club Messenger module: only around event time. Counts respect the same
  // presence-visibility rules as everywhere else (viewer-scoped).
  const nowMs = Date.now();
  const startMs = new Date(event.start_at).getTime();
  const endMs = event.end_at
    ? new Date(event.end_at).getTime()
    : startMs + 6 * 3600_000;
  const tonight =
    event.status === 'live' &&
    event.listing_status !== 'cancelled' &&
    startMs < nowMs + 24 * 3600_000 &&
    endMs + CLUB_LIMITS.presenceGraceHours * 3600_000 > nowMs;
  // Signed-out viewers see no presence numbers at all.
  const liveStats =
    tonight && member
      ? await queryOne<{ visible_here: number; friends_here: number }>(
          `select
             count(*)::int as visible_here,
             count(*) filter (where exists (
               select 1 from member_follows f1
                join member_follows f2 on f2.member_id = f1.entity_id
                 and f2.entity_type = 'member' and f2.entity_id = f1.member_id
               where f1.member_id = $1 and f1.entity_type = 'member' and f1.entity_id = p.member_id
             ))::int as friends_here
           from event_presence p
          where p.event_id = $2 and ${PRESENCE_ACTIVE_SQL('p')}
            and p.visibility <> 'invisible' and ${presenceVisibleSql('$1', 'p')}`,
          [member.id, event.id]
        )
      : null;

  const cancelled = event.listing_status === 'cancelled';
  const listingBadge =
    event.listing_status !== 'confirmed' ? event.listing_status : null;

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
          {listingBadge && (
            <div style={{ marginBottom: 12 }}>
              <span className={`listingBadge ${listingBadge}`}>{listingBadge.replace('_', ' ')}</span>
            </div>
          )}
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

      {cancelled && (
        <div className="cancelBanner">
          CANCELLED — this event is no longer going ahead.
        </div>
      )}

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
                    <Link href={`/artists/${a.slug}`}>{a.name}</Link>
                    {a.billing && <span className="billing">{a.billing.replace('_', ' ')}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {event.promoter && (
            <>
              <div className="sectionLabel">Organiser</div>
              <div className="organiserCard">
                {event.promoter.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="logo" src={event.promoter.image_url} alt=""
                       style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover' }} />
                ) : (
                  <div className="logo" style={{
                    width: 52, height: 52, borderRadius: 14, background: 'var(--surface-hover)',
                    border: '1px solid var(--border)', display: 'grid', placeItems: 'center',
                    fontWeight: 750, fontSize: 19, color: 'var(--text-muted)', flexShrink: 0,
                  }}>{event.promoter.name[0]}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="big" style={{ fontSize: 17, fontWeight: 700 }}>
                    {event.promoter.name}{' '}
                    {event.promoter.verified && <span className="verifiedMark" title="Verified promoter">✓</span>}
                  </div>
                  {event.promoter.verified && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Verified promoter</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {promoterSlug && (
                    <Link className="btnGhost" style={{ padding: '7px 13px', fontSize: 11 }} href={`/promoters/${promoterSlug}`}>
                      View promoter
                    </Link>
                  )}
                  <FollowButton
                    entityType="promoter"
                    entityId={event.promoter.id}
                    initialFollowing={followingPromoter}
                    isSignedIn={!!member}
                    compact
                  />
                </div>
              </div>
            </>
          )}

          {claimablePromoters.length > 0 && !past && (
            <ClaimEventPrompt eventId={event.id} promoters={claimablePromoters} />
          )}
        </div>

        <aside>
          <div className="sideCard">
            <div className="big">{fmtEventDate(event.start_at, event.end_at, event.timezone)}</div>
            <div className="muted">{fmtEventTime(event.start_at, event.end_at, event.timezone)} · {event.timezone}</div>
            {event.venue && (
              <>
                <hr />
                <div className="big">
                  <Link href={`/venues/${event.venue.slug}`} style={{ textDecoration: 'underline', textDecorationColor: 'var(--border-strong)' }}>
                    {event.venue.name}
                  </Link>
                </div>
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
            {event.ticket_url && !past && !cancelled && event.listing_status !== 'sold_out' && (
              <a className="ctaTickets" href={`/out/${event.id}`}>
                Get Tickets →
              </a>
            )}
            {event.listing_status === 'sold_out' && !past && (
              <div className="listingBadge sold_out" style={{ marginTop: 12, textAlign: 'center', display: 'block' }}>
                Sold out
              </div>
            )}
            {cancelled && <div className="muted" style={{ marginTop: 10 }}>Tickets are no longer available.</div>}
            {past && <div className="muted" style={{ marginTop: 10 }}>This event has already happened.</div>}
          </div>

          {tonight && (
            <Link href={`/clubmessenger/events/${event.id}`} className="tonightModule">
              <div className="tonightModuleTitle">⚡ Tonight on Guestlist</div>
              <div className="tonightModuleBody">
                {liveStats && liveStats.friends_here > 0
                  ? `${liveStats.friends_here} friend${liveStats.friends_here === 1 ? '' : 's'} here now`
                  : liveStats && liveStats.visible_here > 0
                    ? `${liveStats.visible_here} here now`
                    : 'Live room is open'}
                {' · '}see who’s out, check in when you arrive →
              </div>
            </Link>
          )}

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
