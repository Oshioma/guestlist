'use client';

// The admin bar. Fourteen destinations in one flat row overflowed the page
// and gave no sense of where you were, so they are grouped by what they are
// for, wrap instead of running off the edge, and the current page is marked.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string };

const GROUPS: { name: string; items: Item[] }[] = [
  {
    name: 'Supply',
    items: [
      { href: '/admin/events', label: 'Events' },
      { href: '/admin/sources', label: 'Sources' },
      { href: '/admin/supply', label: 'Supply' },
      { href: '/admin/genre-suggestions', label: 'Genres' },
    ],
  },
  {
    name: 'Editorial',
    items: [
      { href: '/admin/articles', label: 'Articles' },
      { href: '/admin/archive', label: 'Archive' },
      { href: '/admin/video-archive', label: 'Video' },
    ],
  },
  {
    name: 'Community',
    items: [
      { href: '/admin/promoters', label: 'Promoters' },
      { href: '/admin/clubmessenger', label: 'Club' },
      { href: '/admin/network', label: 'Network' },
    ],
  },
  {
    name: 'Membership',
    items: [
      { href: '/admin/getmein', label: 'Requests' },
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/market', label: 'Market' },
      { href: '/admin/drops', label: 'Drops' },
    ],
  },
  {
    name: 'Comms',
    items: [
      { href: '/admin/email', label: 'Email' },
      { href: '/admin/promoter-comms', label: 'Comms' },
      { href: '/admin/guestlist-x', label: '@guestlist' },
    ],
  },
  {
    name: 'System',
    items: [
      { href: '/admin/site', label: 'Site' },
      { href: '/admin/systems', label: 'Systems' },
      { href: '/admin/schema', label: 'Database' },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname() ?? '';
  // /admin/events/new belongs to its own button, not to the Events tab.
  const isCurrent = (href: string) =>
    pathname === href || (pathname.startsWith(`${href}/`) && pathname !== '/admin/events/new');

  return (
    <nav className="adminNav" aria-label="Admin">
      <span className="adminNavBrand">Admin</span>
      <div className="adminNavGroups">
        {GROUPS.map((group) => (
          <div className="adminNavGroup" key={group.name} aria-label={group.name}>
            <span className="adminNavGroupLabel">{group.name}</span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`adminNavLink${isCurrent(item.href) ? ' active' : ''}`}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <Link href="/admin/events/new" className="adminNavNew">+ New event</Link>
    </nav>
  );
}
