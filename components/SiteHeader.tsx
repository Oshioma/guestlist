import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';

export async function SiteHeader() {
  const member = await getCurrentMember();
  return (
    <header className="siteHeader">
      <div className="wrap inner">
        <Link href="/" className="brand">
          Guest<span>list</span>
        </Link>
        <nav className="mainNav">
          <Link href="/events">Events</Link>
          <Link href="/events/submit">+ Add Event</Link>
          {member?.role === 'admin' && <Link href="/admin/events">Admin</Link>}
        </nav>
        <div className="headerRight">
          {member ? (
            <>
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
