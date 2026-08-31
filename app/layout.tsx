import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Guestlist',
  description:
    'Guestlist — curated events, nights and experiences for the generation that grew up on rave culture.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme is a per-visitor choice (cookie) so the server renders the right
  // palette with no flash. Light is the default; dark is the original look.
  const theme = (await cookies()).get('gl_theme')?.value === 'dark' ? 'dark' : undefined;
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
