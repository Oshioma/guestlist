// TWO PIECES AT THE TOP OF THE HOME PAGE.
//
// One night written about, one from Balance. Guestlist publishes editorial
// and buried all of it below the event grid, which meant the writing existed
// and nobody arriving ever saw it.
//
// One of each, deliberately. Two nights back to back would read as a list;
// a night and a piece about not going out is the range the site actually has.
// Featured first, newest otherwise — listPublishedArticles already orders
// that way, so the editor's Feature button decides what sits here.

import Link from 'next/link';
import type { Article } from '@/lib/articles';

// /balance/<slug> is the reading route for both sections; the section only
// changes what it is called on the card.
function href(a: Article) { return `/balance/${a.slug}`; }

function Read({ a, kicker }: { a: Article; kicker: string }) {
  return (
    <Link href={href(a)} className="homeRead">
      <div>
        <div className="homeReadKicker">{kicker}</div>
        <h3 className="homeReadTitle">{a.title}</h3>
        {(a.excerpt || a.subtitle) && <p className="homeReadExcerpt">{a.excerpt || a.subtitle}</p>}
        <div className="homeReadMeta">
          {`${a.author_name} · ${a.reading_minutes} min read`}
        </div>
      </div>
      {/* Hero images are required and checked before publishing (lib/articles),
          so this is present in practice — the guard is for the day it is not,
          because half a card is better than a broken picture icon. */}
      {a.hero_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="homeReadImg" src={a.hero_image_url} alt={a.hero_image_alt ?? ''} loading="lazy" />
      )}
    </Link>
  );
}

export function HomeReads({ feature, balance }: { feature: Article | null; balance: Article | null }) {
  if (!feature && !balance) return null;
  return (
    <div className="homeReads">
      {feature && <Read a={feature} kicker="The night, written up" />}
      {balance && <Read a={balance} kicker="Balance" />}
    </div>
  );
}
