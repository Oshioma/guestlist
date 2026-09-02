// YOUR GUESTLIST — the member's private control surface: what we know,
// what we've inferred, and every switch to change it.

import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { tasteProfile } from '@/lib/taste';
import { myHistory } from '@/lib/scene';
import { memberPlaces } from '@/lib/locations';
import { getEmailPrefs, getPrivacy } from '@/lib/privacy';
import { HistoryPanel, PlacesPanel, SettingsPanel, TastePanel } from '@/components/v2c/YouPanels';
import Link from 'next/link';
import { billingEnabled, getMembership, membershipIsActive, membershipLabel } from '@/lib/membership';
import { MemberBadge } from '@/components/membership/MemberBadge';

export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/you');

  const membership = await getMembership(member.id);
  const isMember = membershipIsActive(membership);
  const [taste, allGenres, history, places, plans, privacy, emailPrefs, profile] = await Promise.all([
    tasteProfile(member.id),
    query<{ id: string; name: string; slug: string; parent_genre_id: string | null }>(
      `select id, name, slug, parent_genre_id from genres where active
        order by parent_genre_id nulls first, sort_order, name`
    ),
    myHistory(member.id),
    memberPlaces(member.id),
    query<{
      id: string; start_date: string; end_date: string; visibility: string;
      location_id: string; name: string; country_name: string | null;
    }>(
      `select tp.id, tp.start_date::text, tp.end_date::text, tp.visibility,
              l.id as location_id, l.name, l.country_name
         from travel_plans tp join locations l on l.id = tp.location_id
        where tp.member_id = $1 and tp.end_date >= current_date
        order by tp.start_date`,
      [member.id]
    ),
    getPrivacy(member.id),
    getEmailPrefs(member.id),
    query<{
      display_name: string; slug: string | null;
      bio: string | null; raving_since: number | null; now_doing: string | null; looking_for: string | null;
    }>(
      `select display_name, slug, bio, raving_since, now_doing, looking_for from members where id = $1`,
      [member.id]
    ).then((r) => r[0]),
  ]);

  const parents = allGenres.filter((g) => !g.parent_genre_id);

  return (
    <main className="wrap youWrap">
      <h1 className="pageTitle">Your Guestlist</h1>
      <p className="pageStandfirst">
        Based on what you’ve told us and what you’ve been interested in.
        You’re in control of all of it.
      </p>
      <nav className="chipRow" style={{ marginBottom: 8 }}>
        <Link href="/you/membership" className="chip">Membership</Link>
        <a href="#music" className="chip">Music</a>
        <a href="#history" className="chip">Rave history</a>
        <a href="#places" className="chip">Places & travel</a>
        <a href="#settings" className="chip">Profile & privacy</a>
      </nav>

      {/* Membership first: it is the part of Guestlist that gets you in. */}
      <section className="youPanel">
        <h2 className="youPanelTitle">Membership {isMember && <MemberBadge style={{ marginLeft: 8, verticalAlign: 'middle' }} />}</h2>
        <p className="youPanelSub">
          {isMember
            ? `${membershipLabel(membership)}. See something you want to go to? Press GET ME IN on the event.`
            : 'Free entrance to parties when we can make it happen, member prices, the Market, drops — and a membership that does some good.'}
        </p>
        <div className="youPanelActions">
          {isMember
            ? <Link href="/you/membership" className="btnAccent">Your membership →</Link>
            : <Link href="/membership" className="btnAccent">{billingEnabled() ? 'Join Guestlist' : 'Membership — coming soon'}</Link>}
          <Link href="/market" className="youHistoryMeta" style={{ textDecoration: 'underline' }}>Guestlist Market</Link>
        </div>
      </section>

      <TastePanel
        allGenres={allGenres}
        explicit={taste.explicit.map((g) => ({ ...g, id: g.genre_id }))}
        inferred={taste.inferred.map((g) => ({ ...g, id: g.genre_id }))}
      />
      <HistoryPanel initialHistory={history} parentGenres={parents} />
      <PlacesPanel
        initialPlaces={places.map((p) => ({
          id: p.id, name: p.name, slug: p.slug, country_name: p.country_name, relation: p.relation,
        }))}
        initialPlans={plans}
      />
      <SettingsPanel
        initialPrivacy={privacy as unknown as Record<string, boolean>}
        initialEmailPrefs={emailPrefs as unknown as Record<string, boolean>}
        initialProfile={profile}
      />
    </main>
  );
}
