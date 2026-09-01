import Link from 'next/link';

export const metadata = { title: 'Privacy Policy · Guestlist' };

export default function PrivacyPage() {
  return (
    <main className="wrap" style={{ maxWidth: 900, paddingBottom: 70 }}>
      <div className="sectionLabel" style={{ marginTop: 34 }}>Legal</div>
      <h1>Privacy Policy</h1>
      <p className="adminSub">Effective 1 September 2026 · Last updated 1 September 2026</p>

      <div className="prose" style={{ maxWidth: 820 }}>
        <p>This policy explains how Guestlist handles personal information when you use its event-discovery, community, editorial, promoter and guestlist services.</p>

        <h2>Information we collect</h2>
        <p>Depending on how you use Guestlist, we may process account and profile details such as name, email address, avatar, home city, preferences and profile settings; login, session and security information; event saves, follows, RSVPs and other discovery activity; event submissions; promoter-team and organiser information; guestlist requests and entries; articles, Balance contributions, Event Features, images and other material you submit; archive or “I Was There” contributions where those features are available; and messages, reports or support requests.</p>
        <p>We may also collect technical and usage data such as device/browser information, timestamps, pages viewed, security logs, approximate location where available, and analytics about how features perform.</p>

        <h2>Event discovery and source ingestion</h2>
        <p>Guestlist may collect event information from organiser websites, ticketing pages and other public event sources in order to build and maintain listings. Public pages can sometimes contain names, photographs or professional contact information relating to artists, promoters or organisers. We use that information only where relevant to operating the event-discovery service and apply moderation and correction processes.</p>

        <h2>Guestlists and sharing with organisers</h2>
        <p>When you ask to join a guestlist, or are added to one, Guestlist may share the information necessary to operate that guestlist with the relevant organiser or promoter. This can include your name, number of guests, request or confirmation status and attendance/check-in information.</p>
        <p>Promoters and organisers that receive or export guest information are responsible for using it lawfully, securely and only for appropriate event and guestlist purposes.</p>

        <h2>Articles, images and community contributions</h2>
        <p>Content you choose to publish can be visible publicly together with attribution such as your display name. Drafts, moderation notes and revision history may be retained to operate the editorial workflow, resolve disputes and protect the integrity of published material. Submitted images may be stored by Guestlist or, where a licensed image service permits it, displayed from that provider with attribution.</p>

        <h2>Follows, social and community features</h2>
        <p>Guestlist may use follows, saved events, attendance signals, music or event preferences and similar activity to personalise discovery and help show relevant people, promoters and events. Visibility is subject to the privacy and community controls available in the product.</p>

        <h2>Ticket and referral-link tracking</h2>
        <p>Guestlist may record when a user clicks an external ticket or event link. We use this to understand referral traffic, measure service performance, improve recommendations and show organisers how Guestlist contributes to event discovery. The external provider may separately collect information under its own privacy policy.</p>

        <h2>Why we use personal information</h2>
        <p>We use information to provide and personalise Guestlist; authenticate accounts; operate event, guestlist, promoter, editorial and community features; communicate about the service; moderate content; prevent fraud and abuse; keep the service secure; understand usage and referral performance; comply with law; and establish, exercise or defend legal rights.</p>
        <p>Where UK data-protection law applies, our legal bases can include performing our contract with you, legitimate interests in operating and improving the service, consent where required, and compliance with legal obligations.</p>

        <h2>Service providers and third parties</h2>
        <p>We use service providers for hosting, databases, email, analytics, security, image services, AI-assisted features and other infrastructure. They receive only the information reasonably needed to provide their service and are subject to appropriate contractual or technical safeguards. Guestlist also links to third-party ticketing, social, video, mapping and organiser services whose own privacy policies apply when you use them.</p>

        <h2>Security</h2>
        <p>We use reasonable technical and organisational safeguards designed to protect personal information, including access controls and server-side protection for privileged credentials. No online service can guarantee absolute security.</p>

        <h2>Retention</h2>
        <p>We keep information only for as long as reasonably necessary for the purposes described here, including operating accounts and published content, maintaining security and audit records, resolving disputes and meeting legal obligations. Different categories can have different retention periods. Backup copies may remain for a limited period after deletion.</p>

        <h2>Your rights and deletion</h2>
        <p>Depending on where you live, you may have rights to access, correct, delete, restrict or object to processing of your personal information, and in some cases receive a portable copy or withdraw consent. You can also ask us to close an account or correct event/profile information. Send privacy requests to <a href="mailto:info@guestlist.net">info@guestlist.net</a>. We may need to verify your identity before completing a request.</p>

        <h2>Legal disclosures and international processing</h2>
        <p>We may disclose information where required by law, to protect users or the service, in connection with a corporate transaction, or to establish or defend legal rights. Service providers may process data in countries other than your own; where required, we use recognised safeguards for international transfers.</p>

        <h2>Children</h2>
        <p>Guestlist is intended for people old enough to use nightlife and community services lawfully in their location. It is not directed at children under 13, and event or venue age restrictions may be higher. We do not knowingly seek to collect personal information from children who cannot lawfully consent to the service.</p>

        <h2>Changes and contact</h2>
        <p>We may update this policy as Guestlist evolves. The current version and update date will be shown on this page. Questions or privacy requests should be sent to <a href="mailto:info@guestlist.net">info@guestlist.net</a>. See also our <Link href="/terms">Terms &amp; Conditions</Link>.</p>
      </div>
    </main>
  );
}
