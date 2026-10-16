// YOUR EVENTS.
//
// Saving a night, pressing Interested or Going: all three said "remember this
// for me", and nothing on the site ever gave the list back. You found the
// night again by searching for it, if you remembered its name. This is that
// list — what is coming up, soonest first, then what you went to recently.
//
// Private to the member, like everything under /you. Cancelled nights stay in
// the list with their badge on, because this is where somebody who was going
// finds out (lib/events memberEvents).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentMember } from '@/lib/auth';
import { memberEvents, type MemberEventCard } from '@/lib/events';
import { EventCard } from '@/components/EventCard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your events', robots: { index: false, follow: false } };

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'going', label: 'Going' },
  { key: 'interested', label: 'Interested' },
  { key: 'saved', label: 'Saved' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

const matches = (e: MemberEventCard, f: Filter) =>
  f === 'all' || (f === 'saved' ? e.saved : e.rsvp === f);

export default async function YourEventsPage({ searchParams }: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/you/events');

  const raw = (await searchParams).show;
  const showRaw = Array.isArray(raw) ? raw[0] : raw;
  const show: Filter = FILTERS.some((f) => f.key === showRaw) ? (showRaw as Filter) : 'all';

  const { upcoming: allUpcoming, past: allPast } = await memberEvents(member.id);
  const upcoming = allUpcoming.filter((e) => matches(e, show));
  const past = allPast.filter((e) => matches(e, show));
  const count = (f: Filter) => allUpcoming.filter((e) => matches(e, f)).length;

  const grid = (rows: MemberEventCard[]) => (
    <div className="cardGrid">
      {rows.map((e) => <EventCard key={e.id} event={e} saved={e.saved} isSignedIn />)}
    </div>
  );

  return (
    <main className="wrap youWrap">
      <p className="youHistoryMeta" style={{ marginBottom: 6 }}>
        <Link href="/you" style={{ textDecoration: 'underline' }}>← Your Guestlist</Link>
      </p>
      <h1 className="pageTitle">Your events</h1>
      <p className="pageStandfirst">
        Everything you’ve saved, or said you’re interested in or going to.
      </p>

      <nav className="chipRow" style={{ marginBottom: 18 }} aria-label="Show">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === 'all' ? '/you/events' : `/you/events?show=${f.key}`}
                className={`chip${show === f.key ? ' active' : ''}`}
                aria-current={show === f.key ? 'page' : undefined}>
            {f.label}{count(f.key) > 0 ? ` · ${count(f.key)}` : ''}
          </Link>
        ))}
      </nav>

      <div className="sectionLabel">Coming up</div>
      {upcoming.length > 0 ? grid(upcoming) : (
        <div className="emptyState">
          <h3>{show === 'all' ? 'Nothing saved yet.' : `Nothing marked ${show} coming up.`}</h3>
          <p>Save a night, or press Interested or Going on it, and it will be here.</p>
          <div className="suggestions">
            <Link href="/events" className="btnAccent">Find something on</Link>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <>
          <div className="sectionLabel">Recently</div>
          {grid(past)}
        </>
      )}
    </main>
  );
}
