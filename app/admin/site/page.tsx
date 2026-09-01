// SITE — switches that change the shape of the public site without a deploy.

import { getNavVisibility } from '@/lib/settings';
import { NavToggles } from '@/components/admin/NavToggles';

export const dynamic = 'force-dynamic';

export default async function AdminSitePage() {
  const nav = await getNavVisibility();
  return (
    <main>
      <h1 className="pageTitle">Site</h1>
      <p className="pageStandfirst">
        Turn parts of the site on and off. Hiding a section removes it from the
        navigation only — the pages stay reachable by their address, so nothing
        already linked breaks.
      </p>
      <NavToggles initial={nav} />
    </main>
  );
}
