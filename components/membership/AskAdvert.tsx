// THE PROMISE, AS AN ADVERT RATHER THAN A SENTENCE.
//
// The line that says what Guestlist is for sat in a 30ch measure with a grey
// "Terms apply*" under it and then a third of a screen of nothing. A sentence
// with no ask attached is a slogan; this gives it somewhere to go.
//
// Two versions, because advertising a subscription to somebody who already
// pays for it is the quickest way to look like we do not know who they are:
// a member is told how to use the thing, not asked to buy it again.

import Link from 'next/link';

export function AskAdvert({
  isMember, billingLive, price,
}: { isMember: boolean; billingLive: boolean; price: string }) {
  return (
    <div className={`askAd${isMember ? ' isMember' : ''}`}>
      <div className="askAdKicker">{isMember ? 'Your membership' : 'Guestlist membership'}</div>

      <p className="askAdLine">
        Ask us to get you on the guestlist to <b>ANY</b> event.
        <span className="askAdLineQuiet"> We work out the rest.</span>
      </p>

      <ul className="askAdList">
        <li>Free entrance to parties whenever we can make it happen</li>
        <li>Priority access when a night sells out</li>
        <li>Discounts and offers members-only</li>
      </ul>

      {/* Pushed to the bottom of the panel, so the advert fills its column
          instead of stopping halfway down it. */}
      <div className="askAdFoot">
        {isMember ? (
          <>
            <Link href="/events" className="btnAccent askAdBtn">Find a night →</Link>
            <p className="askAdTerms">
              Open any event and press <b>Get me in</b>.{' '}
              <Link href="/membership/terms">Terms apply*</Link>
            </p>
          </>
        ) : (
          <>
            <Link href="/membership" className="btnAccent askAdBtn">
              {billingLive ? `Join — ${price}/month` : 'Join the waitlist'}
            </Link>
            <p className="askAdTerms">
              Subject to availability and fair use.{' '}
              <Link href="/membership/terms">Terms apply*</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
