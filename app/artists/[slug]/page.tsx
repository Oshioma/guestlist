import { EventImage } from '@/components/EventImage';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getArtistBySlug, isFollowing } from '@/lib/profiles';
import { eventsForEntity } from '@/lib/events';
import { EventCard } from '@/components/EventCard';
import { FollowButton } from '@/components/FollowButton';
import { VideoArchive } from '@/components/artists/VideoArchive';
import { videosForArtist } from '@/lib/videoArchive';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [artist, member] = await Promise.all([getArtistBySlug(slug), getCurrentMember()]);
  if (!artist) notFound();

  const [upcoming, following, savedIds, videos] = await Promise.all([
    eventsForEntity({ artistId: artist.id }, 'upcoming'),
    isFollowing(member?.id, 'artist', artist.id),
    member
      ? query<{ event_id: string }>(
          `select event_id from member_event_actions where member_id = $1 and saved_at is not null`, [member.id]
        ).then((r) => new Set(r.map((x) => x.event_id)))
      : Promise.resolve(new Set<string>()),
    videosForArtist(artist.id),
  ]);

  return (
    <main className="wrap">
      <section className="profileHero" style={{ minHeight: 220 }}>
        {artist.image_url && <EventImage className="bg" src={artist.image_url} />}
        <div className="profileHeroInner">
          <h1 className="profileName">{artist.name}</h1>
          <div className="profileFacts"><span><b>{artist.follower_count}</b> follower{artist.follower_count === 1 ? '' : 's'}</span></div>
          {artist.genres.length > 0 && <div className="tagRow" style={{ marginTop: 14 }}>{artist.genres.map((g) => <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>)}</div>}
          <div className="profileActions"><FollowButton entityType="artist" entityId={artist.id} initialFollowing={following} isSignedIn={!!member} /></div>
        </div>
      </section>

      <VideoArchive videos={videos} legacy={artist.slug === 'dj-cassidy'} />

      <div className="sectionLabel" style={{ marginTop: 42 }}>Playing next</div>
      {upcoming.length ? <div className="cardGrid">{upcoming.map((e) => <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />)}</div>
        : <p className="adminSub" style={{ paddingBottom: 60 }}>No upcoming Guestlist events — follow to hear when they play.</p>}
    </main>
  );
}
