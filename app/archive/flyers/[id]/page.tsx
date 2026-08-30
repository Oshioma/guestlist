// A flyer as cultural object: the image plus the structured night around
// it — never just a picture.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function FlyerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flyer = await queryOne<{ id: string; event_slug: string | null }>(
    `select m.id, e.slug as event_slug
       from archive_media m
       join archive_items i on i.id = m.item_id and i.status = 'published'
       left join archive_events e on e.id = i.archive_event_id and e.status = 'published'
      where m.id = $1 and not m.hidden`,
    [id]
  );
  if (!flyer) notFound();
  // A flyer's home is its night — the event page carries the full context
  // (structured facts, I WAS THERE, memories, the scene, the now).
  if (flyer.event_slug) redirect(`/archive/events/${flyer.event_slug}`);
  return (
    <main className="wrap archiveWrap">
      <Link href="/archive" className="clubBack">← The Archive</Link>
      <p className="youPanelSub" style={{ marginTop: 20 }}>
        This artefact isn’t attached to a night yet — the Guestlist team is on it.
      </p>
    </main>
  );
}
