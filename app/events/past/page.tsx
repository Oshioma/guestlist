// NIGHTS THAT HAVE HAPPENED.
//
// A night's page used to stop mattering the morning after: it fell out of
// every list and, after sixty days, out of the sitemap, so the party people
// went to — the one they search for afterwards, to find the line-up or send
// it to a friend — became a page nothing pointed at. This is the way back to
// them: every live listing that has finished, newest first, a page at a time,
// with plain ?page= links a crawler can follow all the way down.
//
// Cancelled nights are not here. They never happened, and their own pages
// still say so to anyone who has the link.

import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { BROWSE_PAGE_SIZE, clampOffset, pastEvents } from '@/lib/events';
import { EventCard } from '@/components/EventCard';
import { pageMeta } from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Search = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function pageFrom(sp: Search): number {
  const n = Math.floor(Number(one(sp.page)));
  return clampOffset((Number.isFinite(n) && n > 1 ? n - 1 : 0) * BROWSE_PAGE_SIZE) / BROWSE_PAGE_SIZE + 1;
}

const href = (page: number) => (page > 1 ? `/events/past?page=${page}` : '/events/past');

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const page = pageFrom(await searchParams);
  // Each page is its own list of nights, so each is its own canonical —
  // pointing them all at page one would tell a crawler to ignore the rest.
  return pageMeta({
    title: page > 1 ? `Past events — page ${page}` : 'Past events — the nights that already happened',
    description: 'Every night that has been on Guestlist, newest first: the line-ups, the venues and the people who went.',
    path: href(page),
  });
}

export default async function PastEventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const page = pageFrom(await searchParams);
  const offset = (page - 1) * BROWSE_PAGE_SIZE;
  const member = await getCurrentMember();

  // One more than a page, so we know whether there is another without
  // counting them all.
  const rows = await pastEvents({ offset, limit: BROWSE_PAGE_SIZE + 1 });
  const hasMore = rows.length > BROWSE_PAGE_SIZE;
  const events = rows.slice(0, BROWSE_PAGE_SIZE);

  const savedIds = new Set<string>(
    member && events.length
      ? (await query<{ event_id: string }>(
          `select event_id from member_event_actions
            where member_id = $1 and saved_at is not null and event_id = any($2::uuid[])`,
          [member.id, events.map((e) => e.id)]
        )).map((r) => r.event_id)
      : []
  );

  return (
    <main className="wrap">
      <h1 className="pageTitle">Past events</h1>
      <p className="pageStandfirst">
        The nights that already happened, newest first. Looking for what’s on?{' '}
        <Link href="/events" style={{ textDecoration: 'underline' }}>See upcoming events</Link>.
      </p>

      <div className="resultMeta">
        {events.length > 0 && `Events ${offset + 1}–${offset + events.length}`}
      </div>

      {events.length > 0 ? (
        <div className="cardGrid">
          {events.map((e) => (
            <EventCard key={e.id} event={e} saved={savedIds.has(e.id)} isSignedIn={!!member} />
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <h3>{page > 1 ? 'That’s everything.' : 'Nothing here yet.'}</h3>
          <p>
            {page > 1
              ? <Link href="/events/past">Back to the most recent</Link>
              : <Link href="/events">See what’s coming up</Link>}
          </p>
        </div>
      )}

      {(hasMore || page > 1) && (
        <nav className="pager" aria-label="More past events">
          {page > 1 && <Link href={href(page - 1)} className="btnGhost" rel="prev">← Newer</Link>}
          {hasMore && <Link href={href(page + 1)} className="btnAccent" rel="next">Load more</Link>}
        </nav>
      )}
    </main>
  );
}
