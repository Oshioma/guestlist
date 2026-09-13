'use client';

// THE WRITING, IN THE SPACE BESIDE THE PROMISE.
//
// The signed-in front door put a 30ch sentence on the left and left the whole
// right-hand column empty. This fills it with one piece at a time — a picture
// big enough to be worth looking at, and the next one a swipe away.
//
// One at a time rather than a shelf, because this column is narrow and three
// half-cards in it would be a list of thumbnails. Balance leads: somebody who
// has just been told we can get them into any event is the right person to
// show the other half of the site to.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/articles';

export function ReadsCarousel({ articles }: { articles: Article[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

  // Which card is in view, worked out from the scroll position rather than
  // tracked on click — so dragging, a trackpad flick and the dots all agree.
  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    if (!card) return;
    const step = card.offsetWidth + 16;
    setAt(Math.max(0, Math.min(articles.length - 1, Math.round(el.scrollLeft / step))));
  }, [articles.length]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const go = (i: number) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    el.scrollTo({ left: i * (card.offsetWidth + 16), behavior: 'smooth' });
  };

  if (!articles.length) return null;

  return (
    <div className="readsCar">
      <div className="readsCarTrack" ref={track}>
        {articles.map((a) => (
          <Link href={`/balance/${a.slug}`} className="readsCarCard" key={a.id}>
            {a.hero_image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="readsCarImg" src={a.hero_image_url} alt={a.hero_image_alt ?? ''} loading="lazy" />
              : <span className="readsCarImg" aria-hidden="true" />}
            <div className="readsCarKicker">
              {a.section_slug === 'events' ? 'The night, written up' : a.section_name}
            </div>
            <h3 className="readsCarTitle">{a.title}</h3>
            {(a.excerpt || a.subtitle) && <p className="readsCarExcerpt">{a.excerpt || a.subtitle}</p>}
            <div className="readsCarMeta">{`${a.author_name} · ${a.reading_minutes} min read`}</div>
          </Link>
        ))}
      </div>
      {articles.length > 1 && (
        <div className="readsCarDots">
          {articles.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={`readsCarDot${i === at ? ' on' : ''}`}
              aria-label={`Show “${a.title}”`}
              aria-current={i === at || undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
