// THE WRITING, AT THE TOP OF THE HOME PAGE.
//
// Guestlist publishes editorial and buried all of it below the event grid, so
// the writing existed and almost nobody arriving ever saw it.
//
// A shelf that scrolls sideways rather than a row of two, because two is all
// the room a grid had and there is more than two. The picture leads at a size
// worth looking at: a photograph small enough to sit beside a paragraph is
// decoration, and decoration is what nobody clicks.
//
// The order is deliberate. A night written up comes first, then a piece from
// Balance, then everything else newest first — so the top of the shelf always
// shows the range the site has rather than whichever section happened to
// publish most recently. Featured pieces lead within their own section,
// because listPublishedArticles orders that way and the Feature button on the
// desk should mean something.

import Link from 'next/link';
import type { Article } from '@/lib/articles';

function Read({ a }: { a: Article }) {
  return (
    <Link href={`/balance/${a.slug}`} className="homeRead">
      {a.hero_image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className="homeReadImg" src={a.hero_image_url} alt={a.hero_image_alt ?? ''} loading="lazy" />
        // Hero images are required and checked before publishing, so this is
        // for the day that changes: an empty frame keeps the shelf even, where
        // a missing one would leave a caption floating on its own.
        : <span className="homeReadNoImg" aria-hidden="true" />}
      <div className="homeReadKicker">{a.section_slug === 'events' ? 'The night, written up' : a.section_name}</div>
      <h3 className="homeReadTitle">{a.title}</h3>
      {(a.excerpt || a.subtitle) && <p className="homeReadExcerpt">{a.excerpt || a.subtitle}</p>}
      <div className="homeReadMeta">{`${a.author_name} · ${a.reading_minutes} min read`}</div>
    </Link>
  );
}

export function HomeReads({ features, balance }: { features: Article[]; balance: Article[] }) {
  // One of each at the front, then the rest by how recently they went out.
  const lead = [features[0], balance[0]].filter(Boolean) as Article[];
  const leadIds = new Set(lead.map((a) => a.id));
  // published_at is typed as a string and arrives from pg as a Date, so it is
  // put through Date() rather than compared as text — string methods on it
  // throw at runtime, which the types happily hide.
  const when = (a: Article) => (a.published_at ? new Date(a.published_at).getTime() : 0);
  const rest = [...features, ...balance]
    .filter((a) => !leadIds.has(a.id))
    .sort((x, y) => when(y) - when(x));
  const all = [...lead, ...rest];
  if (!all.length) return null;

  return (
    <>
      <div className="homeReadsHead">
        <h2 className="homeSectionTitle">Worth reading</h2>
        <Link href="/balance" className="btnGhost">All writing</Link>
      </div>
      <div className="homeReads">
        {all.map((a) => <Read a={a} key={a.id} />)}
      </div>
    </>
  );
}
