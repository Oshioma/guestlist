// Public promoter profile — an editorial identity page, not a directory
// listing. Claim CTA appears while unclaimed.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getPromoterBySlug, isFollowing } from '@/lib/profiles';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { eventsForEntity } from '@/lib/events';
import { EventCard } from '@/components/EventCard';
import { FollowButton } from '@/components/FollowButton';
import { TrackEntityView } from '@/components/TrackEntityView';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SOCIAL_LABEL: Record<string, string> = {
  instagram: 'Instagram', soundcloud: 'SoundCloud', facebook: 'Facebook',
  mixcloud: 'Mixcloud', bandcamp: 'Bandcamp', x: 'X',
};

export default async function PromoterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [promoter, member] = await Promise.all([getPromoterBySlug(slug), getCurrentMember()]);
  if (!promoter) notFound();

  const [upcoming, past, following, savedIds, promoterships] = await Promise.all([
    eventsForEntity({ promoterId: promoter.id }, 'upcoming'),
    eventsForEntity({ promoterId: promoter.id }, 'past', 8),
    isFollowing(member?.id, 'promoter', promoter.id),
    member
      ? query<{ event_id: string }>(
          `select event_id from member_event_actions where member_id = $1 and saved_at is not null`,
          [member.id]
        ).then((r) => new Set(r.map((x) => x.event_id)))
      : Promise.resolve(new Set<string>()),
    member ? getMemberPromoters(member.id) : Promise.resolve([]),
  ]);

  const managedPromoter = promoterships.find((p) => p.id === promoter.id && p.claim_status === 'verified');
  const manageQuery = managedPromoter ? `?p=${promoter.id}` : '';
  const location = [promoter.city, promoter.country].filter(Boolean).join(', ');
  const socials = Object.entries(promoter.socials ?? {}).filter(([k]) => SOCIAL_LABEL[k]);

  return (
    <main className="wrap">
      <TrackEntityView type="promoter_viewed" ids={{ promoterId: promoter.id }} />

      <section className="profileHero">
        {promoter.hero_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bg" src={promoter.hero_image_url} alt="" />
        )}
        <div className="profileHeroInner">
          {promoter.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="profileLogo" src={promoter.image_url} alt="" />
          ) : (
            <div className="profileLogo">{promoter.name[0]}</div>
          )}
          <h1 className="profileName">
            {promoter.name}
            {promoter.verified && <span className="verifiedBadge">✓ Verified</span>}
          </h1>
          <div className="profileFacts">
            {location && <span>{location}</span>}
            <span><b>{promoter.event_count}</b> event{promoter.event_count === 1 ? '' : 's'}</span>
            <span><b>{promoter.follower_count}</b> follower{promoter.follower_count === 1 ? '' : 's'}</span>
            {promoter.website && (
              <a href={promoter.website} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                {promoter.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗
              </a>
            )}
          </div>
          {promoter.genres.length > 0 && (
            <div className="tagRow" style={{ marginTop: 14 }}>
              {promoter.genres.map((g) => (
                <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>
              ))}
            </div>
          )}
          <div className="profileActions">
            {managedPromoter && (
              <>
                <Link className="btnAccent" href={`/promoter${manageQuery}`}>Manage</Link>
                <Link className="btnGhost" href={`/promoter/guestlists${manageQuery}`}>Guestlists</Link>
              </>
            )}
            <FollowButton
              entityType="promoter"
              entityId={promoter.id}
              initialFollowing={following}
              isSignedIn={!!member}
            />
            {socials.map(([key, url]) => (
              <a key={key} className="btnGhost" href={url} target="_blank" rel="noopener noreferrer">
                {SOCIAL_LABEL[key]}
              </a>
            ))}
          </div>
          {!following && (
            <p className="youHistoryMeta" style={{ marginTop: 8 }}>
              Get important event updates from this promoter — your
              notification settings decide how they reach you.
            </p>
          )}
        </div>
      </section>

      {promoter.claim_status !== 'verified' && promoter.claim_status !== 'suspended' && (
        <div className="claimStrip">
          <span>
            {promoter.claim_status === 'claim_pending'
              ? 'A claim on this profile is being reviewed.'
              : `Run ${promoter.name}?`}
          </span>
          {promoter.claim_status !== 'claim_pending' && (
            <Link href={`/promoters/${promoter.slug}/claim`} className="btnGhost">
              Claim this profile →
            </Link>
          )}
        </div>
      )}

      {promoter.description && (
        <>
          <div className="sectionLabel" style={{ marginTop: 34 }}>About</div>
          <p className="prose">{promoter.description}</p>
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 34 }}>Upcoming</div>
      {upcoming.length ? (
        <div className="cardGrid" style={{ paddingBottom: 30 }}>
          {upcoming.map((e) => (
            <div key={e.id}>
              <EventCard event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
              {managedPromoter && (
                <Link
                  href={`/promoter/guestlists/${e.id}${manageQuery}`}
                  className="btnGhost"
                  style={{ marginTop: 8, display: 'inline-flex' }}
                >
                  Manage guestlist →
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="adminSub">Nothing announced right now — follow to hear first.</p>
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
