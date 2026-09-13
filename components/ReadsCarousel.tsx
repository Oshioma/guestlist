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

// Long enough to read a title and the first line of the excerpt. Faster than
// this and it is a slideshow nobody can use; slower and it never moves while
// anybody is looking at it.
const EVERY = 7000;

export function ReadsCarousel({ articles }: { articles: Article[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // Once somebody has touched it, it is theirs. Moving the card out from
  // under a person who just chose it is the thing that makes carousels hated,
  // so this never restarts — not on mouse-out, not after a delay.
  const [stopped, setStopped] = useState(false);

  // Which card is in view, worked out from the scroll position rather than
  // tracked on click — so dragging, a trackpad flick and the dots all agree.
  const onScroll = useCallback(() => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const step = card.offsetWidth + 16;
    setAt(Math.max(0, Math.min(articles.length - 1, Math.round(el.scrollLeft / step))));
  }, [articles.length]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  const go = useCallback((i: number, smooth = true) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    el.scrollTo({ left: i * (card.offsetWidth + 16), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Any deliberate move — a swipe, a wheel, an arrow key, a dot — hands it
  // over for good. Listened for directly rather than inferred from the scroll
  // event, which also fires for our own scrolling and cannot tell the two
  // apart.
  useEffect(() => {
    const el = track.current;
    if (!el || stopped) return;
    const mine = () => setStopped(true);
    for (const e of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) {
      el.addEventListener(e, mine, { passive: true });
    }
    return () => {
      for (const e of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) {
        el.removeEventListener(e, mine);
      }
    };
  }, [stopped]);

  useEffect(() => {
    if (stopped || articles.length < 2) return;
    // Somebody who has asked their system for less movement gets none. This is
    // the whole of the accessibility argument against carousels, and honouring
    // the setting is the cheapest possible way to answer it.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (still.matches) return;

    const el = track.current;
    if (!el) return;

    // Three ways it should not be advancing: the pointer is on it (somebody is
    // reading), the tab is in the background (nobody is), or it has scrolled
    // out of view (moving it would only mean a jump when they come back).
    let hovered = false;
    let onScreen = true;
    const enter = () => { hovered = true; };
    const leave = () => { hovered = false; };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focusin', enter);
    el.addEventListener('focusout', leave);

    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { threshold: 0.5 });
    io.observe(el);

    const timer = window.setInterval(() => {
      if (hovered || onScreen === false || document.hidden) return;
      setAt((i) => {
        const next = (i + 1) % articles.length;
        // Wrapping back to the first card: jump rather than sliding the whole
        // way back past everything, which reads as a mistake.
        go(next, next !== 0);
        return next;
      });
    }, EVERY);

    return () => {
      window.clearInterval(timer);
      io.disconnect();
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      el.removeEventListener('focusin', enter);
      el.removeEventListener('focusout', leave);
    };
  }, [stopped, articles.length, go]);

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
              onClick={() => { setStopped(true); go(i); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
