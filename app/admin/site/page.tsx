import { getNavVisibility } from '@/lib/settings';
import { siteImageRows } from '@/lib/siteImages';
import { NavToggles } from '@/components/admin/NavToggles';
import { SiteImages } from '@/components/admin/SiteImages';

export const dynamic = 'force-dynamic';

export default async function AdminSitePage() {
  const [nav, images] = await Promise.all([getNavVisibility(), siteImageRows()]);
  return (
    <main>
      <h1 className="pageTitle">Site</h1>
      <p className="pageStandfirst">
        Turn parts of the site on and off. Hiding a section removes it from the
        navigation only — the pages stay reachable by their address, so nothing
        already linked breaks.
      </p>
      <NavToggles initial={nav} />

      {/* THE PICTURES, WHERE SOMEBODY CAN CHANGE THEM.
          Every fixed photograph on the site is a named slot with a picture in
          it. Changing one takes a file picker, not a deploy. */}
      <div className="sectionLabel" style={{ marginTop: 34 }}>Pictures</div>
      <p className="adminSub">
        Every fixed photograph on the site. Replacing one changes it everywhere
        it appears, straight away — and the original is always one press away.
      </p>
      <SiteImages initial={images} />
    </main>
  );
}
