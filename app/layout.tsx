import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getCurrentMember } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Guestlist',
  description:
    'Guestlist — curated events, nights and experiences for the generation that grew up on rave culture.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme is a per-visitor choice (cookie) so the server renders the right
  // palette with no flash. Light is the default; dark is the original look.
  const theme = (await cookies()).get('gl_theme')?.value === 'dark' ? 'dark' : undefined;
  // The footer belongs to the site, not to the homepage. Somebody thinking
  // "you're missing a night" is rarely on the front page when they think it.
  const member = await getCurrentMember().catch(() => null);
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter isSignedIn={!!member} isAdmin={member?.role === 'admin'} />
      </body>
    </html>
  );
}
