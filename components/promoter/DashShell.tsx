// Promoter dashboard chrome: operational, polished, mobile-first nav.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DashContext } from '@/lib/promoterDash';

const TABS = [
  ['', 'Overview'],
  ['/events', 'Events'],
  ['/sources', 'Sources'],
  ['/analytics', 'Analytics'],
  ['/profile', 'Profile'],
  ['/team', 'Team'],
] as const;

export function DashShell({
  ctx,
  tab,
  children,
}: {
  ctx: DashContext;
  tab: string;
  children: React.ReactNode;
}) {
  if (ctx.kind === 'anon') redirect('/login?next=/promoter');
  if (ctx.kind === 'none') {
    return (
      <main className="wrap dashShell">
        <h1 className="adminTitle">Promoter dashboard</h1>
        <div className="emptyState" style={{ marginTop: 20 }}>
          <h3>You’re not on a promoter team yet.</h3>
          <p>
            Run a promoter that’s already on Guestlist? Find it and claim the
            profile — or ask a teammate to invite you.
          </p>
          <Link href="/promoters" className="btnAccent">Browse promoters →</Link>
        </div>
      </main>
    );
  }

  const { active, promoterships } = ctx;
  const q = promoterships.length > 1 ? `?p=${active.id}` : '';

  if (active.claim_status === 'suspended') {
    return (
      <main className="wrap dashShell">
        <h1 className="adminTitle">{active.name}</h1>
        <div className="cancelBanner">
          This promoter account is suspended. Contact Guestlist at
          info@guestlist.net to resolve it.
        </div>
      </main>
    );
  }
  if (active.claim_status !== 'verified') {
    return (
      <main className="wrap dashShell">
        <h1 className="adminTitle">{active.name}</h1>
        <div className="claimStrip" style={{ marginTop: 20 }}>
          Your access is waiting on verification — Guestlist is reviewing the claim.
        </div>
      </main>
    );
  }

  return (
    <main className="wrap dashShell">
      <div className="dashHeader">
        <h1 className="dashTitle">
          {active.name}{' '}
          {active.verified && <span className="verifiedMark" title="Verified">✓</span>}
        </h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {promoterships.length > 1 && (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {promoterships.map((p) => (
                <Link key={p.id} href={`/promoter?p=${p.id}`}
                      style={{ marginRight: 10, color: p.id === active.id ? 'var(--accent)' : undefined }}>
                  {p.name}
                </Link>
              ))}
            </span>
          )}
          <Link className="btnGhost" href={`/promoters/${active.slug}`}>View public page</Link>
        </div>
      </div>
      <nav className="dashNav">
        {TABS.map(([path, label]) => (
          <Link
            key={path}
            href={`/promoter${path}${q}`}
            className={tab === path ? 'active' : ''}
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
