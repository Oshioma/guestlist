import Link from 'next/link';

export const metadata = { title: 'Terms & Conditions · Guestlist' };

export default function TermsPage() {
  return (
    <main className="wrap" style={{ maxWidth: 900, paddingBottom: 70 }}>
      <div className="sectionLabel" style={{ marginTop: 34 }}>Legal</div>
      <h1>Terms &amp; Conditions</h1>
      <p className="adminSub">Effective 1 September 2026</p>

      <div className="prose" style={{ maxWidth: 820 }}>
        <p>These Terms govern use of Guestlist, an event-discovery and community platform operated through Guestlist websites and related services. By creating an account, submitting content or using the service, you agree to these Terms.</p>

        <h2>1. Accounts and community</h2>
        <p>You must provide accurate account information and keep access to your account secure. You are responsible for activity carried out through your account. Use Guestlist lawfully and respectfully: do not harass others, impersonate people or organisations, manipulate platform features, introduce malicious material, scrape the service in a way that harms it, or use it to facilitate unlawful activity.</p>

        <h2>2. Event information and external tickets</h2>
        <p>Guestlist gathers event information from organisers, promoters, members, public event sources and other third parties. We work to keep listings useful and current, but dates, line-ups, venues, prices, availability and event status can change. Check important details with the organiser or ticket provider before travelling or spending money.</p>
        <p>Guestlist often links to third-party organisers and ticket sellers. Unless Guestlist expressly states that it is the seller, any ticket purchase is a transaction between you and that third-party provider and is subject to that provider’s terms, refunds and admission rules.</p>

        <h2>3. Guestlists</h2>
        <p>Promoters and organisers may operate guestlists through Guestlist, and Guestlist may allow members to request places. A confirmation does not guarantee entry. Venue capacity, arrival deadlines, identification, dress or conduct rules, age restrictions and the organiser or venue’s final admission decision still apply.</p>

        <h2>4. Promoters and organisers</h2>
        <p>People claiming or managing promoter profiles must be authorised to act for that promoter. Organisers are responsible for information they submit, guestlist decisions they make and their lawful handling of member information made available to operate an event or guestlist.</p>

        <h2>5. Balance, Event Features and other member content</h2>
        <p>Members may submit articles, Event Features, comments, images, flyers, archive material and other contributions where those features are available. Content may be reviewed, edited with permission where appropriate, labelled, rejected, unpublished, archived or removed under Guestlist’s editorial and community standards.</p>
        <p>You retain ownership of content you create. By submitting it to Guestlist, you grant Guestlist a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, display, distribute, format and promote that content as part of operating and promoting the Guestlist service. This licence lasts for as long as the content is hosted or reasonably required for backups, records and prior lawful distributions.</p>
        <p>You must have the rights and permissions needed for anything you upload or submit. Do not submit material that infringes copyright, privacy, publicity or other rights. Where Guestlist offers AI-assisted writing or image-discovery tools, the author remains responsible for checking factual accuracy, suitability and rights before publication.</p>

        <h2>6. Guestlist material and intellectual property</h2>
        <p>Guestlist’s name, branding, software, original editorial material, design and platform features are protected by intellectual-property law. Except for normal use of the service, you may not copy, resell, reverse engineer or commercially exploit them without permission. Third-party names, images, music, event artwork and trademarks remain the property of their respective owners.</p>

        <h2>7. Third-party services</h2>
        <p>The service may connect to or display material from ticketing platforms, social networks, mapping providers, image providers, video services and other third parties. Their services have their own terms and privacy practices. Guestlist is not responsible for a third party’s availability, content, fulfilment or decisions.</p>

        <h2>8. Availability and changes</h2>
        <p>We may change, improve, suspend or discontinue features, integrations or parts of the service. We do not promise uninterrupted or error-free availability, although we take reasonable steps to operate the service securely and reliably.</p>

        <h2>9. Suspension and termination</h2>
        <p>We may restrict, suspend or terminate accounts or promoter access where reasonably necessary to protect users, enforce these Terms, respond to legal requirements, prevent abuse or protect the service. You may stop using Guestlist and may request account or data deletion subject to legal, security and record-keeping requirements.</p>

        <h2>10. Liability</h2>
        <p>Nothing in these Terms excludes liability that cannot lawfully be excluded. To the extent permitted by law, Guestlist is not liable for indirect or consequential losses, event cancellations, refused venue admission, third-party ticket transactions, third-party content or losses caused by information outside Guestlist’s reasonable control. You remain responsible for your own travel, purchases and decisions based on event information.</p>

        <h2>11. Privacy</h2>
        <p>Our <Link href="/privacy">Privacy Policy</Link> explains how Guestlist handles personal information.</p>

        <h2>12. Changes to these Terms</h2>
        <p>We may update these Terms as the service changes. Material changes will be reflected by an updated effective date and, where appropriate, an in-product notice.</p>

        <h2>13. Governing law and contact</h2>
        <p>These Terms are governed by the laws of England and Wales. The courts of England and Wales have jurisdiction, subject to any mandatory rights you have under applicable consumer law. Questions can be sent to <a href="mailto:info@guestlist.net">info@guestlist.net</a>.</p>
      </div>
    </main>
  );
}
