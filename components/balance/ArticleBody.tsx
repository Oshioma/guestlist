// An article body as readers see it: paragraphs, pictures and YouTube videos.
// No hooks, so the article page renders it on the server and the editor's
// preview renders exactly the same thing in the browser.

import { parseBody } from '@/lib/articleBody';

// The same player for a video in the body and a video used as the hero.
// youtube-nocookie: no tracking cookies until somebody presses play.
export function YouTubePlayer({ id, start = 0, className = 'articleVideo' }: { id: string; start?: number; className?: string }) {
  return (
    <figure className={className}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </figure>
  );
}

// skipVideoId: the video already playing as the hero isn't shown twice.
export function ArticleBody({ body, className, skipVideoId }: { body: string; className?: string; skipVideoId?: string }) {
  return (
    <div className={className}>
      {parseBody(body).map((b, i) => {
        if (b.kind === 'image') {
          return (
            <figure key={i} className="articleFigure">
              <img src={b.url} alt={b.caption} loading="lazy" />
              {b.caption && <figcaption>{b.caption}</figcaption>}
            </figure>
          );
        }
        if (b.kind === 'youtube') {
          if (b.id === skipVideoId) return null;
          return <YouTubePlayer key={i} id={b.id} start={b.start} />;
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
