// WHAT IS WAITING ON YOU — on every admin page, not only the one you happen
// to have open. The same counts that drive the admin notification digest, so
// the bell and the bar can never disagree.
//
// It disappears entirely when there is nothing to do. A bar that says "0, 0,
// 0" every day is a bar people stop seeing.

import Link from 'next/link';
import { reviewQueue } from '@/lib/adminNotify';

type Desk = {
  key: keyof Awaited<ReturnType<typeof reviewQueue>>;
  one: string;
  many?: string;
  href: string;
};

const DESKS: Desk[] = [
  { key: 'events', one: 'event', href: '/admin/events' },
  { key: 'articles', one: 'article', href: '/admin/articles' },
  { key: 'claims', one: 'promoter claim', href: '/admin/promoters' },
  { key: 'corrections', one: 'correction', href: '/admin/archive' },
  { key: 'reports', one: 'report', href: '/admin/network' },
  { key: 'genreSuggestions', one: 'genre suggestion', href: '/admin/genre-suggestions' },
  { key: 'accessRequests', one: 'GET ME IN request', href: '/admin/getmein' },
  { key: 'marketApplications', one: 'Market application', href: '/admin/market' },
];

export async function ReviewQueueBar() {
  const q = await reviewQueue();
  if (q.total === 0) return null;
  const waiting = DESKS.filter((d) => (q[d.key] as number) > 0);
  return (
    <div className="reviewQueueBar">
      <span className="reviewQueueLabel">Waiting for you</span>
      {waiting.map((d) => {
        const n = q[d.key] as number;
        return (
          <Link key={d.key} href={d.href} className="reviewQueueChip">
            <b>{n}</b> {n === 1 ? d.one : (d.many ?? `${d.one}s`)}
          </Link>
        );
      })}
    </div>
  );
}
