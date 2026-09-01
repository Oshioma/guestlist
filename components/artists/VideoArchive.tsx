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

      <div style={{ display: 'grid', gap: 28 }}>
        {videos.map((video) => (
          <article key={video.id} className="card" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 34%) minmax(0, 1fr)', gap: 0 }}>
              <a href={video.source_url} target="_blank" rel="noreferrer" style={{ display: 'block', minHeight: 220 }}>
                {video.thumbnail_url && (
                  <EventImage
                    src={video.thumbnail_url}
                    style={{ width: '100%', height: '100%', minHeight: 220, objectFit: 'cover', display: 'block' }}
                  />
                )}
              </a>

              <div style={{ padding: 22 }}>
                <div className="adminSub" style={{ marginBottom: 6 }}>GUESTLIST INTERVIEW</div>
                <h3 style={{ margin: 0, fontSize: 24, lineHeight: 1.15 }}>{video.title}</h3>
                <div className="adminSub" style={{ marginTop: 8 }}>
                  {video.moments.length} published clip{video.moments.length === 1 ? '' : 's'}
                </div>
                <div style={{ marginTop: 16 }}>
                  <Link href={`/clips?video=${video.id}`}>Explore full interview →</Link>
                </div>
              </div>
            </div>

            {video.moments.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: 18 }}>
                <div className="sectionLabel" style={{ marginBottom: 12 }}>Published clips</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                  {video.moments.map((m) => {
                    const href = youtubeTimestampUrl(video.youtube_video_id, m.start_seconds);
                    return (
                      <article key={m.id} className="card" style={{ overflow: 'hidden', padding: 0 }}>
                        <a href={href} target="_blank" rel="noreferrer" style={{ display: 'block', position: 'relative' }}>
                          {video.thumbnail_url && (
                            <EventImage
                              src={video.thumbnail_url}
                              style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                            />
                          )}
                          <span style={{
                            position: 'absolute', right: 10, bottom: 10,
                            background: 'rgba(0,0,0,.82)', color: '#fff',
                            padding: '4px 7px', borderRadius: 6,
                            fontSize: 12, fontWeight: 800, letterSpacing: '.02em'
                          }}>
                            {clock(m.start_seconds)}
                          </span>
                        </a>
                        <div style={{ padding: 14 }}>
                          <h4 style={{ margin: 0, fontSize: 17, lineHeight: 1.25 }}>{m.title}</h4>
                          {m.topic_label && (
                            <div className="adminSub" style={{ marginTop: 6 }}>{m.topic_label}</div>
                          )}
                          {m.summary && (
                            <p style={{ margin: '10px 0 0', lineHeight: 1.45 }}>{m.summary}</p>
                          )}
                          <div style={{ marginTop: 12 }}>
                            <a href={href} target="_blank" rel="noreferrer">Play clip →</a>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
