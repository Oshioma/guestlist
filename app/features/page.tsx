// /features — EVENT FEATURES HAD NO HOME.
//
// Event Features (the 'events' editorial section: nights written up, previews,
// reviews) were published and then reachable only from the home page shelf or
// a link to the piece itself. /balance lists Balance only, and every Event
// Feature's kicker sent its reader there — to a page that did not contain it.
//
// This is that section's own listing, built exactly like Balance's: the same
// cards, featured first on the first page, twenty-four to a page. The pieces
// themselves stay at /balance/<slug>, which is where every link already
// shared points.
//
// A top-level /features does shadow a city called "features" in app/[place];
// there is no such place, and a static route is the honest name for this.

import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublishedPage, pageFromParam } from '@/lib/articles';
import { pageMeta } from '@/lib/seo';
import { WRITING_FEED } from '@/lib/rss';
import { ArticleGrid, Pager, pagedPath } from '@/components/balance/ArticleGrid';
import styles from '../balance/balance.module.css';

export const dynamic = 'force-dynamic';

type Search = Promise<{ page?: string }>;
const DESCRIPTION = 'The nights, written up — previews, reviews and stories from the dancefloor by the Guestlist community.';

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const page = pageFromParam((await searchParams).page);
  return pageMeta({
    title: page > 1 ? `Event Features · page ${page}` : 'Event Features',
    description: DESCRIPTION,
    path: pagedPath('/features', page),
    feed: WRITING_FEED,
  });
}

export default async function FeaturesPage({ searchParams }: { searchParams: Search }) {
  const page = pageFromParam((await searchParams).page);
  const list = await listPublishedPage({ section: 'events', page });
  return (
    <main>
      <section className={styles.hero}>
        <div className="wrap">
          <div className={styles.kicker}>From the dancefloor</div>
          <h1 className={styles.title}>Event Features.</h1>
          <p className={styles.lead}>{DESCRIPTION}</p>
          <p style={{ margin: '14px 0 0', fontSize: 14 }}>
            <Link href="/balance">Balance</Link>
            <span style={{ color: 'var(--text-muted)' }}> — ideas and perspectives from the community</span>
          </p>
        </div>
      </section>
      <div className="wrap">
        {list.articles.length
          ? <ArticleGrid articles={list.articles} lead={page === 1} />
          : <div className={styles.empty}>{page > 1 ? 'There is nothing further back than this.' : 'No Event Features have been published yet.'}</div>}
        <Pager basePath="/features" page={page} hasNewer={list.hasNewer} hasOlder={list.hasOlder} />
      </div>
    </main>
  );
}
