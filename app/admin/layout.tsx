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
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Admin</span>
        <Link href="/admin/events">Events</Link>
        <Link href="/admin/sources">Sources</Link>
        <Link href="/admin/events/new">+ New Event</Link>
      </nav>
      {children}
    </div>
  );
}
