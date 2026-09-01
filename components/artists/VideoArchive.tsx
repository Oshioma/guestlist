import { EventImage } from '@/components/EventImage';
import Link from 'next/link';
import type { ArtistVideo } from '@/lib/videoArchive';
import { youtubeTimestampUrl } from '@/lib/videoArchive';

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoArchive({ videos }: { videos: ArtistVideo[] }) {
  if (!videos.length) return null;
  return (
    <section style={{ marginTop: 42 }}>
      <div className="sectionLabel">In their words — Guestlist interviews</div>
      <div className="cardGrid">
        {videos.map((video) => (
          <article key={video.id} className="card" style={{ overflow: 'hidden' }}>
            <a href={video.source_url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
              {video.thumbnail_url && <EventImage src={video.thumbnail_url} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} />}
            </a>
            <div style={{ padding: 16 }}>
              <div className="adminSub" style={{ marginBottom: 6 }}>GUESTLIST INTERVIEW</div>
              <h3 style={{ margin: 0 }}>{video.title}</h3>
              {video.moments.length > 0 && (
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  {video.moments.slice(0, 6).map((m) => (
                    <a key={m.id} href={youtubeTimestampUrl(video.youtube_video_id, m.start_seconds)} target="_blank" rel="noreferrer" className="tag" style={{ display: 'block' }}>
                      <b>{clock(m.start_seconds)}</b> — {m.title}
                    </a>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 14 }}><Link href={`/clips?video=${video.id}`}>Explore interview →</Link></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
