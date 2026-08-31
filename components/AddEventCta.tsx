// ADD AN EVENT — the invitation, not a nav item. Guestlist only knows
// about the nights people tell it about, so the ask is made properly:
// a full-width panel with a large button, on the pages where someone has
// just been looking at what's on (and noticing what's missing).

import Link from 'next/link';

export function AddEventCta({
  heading = 'Know a night we’re missing?',
  sub = 'Paste a link or fill in the details — takes a minute, and the Guestlist team checks every submission.',
  city,
}: {
  heading?: string;
  sub?: string;
  city?: string | null;
}) {
  return (
    <section className="addEventCta">
      <div className="addEventCtaText">
        <h2 className="addEventCtaTitle">
          {city ? `Know a night in ${city} we’re missing?` : heading}
        </h2>
        <p className="addEventCtaSub">{sub}</p>
      </div>
      <Link href="/events/submit" className="addEventCtaBtn">+ Add an event</Link>
    </section>
  );
}
