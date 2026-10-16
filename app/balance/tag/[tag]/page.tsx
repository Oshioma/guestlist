// /balance/tag/<tag> — every published piece with that tag, from either
// section, newest first.
//
// Tags were printed under a piece as plain words that went nowhere, so the
// one thing a reader who liked a piece about afters would do next — look for
// more about afters — was the one thing they could not. The address is the
// tag's slug (lib/articles.ts tagSlug), and every stored spelling that folds
// to it is on the page, so "drum & bass" and "drum and bass" are one list.
//
// An address that matches no published tag is a 404 rather than an empty
// page: an empty list at a real-looking URL is a soft 404 to a crawler, and a
// tag that only drafts use must not announce that those drafts exist.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { listPublishedPage, pageFromParam, tagSlug, tagsForSlug } from '@/lib/articles';
import { pageMeta } from '@/lib/seo';
import { WRITING_FEED } from '@/lib/rss';
import { ArticleGrid, Pager, pagedPath } from '@/components/balance/ArticleGrid';
import styles from '../../balance.module.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ tag: string }>;
type Search = Promise<{ page?: string }>;

// Next hands the segment over still percent-encoded when it is not ASCII.
function decoded(raw: string) {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const slug = decoded((await params).tag);
  const page = pageFromParam((await searchParams).page);
  const found = await tagsForSlug(slug);
  if (!found) return { title: 'Tag not found', robots: { index: false, follow: false } };
  return pageMeta({
    title: page > 1 ? `${found.label} · writing · page ${page}` : `${found.label} · writing`,
    description: `Pieces about ${found.label} from Balance and the Event Features, by the Guestlist community.`,
    path: pagedPath(`/balance/tag/${encodeURIComponent(slug)}`, page),
    feed: WRITING_FEED,
  });
}

export default async function TagPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const raw = decoded((await params).tag);
  const page = pageFromParam((await searchParams).page);
  // /balance/tag/Drum%20%26%20Bass, typed or pasted by hand, goes to the one
  // address that list lives at rather than being a second copy of it.
  const slug = tagSlug(raw);
  if (!slug) notFound();
  if (slug !== raw) permanentRedirect(pagedPath(`/balance/tag/${encodeURIComponent(slug)}`, page));
  const found = await tagsForSlug(slug);
  if (!found) notFound();
  const list = await listPublishedPage({ tags: found.tags, page });
  if (!list.articles.length && page > 1) notFound();

  return (
    <main>
      <section className={styles.hero}>
        <div className="wrap">
          <Link href="/balance" className={styles.kicker}>Guestlist writing · tag</Link>
          <h1 className={styles.title}>{found.label}.</h1>
        </div>
      </section>
      <div className="wrap">
        <ArticleGrid articles={list.articles} showSection />
        <Pager basePath={`/balance/tag/${encodeURIComponent(slug)}`} page={page} hasNewer={list.hasNewer} hasOlder={list.hasOlder} />
      </div>
    </main>
  );
}
