// The membership pictures, back on the page. One sits behind the hero
// headline (see MembershipHeroImage); these five run as a captioned strip
// underneath it, one per benefit, so the page has faces and rooms in it
// and not only cards. Every picture is a slot an admin can change on
// ADMIN → Site without a deploy.

import { siteImages } from '@/lib/siteImages';

const STRIP: { key: string; caption: string }[] = [
  { key: 'membership.ask', caption: 'Ask Guestlist' },
  { key: 'membership.drops', caption: 'Member drops' },
  { key: 'membership.prices', caption: 'Member prices' },
  { key: 'membership.market', caption: 'Guestlist Market' },
  { key: 'membership.doGood', caption: 'Do good for others' },
];

export async function MembershipGallery() {
  const images = await siteImages();
  return (
    <div className="mbGallery" aria-label="Nights with Guestlist">
      {STRIP.map((s) => (
        <figure key={s.key}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[s.key]} alt="" loading="lazy" />
          <figcaption>{s.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// The photograph behind the hero headline. Rendered first inside .mbHero so
// the gradient and the words sit on top of it.
export async function MembershipHeroImage() {
  const images = await siteImages();
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="mbHeroBg" src={images['membership.hero']} alt="" />;
}
