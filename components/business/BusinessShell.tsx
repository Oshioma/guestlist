// Business portal chrome — the promoter DashShell pattern for Market
// businesses. Operational, mobile-first, and honest about status: an
// applicant sees their application, an approved business sees its tools.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { BusinessDashContext } from '@/lib/marketAuth';

const TABS = [
  ['', 'Overview'],
  ['/profile', 'Listing'],
  ['/offers', 'Offers'],
  ['/redeem', 'Redeem'],
  ['/stats', 'Stats'],
] as const;

export function BusinessShell({ ctx, tab, children }: { ctx: BusinessDashContext; tab: string; children: React.ReactNode }) {
  if (ctx.kind === 'anon') redirect('/login?next=/business');
  if (ctx.kind === 'none') {
    return (
      <main className="wrap dashShell">
        <h1 className="adminTitle">Business portal</h1>
        <div className="emptyState" style={{ marginTop: 20 }}>
          <h3>You don’t manage a business on Guestlist yet.</h3>
          <p>Run an independent business you’d like Guestlist members to know about? Apply to join the Market — Guestlist chooses who’s in.</p>
          <Link href="/market/apply" className="btnAccent">Apply to join Guestlist Market →</Link>
        </div>
      </main>
    );
  }
  const { active, businesses } = ctx;
  const q = businesses.length > 1 ? `?b=${active.id}` : '';
  const pending = active.status === 'applied' || active.status === 'pending' || active.status === 'invited';
  return (
    <main className="wrap dashShell">
      <div className="dashHeader">
        <h1 className="dashTitle">{active.name}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {businesses.length > 1 && (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {businesses.map((b) => (
                <Link key={b.id} href={`/business?b=${b.id}`} style={{ marginRight: 10, color: b.id === active.id ? 'var(--accent)' : undefined }}>{b.name}</Link>
              ))}
            </span>
          )}
          {active.status === 'approved' && <Link className="btnGhost" href={`/market/${active.slug}`}>View in the Market</Link>}
        </div>
      </div>
      {pending && (
        <div className="claimStrip" style={{ marginBottom: 14 }}>
          {active.status === 'invited'
            ? 'Guestlist has invited you into the Market. Fill in your listing and offer and we’ll switch you on.'
            : 'Your application is with Guestlist. You can keep polishing your listing and offer while we look.'}
        </div>
      )}
      {active.status === 'paused' && <div className="cancelBanner">Your listing is paused and hidden from members. Contact info@guestlist.net if you think that’s a mistake.</div>}
      {active.status === 'rejected' && <div className="cancelBanner">Guestlist didn’t bring this business into the Market this time.</div>}
      <nav className="dashNav">
        {TABS.map(([path, label]) => (
          <Link key={path} href={`/business${path}${q}`} className={tab === path ? 'active' : ''}>{label}</Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
