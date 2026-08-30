// Promoter discovery: the crews behind the nights.

import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { getTopLevelGenres } from '@/lib/events';
import { listPromoters } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

type Search = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PromotersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const member = await getCurrentMember();
  const genre = one(sp.genre) || null;
  const tab = one(sp.tab) === 'popular' || !member ? 'popular' : (one(sp.tab) ?? 'for-you');

  const [promoters, genres] = await Promise.all([
    listPromoters({
      genreSlug: genre,
      memberId: member?.id ?? null,
      sort: tab === 'for-you' ? 'for-you' : 'popular',
    }),
    getTopLevelGenres(),
  ]);

  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = { tab: tab === 'for-you' ? null : tab, genre };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/promoters?${s}` : '/promoters';
  };

  return (
    <main className="wrap">
      <h1 className="pageTitle">Promoters</h1>
      <p className="pageStandfirst">
        The crews, collectives and institutions behind the nights worth going to.
      </p>

      {member && (
        <nav className="tabRow">
          <Link href={qs({ tab: null })} className={`tab${tab === 'for-you' ? ' active' : ''}`}>For You</Link>
          <Link href={qs({ tab: 'popular' })} className={`tab${tab === 'popular' ? ' active' : ''}`}>Popular</Link>
        </nav>
      )}
      <div className="chipRow">
        <Link href={qs({ genre: null })} className={`chip${!genre ? ' active' : ''}`}>All</Link>
        {genres.map((g) => (
          <Link key={g.slug} href={qs({ genre: g.slug === genre ? null : g.slug })} className={`chip${genre === g.slug ? ' active' : ''}`}>
            {g.name}
          </Link>
        ))}
      </div>

      {promoters.length === 0 ? (
        <div className="emptyState" style={{ marginTop: 20 }}>
          <h3>No promoters here yet.</h3>
          <p>Know a crew we should have? Add one of their events and we’ll take it from there.</p>
          <Link href="/events/submit" className="btnGhost">Add an event →</Link>
        </div>
      ) : (
        <div className="cardGrid" style={{ paddingTop: 20 }}>
          {promoters.map((p) => (
            <article className="eventCard" key={p.id}>
              <Link href={`/promoters/${p.slug}`} className="cardOverlayLink" aria-label={p.name} />
              <div className="body" style={{ paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 16, objectFit: 'cover' }} />
                  ) : (
                    <div className="profileLogo" style={{ width: 56, height: 56, fontSize: 22, marginBottom: 0 }}>{p.name[0]}</div>
                  )}
                  <div>
                    <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {p.name}
                      {p.verified && <span className="verifiedMark" title="Verified promoter">✓</span>}
                    </h3>
                    <div className="cardMeta">
                      {p.city && <span className="city">{p.city}</span>}
                      <span>{p.upcoming_count} upcoming</span>
                      <span>{p.follower_count} follower{p.follower_count === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </div>
                {p.description && (
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {p.description.slice(0, 120)}{p.description.length > 120 ? '…' : ''}
                  </p>
                )}
                {p.genres.length > 0 && (
                  <div className="tagRow">
                    {p.genres.slice(0, 4).map((g) => <span className="tag" key={g.slug}>{g.name}</span>)}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
