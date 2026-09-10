// What a crawler may read, and where the list of it is.
//
// Everything public is open. What is closed is closed because it is somebody's
// account, an admin desk, or a one-time link — not because we are hiding it:
//
//   /api        machine endpoints, nothing to read
//   /admin      the desk
//   /you        somebody's own account
//   /promoter   a promoter's own dashboard
//   /d/         door tokens — single-use entry links that must never be indexed
//   /notifications, /clubmessenger  signed-in surfaces that redirect to login
//
// Search parameters are excluded too. An event is shared with ?src= on it from
// every button on the site, and each of those looks like a separate page to a
// crawler; the canonical in lib/seo handles it properly, and this stops the
// crawl being spent finding out.

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/', '/admin', '/you', '/promoter', '/d/',
        '/notifications', '/clubmessenger',
        '/login', '/signup', '/verify', '/reset', '/forgot',
        '/*?src=', '/*?days=', '/*?who=',
      ],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
