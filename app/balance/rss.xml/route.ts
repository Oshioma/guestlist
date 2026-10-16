// /balance/rss.xml — the newest thirty published pieces, Balance and Event
// Features together, as RSS 2.0. One feed rather than one per section: a
// reader who follows Guestlist's writing wants all of it, and two feeds of a
// few pieces a month each is two subscriptions for very little.
//
// Rendered per request and cached at the edge for a quarter of an hour, so a
// piece published by the desk reaches feed readers on their next poll without
// the build needing a database.

import { latestPublishedArticles } from '@/lib/articles';
import { articlesRss } from '@/lib/rss';

export const dynamic = 'force-dynamic';

export async function GET() {
  const articles = await latestPublishedArticles(30);
  return new Response(articlesRss(articles), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
