// The original Guestlist landing page, ported into the app shell.
// Copy and behaviour preserved from the previous static index.html
// (kept at legacy/index.html for reference); the email gate still posts
// to the existing Basin form.

import Link from 'next/link';
import { EmailGate } from '@/components/EmailGate';

const DOCTRINE: [string, React.ReactNode][] = [
  ['What Guestlist is', <>A private access layer for experiences and spaces that are not designed for mass visibility. Many listings are intentionally unadvertised, time-sensitive, or shared only through trusted circles.</>],
  ['What access looks like', <>Private listings. Limited invitations. Small rooms.<br /><span style={{ color: 'rgba(234,234,234,0.78)' }}>Not everything is visible. Not everything repeats.</span></>],
  ['How access works', <>Referral-led by default. Invitations are extended locally, city by city. In some cases, aligned interest is noted and followed up privately.<br /><span style={{ color: 'rgba(234,234,234,0.78)' }}>Silence should be considered the default outcome.</span></>],
  ['Who it is for', <>Hosts, curators, and participants who value discretion, quality, and context — and who can operate without public validation.<br /><span style={{ color: 'rgba(234,234,234,0.78)' }}>Guestlist is small on purpose.</span></>],
  ['What this is not', <>Not a ticket marketplace. Not a mailing list. Not a social feed. Guestlist does not optimise for engagement metrics.<br /><span style={{ color: 'rgba(234,234,234,0.78)' }}>This is not built for the crowd.</span></>],
  ['Conduct', <>Discretion is expected. Respect hosts and spaces. Access is a privilege and may be withdrawn without explanation.</>],
];

export default function HomePage() {
  return (
    <div className="wrap">
      <section className="landingHero">
        <div className="landingHeroInner">
          <h1>Access is selective.</h1>
          <p className="landingLead">
            Guestlist is a privately operated network connecting curated experiences,
            spaces, and people.
          </p>
          <p className="landingLead emphasis">
            Guestlist operates privately across a small number of international cities,
            with access extended locally and selectively.
          </p>
          <p className="landingLead">
            There is no public membership. Access is typically extended through
            existing members, hosts, partners, and trusted intermediaries.
          </p>
          <p className="landingLead">
            Not a ticket marketplace. Not a mailing list. Not a social feed.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
            <Link href="/events" className="btnAccent">Browse events →</Link>
            <EmailGate />
          </div>
        </div>
      </section>

      <section className="doctrine" aria-label="Doctrine">
        {DOCTRINE.map(([title, body]) => (
          <div className="doctrineCard" key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        ))}
      </section>

      <footer className="siteFooter">
        <div>Guestlist — private access.</div>
        <div>info@guestlist.net</div>
      </footer>
    </div>
  );
}
