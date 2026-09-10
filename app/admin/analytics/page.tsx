// ADMIN → ANALYTICS. The site's own numbers, read back.
//
// Ordered by what a decision needs, not by what is easiest to count. The
// headline row is "is it growing", the chart is "when", the funnel is "where
// it stops", the nights are "what worked", and the catalogue at the end is
// "is there enough on the site for any of it to grow".
//
// Every number says what it means underneath it. A dashboard whose labels
// need explaining is a dashboard nobody trusts six months later.

import Link from 'next/link';
import {
  actions, byDay, catalogue, funnel, headlines, memberPlaces, recordingSince, topNights, topPages,
  WINDOWS, type Window,
} from '@/lib/adminAnalytics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics · Admin' };

const LABEL: Record<string, string> = {
  event_viewed: 'Looked at a night', ticket_clicked: 'Clicked through to tickets',
  event_shared: 'Shared a night', event_saved: 'Saved a night', going: 'Said they were going',
  interested: 'Said they were interested', signed_in: 'Signed in',
  get_me_in_viewed: 'Opened GET ME IN', get_me_in_requested: 'Asked us to get them in',
  get_me_in_guestlisted: 'Got on a door list', membership_page_viewed: 'Read the membership page',
  membership_waitlist_joined: 'Joined the waitlist', market_viewed: 'Opened the Market',
  archive_viewed: 'Opened the Archive', memory_added: 'Added a memory',
  clubmessenger_open: 'Opened Club Messenger', ask_guestlist_opened: 'Opened Ask Guestlist',
  ask_question: 'Asked a question', retreat_clicked: 'Clicked a retreat',
  member_profile_viewed: 'Looked at somebody', promoter_viewed: 'Looked at a promoter',
  recommendation_click: 'Took a recommendation', email_sent: 'Email sent',
  notification_clicked: 'Opened a notification',
};
const pretty = (t: string) => LABEL[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Delta({ now, before }: { now: number; before: number }) {
  // No previous period, no claim. "+100%" against zero is not information.
  if (before === 0) return <span className="anDelta flat">{now > 0 ? 'new' : '—'}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="anDelta flat">level</span>;
  return (
    <span className={`anDelta ${pct > 0 ? 'up' : 'down'}`}>
      {pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  );
}

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = (WINDOWS.includes(Number(sp.days) as Window) ? Number(sp.days) : 30) as Window;

  const [tiles, daily, steps, acts, nights, pages, places, cat, since] = await Promise.all([
    headlines(days), byDay(days), funnel(days), actions(days),
    topNights(days), topPages(days), memberPlaces(), catalogue(), recordingSince(),
  ]);

  const peak = Math.max(1, ...daily.map((d) => Math.max(d.people, d.sign_ins, d.joined)));
  const widest = Math.max(1, ...steps.map((s) => s.n));
  const busiest = Math.max(1, ...acts.map((a) => a.n));

  return (
    <main>
      <h1 className="adminTitle">Analytics</h1>
      <p className="adminSub">
        Guestlist’s own numbers, out of Guestlist’s own tables. Nothing is sent anywhere and no
        third party is involved — which is also why it counts what people <em>did</em> rather than
        how many pages they turned.
      </p>

      <div className="statePills">
        {WINDOWS.map((w) => (
          <Link key={w} href={`/admin/analytics?days=${w}`} className={`statePill${days === w ? ' active' : ''}`}>
            Last {w} days
          </Link>
        ))}
      </div>

      <div className="anTiles">
        {tiles.map((t) => (
          <div className="anTile" key={t.key}>
            <div className="anTileTop">
              <span className="anTileLabel">{t.label}</span>
              <Delta now={t.now} before={t.before} />
            </div>
            <div className="anTileNum">{t.now.toLocaleString('en-GB')}</div>
            <div className="anTileHint">{t.hint}</div>
          </div>
        ))}
      </div>

      <h2 className="adminTitle anH2">Day by day</h2>
      <p className="adminSub">
        People, sign-ins and new accounts. Days are UTC, so a Saturday night in London counts
        partly on the Sunday.
      </p>
      <div className="anChart">
        {daily.map((d) => (
          <div className="anDay" key={d.d} title={`${short(d.d)} · ${d.people} people · ${d.sign_ins} sign-ins · ${d.joined} joined`}>
            <div className="anBars">
              <span className="anBar people" style={{ height: `${(d.people / peak) * 100}%` }} />
              <span className="anBar signIns" style={{ height: `${(d.sign_ins / peak) * 100}%` }} />
              <span className="anBar joined" style={{ height: `${(d.joined / peak) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="anLegend">
        <span><i className="people" />People</span>
        <span><i className="signIns" />Sign-ins</span>
        <span><i className="joined" />Joined</span>
        {/* A bar chart with no number on it is a shape. */}
        <span className="anLegendEnds">
          {daily.length ? `${short(daily[0].d)} → ${short(daily[daily.length - 1].d)} · busiest day ${peak}` : ''}
        </span>
      </div>

      <h2 className="adminTitle anH2">Where it stops</h2>
      <p className="adminSub">
        Counted inside the window, so these are not the same people walking down the list — it is
        how many did each thing. The drop between two rows is the question worth asking.
      </p>
      <div className="anFunnel">
        {steps.map((s) => (
          <div className="anStep" key={s.label}>
            <div className="anStepBar" style={{ width: `${Math.max(3, (s.n / widest) * 100)}%` }} />
            <div className="anStepText">
              <b>{s.n.toLocaleString('en-GB')}</b> {s.label}
              <span className="anStepHint">{s.hint}</span>
            </div>
          </div>
        ))}
      </div>

      <h2 className="adminTitle anH2">The nights that did something</h2>
      {nights.length === 0 ? (
        <p className="adminSub">Nothing recorded against an event in this window.</p>
      ) : (
        <div className="anTable">
          <div className="anRow anHead">
            <span>Night</span><span>Looked</span><span>Tickets</span><span>Shared</span><span>Asked</span><span>Going</span>
          </div>
          {nights.map((n) => (
            <div className="anRow" key={n.id}>
              <span>
                <Link href={`/events/${n.slug}`}>{n.title}</Link>
                <em>{[n.city, new Date(n.start_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</em>
              </span>
              <span>{n.views}</span><span>{n.tickets}</span><span>{n.shares}</span><span>{n.asks}</span><span>{n.going}</span>
            </div>
          ))}
        </div>
      )}

      <div className="anTwoUp">
        <div>
          <h2 className="adminTitle anH2">What people did</h2>
          <p className="adminSub">Every recorded action, most first.</p>
          <div className="anActions">
            {acts.length === 0 && <p className="adminSub">Nothing recorded in this window.</p>}
            {acts.map((a) => (
              <div className="anAction" key={a.event_type}>
                <div className="anActionBar" style={{ width: `${Math.max(2, (a.n / busiest) * 100)}%` }} />
                <span className="anActionName">{pretty(a.event_type)}</span>
                <span className="anActionN">{a.n.toLocaleString('en-GB')}<em>{a.people} {a.people === 1 ? 'person' : 'people'}</em></span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="adminTitle anH2">Pages</h2>
          <p className="adminSub">Where those actions happened. A page with no tracking on it never appears.</p>
          <div className="anTable">
            <div className="anRow anHead three"><span>Path</span><span>People</span><span>Actions</span></div>
            {pages.length === 0 && <p className="adminSub">Nothing recorded in this window.</p>}
            {pages.map((p) => (
              <div className="anRow three" key={p.path}>
                <span><Link href={p.path}>{p.path}</Link></span>
                <span>{p.people}</span><span>{p.n}</span>
              </div>
            ))}
          </div>

          <h2 className="adminTitle anH2">Where the membership is</h2>
          <p className="adminSub">Every member, not just this window.</p>
          <div className="anTable">
            {places.map((p) => (
              <div className="anRow three" key={p.place}><span>{p.place}</span><span>{p.n}</span><span /></div>
            ))}
          </div>
        </div>
      </div>

      <h2 className="adminTitle anH2">What there is to look at</h2>
      <p className="adminSub">Right now, not for the window. None of the numbers above can grow past what is on the site.</p>
      <div className="anTiles small">
        {([
          ['Live events', cat.live_events, '/admin/events?state=live'],
          ['In the new queue', cat.queue_new, '/admin/events?state=new'],
          ['Needs review', cat.queue_review, '/admin/events?state=needs_review'],
          ['Sources connected', cat.sources, '/admin/sources'],
          ['…of those, polled', cat.sources_watched, '/admin/sources'],
          ['Members', cat.members, '/admin/members'],
          ['Confirmed emails', cat.members_confirmed, '/admin/members'],
          ['Articles published', cat.articles, '/admin/articles'],
          ['Retreats live', cat.retreats, '/admin/retreats'],
          ['Waiting on the waitlist', cat.waitlist, '/admin/memberships'],
        ] as [string, number, string][]).map(([label, n, href]) => (
          <Link className="anTile" key={label} href={href}>
            <div className="anTileNum">{(n ?? 0).toLocaleString('en-GB')}</div>
            <div className="anTileHint">{label}</div>
          </Link>
        ))}
      </div>

      <div className="anNote">
        <b>What these numbers are not.</b>
        <p>
          They count what the site is instrumented to record. A page with no tracking in it is
          invisible here however many people read it, and nothing exists before the day it started
          being recorded
          {since.anything && <> — which was {new Date(since.anything).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</>}.
          {' '}Sign-ins have only been recorded since that feature shipped
          {since.sign_ins
            ? <> ({new Date(since.sign_ins).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})</>
            : <>, and none have been recorded yet</>}.
        </p>
        <p>
          Somebody signed out is a browser rather than a person: the anonymous id lives in that
          browser. One person on a laptop and a phone counts twice, and clearing site data starts
          them again. Members are counted properly, because we know who they are.
        </p>
      </div>
    </main>
  );
}
