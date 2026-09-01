import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { AdminNav } from '@/components/admin/AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/admin/events');
  if (member.role !== 'admin') redirect('/events');
  return (
    <div className="wrap adminShell">
      <AdminNav />
      {children}
    </div>
  );
}
