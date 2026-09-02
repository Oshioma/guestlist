import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { SetYourCity } from '@/components/SetYourCity';
import { ConfirmYourEmail } from '@/components/auth/ConfirmYourEmail';
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
        {/* A member with no resolved place is, to Guestlist, nowhere. Asked
            once a visit until they answer — see components/SetYourCity. */}
        {member && !member.home_location_id && <SetYourCity />}
        {/* An unproved address is not a locked account — they can use
            everything. It is a profile nobody else can find yet, and that is
            what the ask explains. */}
        {member && !member.email_verified_at && <ConfirmYourEmail />}
        {children}
        <SiteFooter isSignedIn={!!member} isAdmin={member?.role === 'admin'} />
      </body>
    </html>
  );
}
