// THE PICTURES ON THE SITE, AS SLOTS RATHER THAN FILES.
//
// A handful of places show a fixed photograph — the home page's three, the
// membership hero and its photo strip. Changing one used to mean editing code and deploying,
// which puts a designer's job behind an engineer.
//
// The unit here is a SLOT, not a file: `membership.hero` is "the photograph
// behind the Get in free headline", and it has a picture in it. That is what
// lets the code keep working while the picture changes, and it is why this is
// not simply a listing of /public/images — the code has to know which
// photograph goes where.
//
// Every slot ships with a fallback, so an empty database looks exactly like
// the site does today and nothing can ever render a hole.

import { getSetting, setSetting } from './settings';

export type SiteImageSlot = {
  key: string;
  label: string;
  /** Where it shows up, in words somebody who did not write this would use. */
  where: string;
  /** What the picture has to do, so a replacement can be chosen well. */
  guidance: string;
  /** The picture shipped with the code. Never removed — reset comes back to it. */
  fallback: string;
};

export const SITE_IMAGE_SLOTS: SiteImageSlot[] = [
  {
    key: 'home.1',
    label: 'Home — first panel',
    where: 'The three-picture band behind the front page headline, left',
    guidance: 'A night. It sits behind type, so busy and bright edges fight the words.',
    fallback: '/images/secret-party.jpg',
  },
  {
    key: 'home.2',
    label: 'Home — second panel',
    where: 'The three-picture band behind the front page headline, middle',
    guidance: 'People together — the social half of what Guestlist is.',
    fallback: '/images/supper-club.jpg',
  },
  {
    key: 'home.3',
    label: 'Home — third panel',
    where: 'The three-picture band behind the front page headline, right',
    guidance: 'Somewhere worth travelling to.',
    fallback: '/images/retreat-beach.jpg',
  },
  {
    key: 'membership.hero',
    label: 'Membership — Get in free',
    where: 'Behind the big GET IN. / YOU’RE IN. headline at the top of /membership',
    guidance: 'Wide and dark. White type sits on the left third, so keep that side calm.',
    fallback: '/images/hero.jpg',
  },
  {
    key: 'membership.queueJump',
    label: 'Membership — Queue jump',
    where: 'The photo strip under the /membership hero — the “Queue jump” picture',
    guidance: 'Arriving, or a door. Cropped to a wide band, so the subject wants to be central.',
    fallback: '/images/secret-party.jpg',
  },
  {
    key: 'membership.drops',
    label: 'Membership — Member drops',
    where: 'The photo strip under the /membership hero — the “Member drops” picture',
    guidance: 'Something you would be pleased to be surprised with.',
    fallback: '/images/travel-ocean.jpg',
  },
  {
    key: 'membership.prices',
    label: 'Membership — Member prices',
    where: 'The photo strip under the /membership hero — the “Member prices” picture',
    guidance: 'Somewhere you would pay to get into, shot so the left side stays calm.',
    fallback: '/images/travel-safari.jpg',
  },
  {
    key: 'membership.market',
    label: 'Membership — Guestlist Market',
    where: 'The photo strip under the /membership hero — the “Guestlist Market” picture',
    guidance: 'A table, a bar, a shop — an independent place worth knowing.',
    fallback: '/images/supper-club.jpg',
  },
  {
    key: 'membership.doGood',
    label: 'Membership — Do good for others',
    where: 'The photo strip under the /membership hero — the “Do good for others” picture',
    guidance: 'People, together, doing something that is not about a dance floor.',
    fallback: '/images/sound-healing.jpg',
  },
];

const SETTING_KEY = 'site_images';

export type SiteImages = Record<string, string>;

/** Only http(s) and site-relative paths. Never javascript:, never data:. */
export function usableImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url.slice(0, 500);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Every slot's effective picture: the override if one is set, the shipped
 * fallback otherwise. Always complete — every key in SITE_IMAGE_SLOTS is
 * present, so a caller can never read undefined into an `img` tag.
 */
export async function siteImages(): Promise<SiteImages> {
  const stored = (await getSetting<Record<string, unknown>>(SETTING_KEY)) ?? {};
  const out: SiteImages = {};
  for (const slot of SITE_IMAGE_SLOTS) {
    out[slot.key] = usableImageUrl(stored[slot.key]) ?? slot.fallback;
  }
  return out;
}

export type SiteImageRow = SiteImageSlot & { url: string; overridden: boolean };

/** The slots with their current pictures, for the desk. */
export async function siteImageRows(): Promise<SiteImageRow[]> {
  const stored = (await getSetting<Record<string, unknown>>(SETTING_KEY)) ?? {};
  return SITE_IMAGE_SLOTS.map((slot) => {
    const override = usableImageUrl(stored[slot.key]);
    return { ...slot, url: override ?? slot.fallback, overridden: !!override };
  });
}

export class SiteImageError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Point a slot at a new picture, or pass null to put the original back.
 * An unknown slot is refused rather than quietly stored: a typo should not
 * write a setting nothing will ever read.
 */
export async function setSiteImage(
  key: string, url: string | null, updatedBy: string | null
): Promise<SiteImageRow> {
  const slot = SITE_IMAGE_SLOTS.find((s) => s.key === key);
  if (!slot) throw new SiteImageError(404, 'No such picture on the site');

  const stored = (await getSetting<Record<string, unknown>>(SETTING_KEY)) ?? {};
  const next = { ...stored };
  if (url === null) {
    delete next[key];
  } else {
    const clean = usableImageUrl(url);
    if (!clean) throw new SiteImageError(400, 'That is not a usable image address');
    next[key] = clean;
  }
  await setSetting(SETTING_KEY, next, updatedBy);
  const override = usableImageUrl(next[key]);
  return { ...slot, url: override ?? slot.fallback, overridden: !!override };
}
