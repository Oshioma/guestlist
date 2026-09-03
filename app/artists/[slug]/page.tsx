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

  // A SPARSE ARTIST PAGE SHOULD NOT LOOK LIKE AN EMPTY ONE.
  //
  // Most artists here have one date and a clip or two. Stacked in full-width
  // rows that is a card, a screen of nothing beside it, a scroll, and another
  // card — the page reads as emptier than it is, and you have to scroll to
  // find out there was anything else. Side by side, the same content is one
  // screen and the page looks like it has something on it.
  //
  // Only while both sides are short. Three dates in a half-width column is a
  // tall thin stack, which is a different kind of bad.
  const clipCount = videos.reduce((n, v) => n + v.moments.length, 0);
  const sideBySide = clipCount > 0 && clipCount <= 2 && upcoming.length <= 2;

  return (
    <main className="wrap">
      {/* Without a photograph the hero is a black box, and its height was
          all clearance for a photograph's gradient. Nothing to clear, so
          nothing to clear it by. */}
      <section className={`profileHero${artist.image_url ? '' : ' noArt'}`}
               style={{ minHeight: artist.image_url ? 220 : 0 }}>
        {artist.image_url && <EventImage className="bg" src={artist.image_url} />}
        <div className="profileHeroInner">
          <h1 className="profileName">{artist.name}</h1>
          <div className="profileFacts"><span><b>{artist.follower_count}</b> follower{artist.follower_count === 1 ? '' : 's'}</span></div>
          {artist.genres.length > 0 && <div className="tagRow" style={{ marginTop: 14 }}>{artist.genres.map((g) => <Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>)}</div>}
          <div className="profileActions"><FollowButton entityType="artist" entityId={artist.id} initialFollowing={following} isSignedIn={!!member} /></div>
        </div>
      </section>

      <div className={`artistBody${sideBySide ? ' split' : ''}`}>
        {/* WHERE THEY ARE PLAYING COMES FIRST. Somebody on an artist's page
            most often wants a date, not an archive — the clips are why you
            stay, not why you arrived. First in the markup either way, so it
            is also first on a phone, where the columns become rows. */}
        <section className="artistDates">
          <div className="sectionLabel">Playing next</div>
          {upcoming.length ? <div className="cardGrid">{upcoming.map((e) => <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />)}</div>
            : <p className="adminSub">No upcoming Guestlist events — follow to hear when they play.</p>}
        </section>

        <VideoArchive videos={videos} />
      </div>
    </main>
  );
}
