// THE CLIPS, AND WHAT EACH ONE IS ABOUT.
//
// This used to lead with the interview: a big thumbnail, its title, a count of
// clips and a link into the full thing — and the clips themselves underneath,
// as a footnote. That is backwards. Nobody arrives wanting a fifty-minute
// video; they want the two minutes where the artist says the interesting
// thing. So the clip IS the unit, each one carrying the sentence that says
// what it is about, and the interview is simply where the clip came from.

import { EventImage } from '@/components/EventImage';
import type { ArtistVideo } from '@/lib/videoArchive';
import { youtubeTimestampUrl } from '@/lib/videoArchive';

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoArchive({ videos }: { videos: ArtistVideo[] }) {
  // One flat run of clips across every interview, newest interview first.
  const clips = videos.flatMap((video) =>
    video.moments.map((m) => ({ video, moment: m }))
  );
  if (!clips.length) return null;

  return (
    <section className="artistClips">
      <div className="sectionLabel">In their words — Guestlist interviews</div>
      <div className="clipGrid">
        {clips.map(({ video, moment }) => {
          const href = youtubeTimestampUrl(video.youtube_video_id, moment.start_seconds);
          return (
            <article className="clipCard" key={moment.id}>
              <a href={href} target="_blank" rel="noopener noreferrer" className="clipArt">
                {video.thumbnail_url && <EventImage src={video.thumbnail_url} />}
                <span className="clipTime">{clock(moment.start_seconds)}</span>
              </a>
              <div className="clipBody">
                <h3 className="clipTitle">{moment.title}</h3>
                {moment.topic_label && <div className="clipTopic">{moment.topic_label}</div>}
                {/* What the clip is about, in words — the reason to press play. */}
                {moment.summary && <p className="clipSummary">{moment.summary}</p>}
                <a href={href} target="_blank" rel="noopener noreferrer" className="clipPlay">Play clip →</a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
