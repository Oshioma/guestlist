// BALANCE DOES NOT ASK YOU TO WRITE.
//
// There were three buttons on the way down this page inviting a reader to
// contribute — one in the hero, one under the articles, one on the home page
// band. A page that asks for something three times before you have finished
// reading it is a page that wants something from you, and Balance is meant to
// be the calm half of the site.
//
// The invitation lives in the footer, on every page, once. Anyone who wants
// to write will find it; nobody has to be asked while they are reading.
//
// EVERYTHING EVER PUBLISHED, NOT THE LATEST THIRTY.
//
// The page used to stop at thirty pieces, so the thirty-first was published
// and then unreachable except by its own link. It now pages, twenty-four at a
// time, and has a search box: ?q= searches every published piece — Balance and
// the Event Features — because somebody looking for "that piece about afters"
// does not know or care which section it went out in.
//
// The search box is a real <form method="get" role="search">. That keeps it a
// plain link-able, back-button-able URL, and it is exactly what FormDrafts
// (CLAUDE.md) skips, so a search is never "kept" as a draft.
import type { Metadata } from 'next';
import { listPublishedPage, pageFromParam } from '@/lib/articles';
import { listLiveRetreats } from '@/lib/retreats';
import { pageMeta } from '@/lib/seo';
import { WRITING_FEED } from '@/lib/rss';
import { RetreatShelf } from '@/components/RetreatShelf';
import { ArticleGrid, Pager, pagedPath } from '@/components/balance/ArticleGrid';
import styles from './balance.module.css';

export const dynamic='force-dynamic';

type Search = Promise<{ q?: string; page?: string }>;
const searchTerm = (q: string | undefined) => (q ?? '').trim().slice(0, 100);

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const sp = await searchParams;
  const q = searchTerm(sp.q);
  const page = pageFromParam(sp.page);
  return pageMeta({
    title: q ? `“${q}” · Balance` : page > 1 ? `Balance · page ${page}` : 'Balance',
    description: 'Ideas, experiences and perspectives from the Guestlist community.',
    path: pagedPath('/balance', page),
    // A results page is a different list for every search; none of them is a
    // page worth indexing, and a crawler following them would never finish.
    noIndex: !!q,
    feed: WRITING_FEED,
  });
}

export default async function BalancePage({ searchParams }: { searchParams: Search }){
  const sp = await searchParams;
  const q = searchTerm(sp.q);
  const page = pageFromParam(sp.page);
  const browsing = !q && page === 1;
  const [list,retreats]=await Promise.all([
    q ? listPublishedPage({ q, page }) : listPublishedPage({ section: 'balance', page }),
    browsing ? listLiveRetreats(12) : Promise.resolve([]),
  ]);
  return <main><section className={styles.hero}><div className="wrap"><div className={styles.topRow}><div><div className={styles.kicker}>Guestlist editorial</div><h1 className={styles.title}>Balance.</h1><p className={styles.lead}>Ideas, experiences and perspectives from the community — the culture around the night, not just the night itself.</p></div></div>
    <form method="get" action="/balance" role="search" className={styles.search}>
      <input id="balance-q" name="q" type="search" aria-label="Search the writing" defaultValue={q} placeholder="Search Balance and Event Features" maxLength={100} />
      <button type="submit" className="btnGhost">Search</button>
    </form>
  </div></section><div className="wrap">
    {q&&<p className={styles.resultsNote}>{list.articles.length||page>1?`Writing that mentions “${q}”`:`Nothing published mentions “${q}” yet.`}</p>}
    {list.articles.length
      ?<ArticleGrid articles={list.articles} lead={browsing} showSection={!!q}/>
      :!q&&<div className={styles.empty}>{page>1?'There is nothing further back than this.':'Balance is ready for its first story. Member submissions will appear here after editorial approval.'}</div>}
    <Pager basePath="/balance" page={page} hasNewer={list.hasNewer} hasOlder={list.hasOlder} query={{ q: q || undefined }}/>
    {browsing&&<RetreatShelf retreats={retreats} />}
  </div></main>;
}
