// YOUR PROFILE — the page behind your own name in the header.
//
// This is the one part of Your Guestlist that is not about you privately: it
// is what every other member sees. It used to sit at the bottom of the
// settings screen between the privacy checkboxes and the email toggles, which
// is the wrong place for the thing with your face on it.
//
// So it shows the profile as others see it, and the form to change it, on one
// page — you edit the thing while looking at it.
//
// The privacy switches and the email settings belong here for the same
// reason: every one of them is an answer to "who sees this, and when do they
// hear from us". Deciding whether your rave history is public while looking at
// your rave history, over on the taste page, was deciding it in the wrong
// place — the question is about the profile, not about the music.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { query } from '@/lib/db';
import { getEmailPrefs, getPrivacy } from '@/lib/privacy';
import { ProfilePanel, SettingsPanel } from '@/components/v2c/YouPanels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your profile · Guestlist', robots: { index: false } };

export default async function YourProfilePage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/you/profile');

  const [profile, privacy, emailPrefs] = await Promise.all([
    query<{
      display_name: string; slug: string | null; avatar_url: string | null;
      bio: string | null; raving_since: number | null; now_doing: string | null;
      looking_for: string | null; email_verified_at: string | null;
    }>(
      `select display_name, slug, avatar_url, bio, raving_since, now_doing,
              looking_for, email_verified_at::text
         from members where id = $1`,
      [member.id]
    ).then((r) => r[0]),
    getPrivacy(member.id),
    getEmailPrefs(member.id),
  ]);

  // Two different reasons a profile is not out there, and they need different
  // answers: one is a switch they chose, the other is an email they have not
  // confirmed yet. Saying "hidden" for both would send somebody hunting
  // through settings for a control that would not have fixed it.
  const unverified = !profile.email_verified_at;
  const hidden = !privacy.profile_public;

  return (
    <main className="wrap youWrap">
      <h1 className="pageTitle">Your profile</h1>
      <p className="pageStandfirst">
        What every other member sees, who gets to see it, and when we email
        you. Your music, your history and your places live under{' '}
        <Link href="/you">You</Link>.
      </p>

      <section className="youPanel profileHeadCard">
        {profile.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="profileHeadAvatar" src={profile.avatar_url} alt="" />
          : <span className="profileHeadAvatar profileHeadAvatarBlank" aria-hidden>
              {profile.display_name.trim().charAt(0).toUpperCase()}
            </span>}
        <div className="profileHeadText">
          <div className="profileHeadName">{profile.display_name}</div>
          {unverified ? (
            <div className="profileHeadNote">
              Not visible yet — <Link href="/verify">confirm your email</Link> and your
              profile goes live.
            </div>
          ) : hidden ? (
            <div className="profileHeadNote">
              Hidden from other members. Turn on <a href="#settings">public profile</a> below to
              be found.
            </div>
          ) : profile.slug ? (
            <Link href={`/members/${profile.slug}`} className="profileHeadLink">
              See it the way everybody else does →
            </Link>
          ) : null}
        </div>
      </section>

      <ProfilePanel initialProfile={profile} />
      <SettingsPanel
        initialPrivacy={privacy as unknown as Record<string, boolean>}
        initialEmailPrefs={emailPrefs as unknown as Record<string, boolean>}
      />
    </main>
  );
}
