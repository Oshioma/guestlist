// EXPLORE THE WORLD — destinations driven by real event supply, never a
// hardcoded "cool cities" list. A place appears here when it actually has
// upcoming events on Guestlist.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { liveDestinations } from '@/lib/locations';

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
  const member = await getCurrentMember();
  const destinations = await liveDestinations(24);

  return (
    <main className="wrap">
      <h1 className="pageTitle">Explore the world</h1>
      <p className="pageStandfirst">
        One global network — every city here has real events on Guestlist
        right now. Follow the places you care about and they shape your
        recommendations.
      </p>
      {destinations.length === 0 ? (
        <div className="emptyState">
          <h3>The map is filling in.</h3>
          <p>As events go live around the world, destinations appear here.</p>
        </div>
      ) : (
        <div className="exploreGrid">
          {destinations.map((d) => (
            <Link key={d.id} href={`/${d.slug}`} className="exploreCard">
              <span className="exploreName">{d.name}</span>
              <span className="exploreCountry">{d.country_name ?? d.country_code ?? ''}</span>
              <span className="exploreStats">
                {d.upcoming_events} event{d.upcoming_events === 1 ? '' : 's'}
                {d.promoters > 0 && ` · ${d.promoters} promoter${d.promoters === 1 ? '' : 's'}`}
                {d.members > 0 && ` · ${d.members} member${d.members === 1 ? '' : 's'}`}
              </span>
            </Link>
          ))}
        </div>
      )}
      {member && (
        <p className="youPanelSub" style={{ marginTop: 20 }}>
          Somewhere missing? Follow it from <Link href="/you#places" style={{ textDecoration: 'underline' }}>your places</Link> and
          we’ll start watching it for you.
        </p>
      )}
    </main>
  );
}
