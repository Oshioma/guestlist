// Public venue profile: useful, not overbuilt.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getVenueBySlug, isFollowing } from '@/lib/profiles';
import { eventsForEntity } from '@/lib/events';
import { EventCard } from '@/components/EventCard';
import { FollowButton } from '@/components/FollowButton';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [venue, member] = await Promise.all([getVenueBySlug(slug), getCurrentMember()]);
  if (!venue) notFound();

  const [upcoming, past, following, savedIds] = await Promise.all([
    eventsForEntity({ venueId: venue.id }, 'upcoming'),
    eventsForEntity({ venueId: venue.id }, 'past', 8),
    isFollowing(member?.id, 'venue', venue.id),
    member
      ? query<{ event_id: string }>(
          `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
          [member.id]
        ).then((r) => new Set(r.map((x) => x.event_id)))
      : Promise.resolve(new Set<string>()),
  ]);

  const location = [venue.address, venue.city, venue.country].filter(Boolean).join(', ');
  const mapsUrl =
    venue.latitude != null && venue.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${venue.latitude}&mlon=${venue.longitude}#map=15/${venue.latitude}/${venue.longitude}`
      : null;
  const heroImage =
    venue.hero_image_url ?? upcoming.find((e) => e.primary_image_url)?.primary_image_url ?? null;

  return (
    <main className="wrap">
      <section className="profileHero">
        {heroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bg" src={heroImage} alt="" />
        )}
        <div className="profileHeroInner">
          <h1 className="profileName">{venue.name}</h1>
          <div className="profileFacts">
            {location && <span>{location}</span>}
            <span><b>{venue.event_count}</b> event{venue.event_count === 1 ? '' : 's'}</span>
            <span><b>{venue.follower_count}</b> follower{venue.follower_count === 1 ? '' : 's'}</span>
            {venue.website && (
              <a href={venue.website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                Website ↗
              </a>
            )}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                Map ↗
              </a>
            )}
          </div>
          {venue.common_genres.length > 0 && (
            <div className="tagRow" style={{ marginTop: 14 }}>
              {venue.common_genres.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>
              ))}
            </div>
          )}
          <div className="profileActions">
            <FollowButton
              entityType="venue"
              entityId={venue.id}
              initialFollowing={following}
              isSignedIn={!!member}
            />
          </div>
        </div>
      </section>

      {venue.description && (
        <>
          <div className="sectionLabel" style={{ marginTop: 34 }}>About</div>
          <p className="prose">{venue.description}</p>
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 34 }}>Upcoming</div>
      {upcoming.length ? (
        <div className="cardGrid" style={{ paddingBottom: 30 }}>
          {upcoming.map((e) => (
            <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
          ))}
        </div>
      ) : (
        <p className="adminSub">Nothing listed right now — follow to hear when something lands here.</p>
      )}

      {past.length > 0 && (
        <>
          <div className="sectionLabel">Past events</div>
          <div className="cardGrid">
            {past.map((e) => (
              <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
