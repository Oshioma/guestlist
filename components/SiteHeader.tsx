import Link from 'next/link';
import { getCurrentMember } from '@/lib/auth';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { queryOne } from '@/lib/db';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getNavVisibility } from '@/lib/settings';
import { getMembership, membershipIsActive } from '@/lib/membership';
import { getMemberBusinesses } from '@/lib/marketAuth';

export async function SiteHeader() {
  const member = await getCurrentMember();
  const [promoterships, businesses, membership] = member
    ? await Promise.all([getMemberPromoters(member.id), getMemberBusinesses(member.id), getMembership(member.id)])
    : [[], [], null];
  const isMember = membershipIsActive(membership);
  const nav = await getNavVisibility();
  const unread = member
    ? (await queryOne<{ n: number }>(
        `select count(*)::int as n from notifications where member_id = $1 and read_at is null`,
        [member.id]
      ))?.n ?? 0
    : 0;
  return (
    <header className="siteHeader">
      <div className="headerMain">
        <div className="wrap inner">
          <Link href="/" className="brand" aria-label="Guestlist — home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brandWordmark brandOnLight" src="/brand/Guestlist_purple_300dpi.png" alt="GUESTLIST" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brandWordmark brandOnDark" src="/brand/Guestlist_white_72dpi.png" alt="" aria-hidden />
          </Link>
          <nav className="mainNav">
            <Link href="/events">Events</Link>
            <Link href="/clubmessenger">Tonight</Link>
            {member && nav.people && <Link href="/people">People</Link>}
            {nav.explore && <Link href="/explore">Explore</Link>}
            <Link href="/archive">Archive</Link>
            <Link href="/balance">Balance</Link>
            <Link href="/promoters">Promoters</Link>
            <Link href="/market">Market</Link>
            {/* Membership is sold to people who don't have it; members find
                theirs under You. */}
            {!isMember && <Link href="/membership">Membership</Link>}
            {member && <Link href="/you">You</Link>}
            {promoterships.length > 0 && <Link href="/promoter">Dashboard</Link>}
            {businesses.length > 0 && <Link href="/business">Business</Link>}
          </nav>
          <div className="headerRight">
            <ThemeToggle />
            {member ? (
              <>
                <Link href="/notifications" className="bellLink" title="Notifications"
                      aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}>
                  <svg className="bellIcon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 1.75a1.25 1.25 0 0 1 1.25 1.25v.63a6.25 6.25 0 0 1 5 6.12v3.11c0 .4.14.79.4 1.1l1.24 1.5c.66.79.1 2-.93 2H5.04c-1.03 0-1.6-1.21-.93-2l1.24-1.5c.26-.31.4-.7.4-1.1V9.75a6.25 6.25 0 0 1 5-6.12V3A1.25 1.25 0 0 1 12 1.75Z"/>
                    <path d="M9.4 19.25h5.2a2.6 2.6 0 0 1-5.2 0Z"/>
                  </svg>
                  {unread > 0 && <span className="bellBadge">{unread > 99 ? '99+' : unread}</span>}
                </Link>
                <span className="avatarChip">
                  {member.avatar_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.avatar_url} alt="" />
                  )}
                  {member.display_name.split(' ')[0]}
                </span>
              </>
            ) : (
              <Link href="/login" className="btnGhost">Sign in</Link>
            )}
          </div>
        </div>
      </div>
      {member && (
        <div className="headerUnderbar">
          <div className="wrap headerUnderbarInner">
            {/* Admin lives down here, not in the nav: the main navigation
                should read exactly as a member sees it. */}
            {member.role === 'admin' && <Link href="/admin/events" className="signOutLink">Admin</Link>}
            <form action="/api/auth/logout" method="post">
              <button className="signOutLink" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
