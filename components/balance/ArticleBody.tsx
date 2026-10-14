// An article body as readers see it: paragraphs, pictures and YouTube videos.
// No hooks, so the article page renders it on the server and the editor's
// preview renders exactly the same thing in the browser.

import { parseBody } from '@/lib/articleBody';

export function ArticleBody({ body, className }: { body: string; className?: string }) {
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
          // youtube-nocookie: no tracking cookies until somebody presses play.
          const src = `https://www.youtube-nocookie.com/embed/${b.id}${b.start ? `?start=${b.start}` : ''}`;
          return (
            <figure key={i} className="articleVideo">
              <iframe
                src={src}
                title="YouTube video"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </figure>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
