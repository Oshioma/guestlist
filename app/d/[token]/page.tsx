// THE PASS ITSELF.
//
// What the QR code opens: one screen, read at a door, in the dark, by somebody
// who has thirty seconds. So it is a name, a count, and a verdict, in that
// order and at that size — and underneath, the thing a promoter actually
// wants to know: who on their team put this person on the list.
//
// Anyone with the link can read it. That is what a pass is. Checking somebody
// in is the part that needs a signed-in member of the promoter's team, and the
// button only appears for one.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { doorPass } from '@/lib/doorPass';
import { fmtEventDate, fmtEventTime } from '@/lib/util';
import { CheckInButton } from '@/components/door/CheckInButton';

export const dynamic = 'force-dynamic';

// A door pass is nobody's business but the door's.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DoorPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pass = await doorPass(token);
  if (!pass) notFound();

  const member = await getCurrentMember();
  const onTheTeam = member
    ? (await getMemberPromoters(member.id)).some((p) => p.id === pass.promoterId)
    : false;

  const valid = pass.status === 'confirmed';
  const arrived = !!pass.checkedInAt;
  const verdict = !valid
    ? { text: pass.status === 'pending' ? 'NOT CONFIRMED YET' : 'NOT VALID', tone: 'bad' as const }
    : arrived
      ? { text: 'ALREADY CHECKED IN', tone: 'warn' as const }
      : { text: 'ON THE GUESTLIST', tone: 'good' as const };

  return (
    <main className="doorPass">
      <div className="doorPassInner">
        <div className={`doorVerdict ${verdict.tone}`}>{verdict.text}</div>

        <div className="doorName">{pass.guestName}</div>
        <div className="doorPlaces">{`${pass.places} ${pass.places === 1 ? 'place' : 'places'}`}</div>

        <div className="doorEvent">
          <div className="doorEventTitle">{pass.eventTitle}</div>
          <div className="doorEventMeta">
            {fmtEventDate(pass.startAt, pass.endAt, pass.timezone)}
            {' · '}{fmtEventTime(pass.startAt, pass.endAt, pass.timezone)}
            {[pass.venueName, pass.city].filter(Boolean).length > 0 && (
              <><br />{[pass.venueName, pass.city].filter(Boolean).join(', ')}</>
            )}
          </div>
        </div>

        {/* The question a promoter asks about a name they do not recognise. */}
        <dl className="doorFacts">
          <div><dt>Promoter</dt><dd>{pass.promoterName}</dd></div>
          <div>
            <dt>Confirmed by</dt>
            <dd>{pass.confirmedBy ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Via</dt>
            <dd>{pass.source === 'guestlist' ? 'Guestlist' : pass.source.replace(/_/g, ' ')}</dd>
          </div>
          {arrived && (
            <div>
              <dt>Checked in</dt>
              <dd>{new Date(pass.checkedInAt!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            </div>
          )}
        </dl>

        {onTheTeam ? (
          <CheckInButton token={token} initialCheckedIn={arrived} disabled={!valid} />
        ) : (
          <p className="doorFoot">
            {member
              ? 'Only this promoter’s team can check a guest in.'
              : <>Door staff: <Link href={`/login?next=/d/${token}`}>sign in</Link> to check this guest in.</>}
          </p>
        )}

        <p className="doorFoot">
          <Link href={`/events/${pass.eventSlug}`}>See the event</Link>
        </p>
      </div>
    </main>
  );
}
