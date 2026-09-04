// ADMIN → RETREATS. What sits under "Quiet the brain" on Balance.

import Link from 'next/link';
import { allRetreats } from '@/lib/retreats';
import { NewRetreat, RetreatRow } from '@/components/admin/RetreatDesk';

export const dynamic = 'force-dynamic';

export default async function AdminRetreatsPage() {
  const retreats = await allRetreats();
  const live = retreats.filter((r) => r.status === 'live').length;

  return (
    <main>
      <h1 className="adminTitle">Retreats</h1>
      <p className="adminSub">
        Paste a retreat’s link and we read the page for you — name, picture, where, the description.
        Check it, say when it runs, set it live, and it appears on{' '}
        <Link href="/balance" style={{ textDecoration: 'underline' }}>Balance</Link> under “Quiet the brain”.
        Cards send people straight to the retreat’s own site to book.
      </p>
      <NewRetreat />

      <div style={{ marginTop: 16 }}>
        {retreats.map((r) => (
          <div className="attentionRow" key={r.id} style={{ flexWrap: 'wrap' }}>
            <span>
              <b>{r.title}</b>{' '}
              <span className={`evChip ${r.status === 'live' ? 'green' : r.status === 'draft' ? 'amber' : ''}`}>{r.status}</span>
              <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                {[r.location, r.when_text, r.price_text].filter(Boolean).join(' · ') || 'No where, no when, no price'}
              </div>
              <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>
                {!r.image_url && ' · no picture'}
              </div>
            </span>
            <RetreatRow initial={{
              id: r.id, title: r.title, location: r.location ?? '', whenText: r.when_text ?? '',
              blurb: r.blurb ?? '', imageUrl: r.image_url ?? '', url: r.url, priceText: r.price_text ?? '',
              status: r.status, sortOrder: String(r.sort_order), sourceUrl: r.source_url ?? '',
            }} />
          </div>
        ))}
        {retreats.length === 0 && (
          <p className="adminSub">
            Nothing yet. Balance shows no retreats section at all until one is live, so the page never
            carries an empty heading.
          </p>
        )}
        {retreats.length > 0 && live === 0 && (
          <p className="adminSub">Nothing is live, so “Quiet the brain” is not on Balance yet.</p>
        )}
      </div>
    </main>
  );
}
