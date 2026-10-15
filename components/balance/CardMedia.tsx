'use client';

// The picture at the top of an article card — or, when the writer chose a
// video as the hero, that video's still with a play button. Pressing play
// starts the video right there in the card instead of opening the article;
// anywhere else on the card still opens it.
//
// The card is a link, so play is a span with a button role rather than a
// <button>: a button inside an <a> is invalid HTML, and the click has to be
// stopped before the link sees it either way.

import { useState } from 'react';
import { heroVideo } from '@/lib/articleBody';

type CardArticle = {
  title: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  image_provider: string | null;
  image_source_url: string | null;
};

export function CardMedia({ a, className, emptyClassName }: { a: CardArticle; className: string; emptyClassName?: string }) {
  const video = heroVideo(a);
  const [playing, setPlaying] = useState(false);

  if (!a.hero_image_url) return <span className={emptyClassName ?? className} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  if (!video) return <img className={className} src={a.hero_image_url} alt={a.hero_image_alt ?? ''} loading="lazy" />;

  if (playing) {
    return (
      <iframe
        className={`${className} cardVideoFrame`}
        src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1${video.start ? `&start=${video.start}` : ''}`}
        title={`Video: ${a.title}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }

  const play = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(true);
  };

  return (
    <span className="cardVideo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={className} src={a.hero_image_url} alt={a.hero_image_alt ?? ''} loading="lazy" />
      <span
        role="button"
        tabIndex={0}
        className="cardVideoPlay"
        aria-label={`Play the video: ${a.title}`}
        onClick={play}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(e); }}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      </span>
    </span>
  );
}
