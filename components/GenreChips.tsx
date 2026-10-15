'use client';

// THE GENRE CHIPS ON /events.
//
// A chip used to be a plain link, and only lit up once the server had sent
// back the whole new page. On a slow connection a tap looked like it had done
// nothing — so people tapped again, and the second tap switched the genre
// back off. And because each link was worked out from the page as it was
// last rendered, two quick taps (Garage, then Techno) could lose the first.
//
// So the chips keep their own selection: a tap lights up at once, the next
// tap builds on what is lit (not on the last page), and the list catches up
// behind it. They are still real links, so opening one in a new tab, or
// using the page without JavaScript, works as before.

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { genresParam, toggleGenre } from '@/lib/genreFilter';

type Genre = { slug: string; name: string };

export function GenreChips({
  genres, selected, moreHref,
}: {
  genres: Genre[];
  selected: string[];
  moreHref: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [chosen, setChosen] = useState<string[]>(selected);
  const [pending, startTransition] = useTransition();

  // When the page itself changes (back button, a link elsewhere, the filter
  // select), take its selection as the truth again.
  const selectedKey = selected.join(',');
  useEffect(() => { setChosen(selected); }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hrefFor = (next: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    const value = genresParam(next);
    if (value) params.set('genre', value);
    else params.delete('genre');
    const s = params.toString();
    return s ? `/events?${s}` : '/events';
  };

  const choose = (e: React.MouseEvent<HTMLAnchorElement>, next: string[]) => {
    // A new tab, or a modified click, is the browser's business.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setChosen(next);
    startTransition(() => router.push(hrefFor(next), { scroll: false }));
  };

  return (
    <div className="chipRow" aria-label="Genres" aria-busy={pending}>
      <Link
        href={hrefFor([])}
        className={`chip${chosen.length === 0 ? ' active' : ''}`}
        onClick={(e) => choose(e, [])}
      >
        All
      </Link>
      {genres.map((g) => {
        const on = chosen.includes(g.slug);
        const next = toggleGenre(chosen, g.slug);
        return (
          <Link
            key={g.slug}
            href={hrefFor(next)}
            className={`chip${on ? ' active' : ''}`}
            aria-pressed={on}
            onClick={(e) => choose(e, next)}
          >
            {g.name}
          </Link>
        );
      })}
      {moreHref && (
        <Link href={moreHref} className="chip" scroll={false}>
          More +
        </Link>
      )}
    </div>
  );
}
