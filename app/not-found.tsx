// NOT FOUND, BUT NOT A DEAD END.
//
// Guestlist had no 404 page at all, so a dead link handed people the
// framework's default: a bare line of black text on white, in a font this site
// does not use, with nowhere to go. On a site whose whole business is telling
// somebody where to be tonight, that is the worst possible screen to lose them
// on.
//
// So this one behaves like a door person rather than an error: it admits the
// thing is gone, and then points at the four places worth walking to. It is a
// server component with no data of its own on purpose — a not-found page that
// depends on a query is a not-found page that can fail.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Nothing here · Guestlist',
  robots: { index: false, follow: true },
};

const WAYS_ON: { href: string; label: string; blurb: string }[] = [
  { href: '/events', label: 'What’s on', blurb: 'Every night worth knowing about, your city first.' },
  { href: '/clubmessenger', label: 'Tonight', blurb: 'Who is out right now, and where they are.' },
  { href: '/balance', label: 'Balance', blurb: 'Writing about the scene, by people in it.' },
  { href: '/archive', label: 'The archive', blurb: 'Flyers, rooms and nights that already happened.' },
];

export default function NotFound() {
  return (
    <main className="notFound">
      <div className="notFoundInner">
        <div className="notFoundCode" aria-hidden>404</div>
        <h1 className="notFoundTitle">
          You’re not on <span>this</span> list
        </h1>
        <p className="notFoundBody">
          This page has been taken down, renamed, or never existed. It happens —
          nights get cancelled and links go stale faster than anything else on
          the internet.
        </p>

        <div className="notFoundWays">
          {WAYS_ON.map((w) => (
            <Link key={w.href} href={w.href} className="notFoundWay">
              <span className="notFoundWayLabel">{w.label}</span>
              <span className="notFoundWayBlurb">{w.blurb}</span>
            </Link>
          ))}
        </div>

        <p className="notFoundFoot">
          Followed a link from somewhere and it should have worked?{' '}
          <a href="mailto:info@guestlist.net?subject=Broken%20link%20on%20Guestlist">Tell us</a> and
          we will fix it.
        </p>
      </div>
    </main>
  );
}
