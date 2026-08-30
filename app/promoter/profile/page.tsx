import { dashContext } from '@/lib/promoterDash';
import { DashShell } from '@/components/promoter/DashShell';
import { ProfileForm } from '@/components/promoter/ProfileForm';
import { roleAtLeast } from '@/lib/promoterAuth';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PromoterProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await dashContext(sp.p);
  if (ctx.kind !== 'ok' || ctx.active.claim_status !== 'verified') {
    return <DashShell ctx={ctx} tab="/profile">{null}</DashShell>;
  }
  if (!roleAtLeast(ctx.active.role, 'admin')) {
    return (
      <DashShell ctx={ctx} tab="/profile">
        <p className="adminSub">Profile editing needs admin access.</p>
      </DashShell>
    );
  }

  const [promoter, genres, selected] = await Promise.all([
    queryOne<{
      description: string | null; website: string | null; image_url: string | null;
      hero_image_url: string | null; city: string | null; country: string | null;
      socials: Record<string, string>;
    }>(
      `select description, website, image_url, hero_image_url, city, country, socials
         from promoters where id = $1`,
      [ctx.active.id]
    ),
    query<{ slug: string; name: string }>(
      `select slug, name from genres where parent_genre_id is null and active order by sort_order`
    ),
    query<{ slug: string }>(
      `select g.slug from promoter_genres pg join genres g on g.id = pg.genre_id where pg.promoter_id = $1`,
      [ctx.active.id]
    ),
  ]);

  return (
    <DashShell ctx={ctx} tab="/profile">
      <ProfileForm
        promoterId={ctx.active.id}
        initial={{
          description: promoter?.description ?? '',
          website: promoter?.website ?? '',
          imageUrl: promoter?.image_url ?? '',
          heroImageUrl: promoter?.hero_image_url ?? '',
          city: promoter?.city ?? '',
          country: promoter?.country ?? '',
          socials: promoter?.socials ?? {},
          genreSlugs: selected.map((s) => s.slug),
        }}
        genres={genres}
      />
    </DashShell>
  );
}
