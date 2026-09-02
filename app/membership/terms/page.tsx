import Link from 'next/link';

export const metadata = { title: 'Membership Terms · Guestlist' };

// Plain English. Everything the product promises, and where the edges are.
// The sales page stays confident because this page exists.

export default function MembershipTermsPage() {
  return (
    <main className="wrap" style={{ maxWidth: 900, paddingBottom: 70 }}>
      <div className="sectionLabel" style={{ marginTop: 34 }}>Legal</div>
      <h1>Guestlist Membership Terms</h1>
      <p className="adminSub">Effective 1 September 2026 · These terms add to the <Link href="/terms">Guestlist Terms &amp; Conditions</Link>.</p>

      <div className="prose" style={{ maxWidth: 820 }}>
        <h2>1. What membership is</h2>
        <p>Guestlist Membership is a paid membership of the Guestlist community. It costs <strong>£30 per month</strong> (or the price shown when you join), billed monthly in advance, and renews automatically each month until you cancel. Membership gives you access to the benefits described on the membership page: asking Guestlist to arrange free entrance to events (GET ME IN), priority or fast-track entrance where available, member prices, Guestlist Market offers from independent businesses, member drops, and participation in the community projects Guestlist supports.</p>

        <h2>2. Getting in free — how it works</h2>
        <p>As a member you can ask Guestlist to get you into an event listed on Guestlist. We will try to arrange complimentary entrance through the event’s promoter or organiser, the venue, allocations Guestlist holds, by purchasing access where we consider that reasonable, or through other legitimate means. Where we cannot arrange free entrance we may be able to arrange a discounted ticket or a Guestlist member price instead.</p>
        <p><strong>Free event access is subject to availability.</strong> Not every event is included. Guestlist does not guarantee entry to any specific event, and complimentary entry is at Guestlist’s discretion. Whether we can get you in depends on the event, our relationship with its promoter, allocations, ticket cost, timing and reasonable use. Unusually expensive or premium events, festivals, VIP areas, special events and events with very limited capacity may be excluded, or offered at a discount rather than free. Requests made very close to an event may not be possible to fulfil. A “+1” may be requested but is never guaranteed.</p>
        <p>When Guestlist confirms a place for you, we place you on the organiser’s guestlist or provide the ticket or access we have arranged. Event organisers and venues keep the final right of admission: age restrictions, ID checks, dress and conduct policies, arrival deadlines, capacity and the venue’s own rules still apply, and Guestlist is not responsible for refused admission on those grounds.</p>

        <h2>3. Fair use</h2>
        <p>Membership is built on Guestlist using its judgement to look after members. There is no fixed number of free events. In return, we ask that requests are reasonable. Guestlist may decline, limit or prioritise requests that are unusually frequent, unusually costly, made for events you do not attend, or otherwise outside reasonable use of the membership. We will always try to tell you why. We do not automatically restrict members by formula; decisions are made by people at Guestlist.</p>

        <h2>4. Queue jump and priority entrance</h2>
        <p>Priority, fast-track or queue-jump entrance is offered by participating events and venues and only applies where it is available. It is not offered at every event and may be withdrawn by the organiser or venue at any time.</p>

        <h2>5. Guestlist Market and member offers</h2>
        <p>Guestlist Market offers are provided by independent businesses selected by Guestlist. Each offer has its own terms, set by that business, which are shown with the offer. The business — not Guestlist — is responsible for the goods and services it supplies, including their quality, availability, safety and any refunds. Offers can change or end at any time, and membership does not guarantee that any particular offer or business will remain available. Claim codes are for the member who claimed them and cannot be sold, transferred or shared.</p>

        <h2>6. Member drops and community projects</h2>
        <p>Member drops are occasional and discretionary; they may be limited in number and offered on a first-come basis. Where Guestlist describes community projects supported by the membership, the details of each project are as published on the site at the time; Guestlist will not make claims about contributions that it does not make.</p>

        <h2>7. Your membership account</h2>
        <p>Membership is personal to you and attached to your Guestlist account. Sharing your account or membership benefits, reselling or transferring places, codes or tickets arranged for you, using benefits fraudulently or providing false information may result in suspension or termination of your membership without refund of the current month, and may result in suspension of your Guestlist account.</p>

        <h2>8. Payment, renewal and cancellation</h2>
        <p>Payments are taken by our payment provider (Stripe) using the card you provide. Your membership renews automatically each month until cancelled. You can cancel at any time from your membership page; cancellation stops future renewals and your membership continues until the end of the period you have already paid for, in accordance with the payment provider’s billing terms. If a payment fails we will let you know and retry it; if it cannot be collected your membership will lapse. Guestlist may change the membership price with reasonable notice; any change applies from your next renewal after that notice, and you may cancel before it takes effect. Complimentary memberships granted by Guestlist may carry an expiry date and may be withdrawn by Guestlist.</p>

        <h2>9. Changes to the membership</h2>
        <p>Guestlist may add, change or remove benefits, participating events, venues, businesses and offers as the membership develops. Material changes will be reflected on the membership page and, where appropriate, told to members directly.</p>

        <h2>10. Liability</h2>
        <p>Nothing in these terms excludes liability that cannot lawfully be excluded. To the extent permitted by law, Guestlist is not liable for refused admission, event cancellations or changes, the acts or omissions of promoters, venues or Market businesses, or for indirect or consequential loss. Where Guestlist has purchased a ticket on your behalf, the ticket seller’s terms also apply to that ticket.</p>

        <h2>11. Your statutory rights</h2>
        <p>These terms do not affect your statutory rights as a consumer, including rights relating to cancellation, faulty services and unfair terms under the laws of England and Wales.</p>

        <h2>12. Contact</h2>
        <p>Questions about membership can be sent to <a href="mailto:info@guestlist.net">info@guestlist.net</a>.</p>
      </div>
    </main>
  );
}
