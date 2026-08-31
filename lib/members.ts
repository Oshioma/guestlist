// A member's public profile slug. Derived from the display name with a
// short id suffix so two people called "Sam" both get a working URL, and
// regenerated whenever the display name changes — a member who shortens
// their name should not keep the old one in their profile URL.

import { slugify } from './util';

export function memberSlug(displayName: string, id: string): string {
  const base = slugify(displayName).slice(0, 40) || 'member';
  return `${base}-${id.slice(0, 6)}`;
}

// What a display name must be to be usable: something to render, short
// enough for a header chip, no control characters or line breaks.
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) return null;
  return name;
}
