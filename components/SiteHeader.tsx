import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { queryOne } from '@/lib/db';

export async function SiteHeader() {
  const member = await getCurrentMember();
  const promoterships = member ? await getMemberPromoters(member.id) : [];
  const unread = member
    ? (await queryOne<{ n: number }>(
        `select count(*)::int as n from notifications where member_id = $1 and read_at is null`,
        [member.id]
      ))?.n ?? 0
    : 0;
  return (
    <header className="siteHeader">
      <div className="wrap inner">
        <Link href="/" className="brand">
          Guest<span>list</span>
        </Link>
        <nav className="mainNav">
          <Link href="/events">Events</Link>
          <Link href="/clubmessenger">Tonight</Link>
          {member && <Link href="/people">People</Link>}
          <Link href="/explore">Explore</Link>
          <Link href="/archive">Archive</Link>
          <Link href="/promoters">Promoters</Link>
          {member && <Link href="/you">You</Link>}
          <Link href="/events/submit">+ Add Event</Link>
          {promoterships.length > 0 && <Link href="/promoter">Dashboard</Link>}
          {member?.role === 'admin' && <Link href="/admin/events">Admin</Link>}
        </nav>
        <div className="headerRight">
          {member ? (
            <>
              <Link href="/notifications" className="bellLink" title="Notifications">
                🔔{unread > 0 && <span className="bellBadge">{unread > 99 ? '99+' : unread}</span>}
              </Link>
              <span className="avatarChip">
                {member.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.avatar_url} alt="" />
                )}
                {member.display_name}
              </span>
              <form action="/api/auth/logout" method="post">
                <button className="btnGhost" type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btnGhost">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
