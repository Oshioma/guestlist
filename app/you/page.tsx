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

export const dynamic = 'force-dynamic';

export default async function YouPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/you');

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
    query<{ bio: string | null; raving_since: number | null; now_doing: string | null; looking_for: string | null }>(
      `select bio, raving_since, now_doing, looking_for from members where id = $1`,
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
        <a href="#music" className="chip">Music</a>
        <a href="#history" className="chip">Rave history</a>
        <a href="#places" className="chip">Places & travel</a>
        <a href="#settings" className="chip">Profile & privacy</a>
      </nav>

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
