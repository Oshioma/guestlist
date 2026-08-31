import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/admin/events');
  if (member.role !== 'admin') redirect('/events');

  return (
    <div className="wrap adminShell">
      <nav
        className="mainNav"
        style={{ paddingTop: 22, borderBottom: '1px solid var(--border)', paddingBottom: 14 }}
      >
        <span style={{ color: 'var(--accent-ink, var(--accent))', fontWeight: 700 }}>Admin</span>
        <Link href="/admin/events">Events</Link>
        <Link href="/admin/promoters">Promoters</Link>
        <Link href="/admin/sources">Sources</Link>
        <Link href="/admin/supply">Supply</Link>
        <Link href="/admin/genre-suggestions">Genres</Link>
        <Link href="/admin/clubmessenger">Club</Link>
        <Link href="/admin/network">Network</Link>
        <Link href="/admin/email">Email</Link>
        <Link href="/admin/archive">Archive</Link>
        <Link href="/admin/promoter-comms">Comms</Link>
        <Link href="/admin/guestlist-x">@guestlist</Link>
        <Link href="/admin/events/new">+ New Event</Link>
      </nav>
      {children}
    </div>
  );
}
