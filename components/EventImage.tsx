'use client';

// Images come from other people's websites, so some of them will be dead by
// the time anyone looks. A broken-image icon is never an acceptable thing to
// show: when the file fails to load we fall back to the genre art if we know
// the genre, and to a plain placeholder if we don't.

import { useCallback, useState } from 'react';
import { GenreArt } from '@/components/GenreArt';

export function EventImage({
  src, alt = '', className, style, loading = 'lazy', genres = [], label, compactArt = false,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  genres?: string[];
  label?: string | null;
  compactArt?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  // An image that 404s during server-rendered HTML has already failed by the
  // time React hydrates, so onError never fires for it. Checking naturalWidth
  // on mount catches exactly those.
  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setBroken(true);
  }, []);

  if (!src || broken) {
    return (
      <span className={className} style={{ display: 'block', ...style }}>
        {genres.length > 0 || label
          ? <GenreArt genres={genres} label={label} compact={compactArt} />
          : <span className="imgFallback" />}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      className={className}
      style={style}
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setBroken(true)}
    />
  );
}
