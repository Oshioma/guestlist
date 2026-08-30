// Map RecommendedEvent rows to the display shape RecShelf renders.
// Formatting happens server-side in the event's own timezone/currency.

import { fmtEventDate, formatPrice } from './util';
import { reasonText, type RecommendedEvent } from './recommend';
import type { RecCardData } from '@/components/v2c/RecShelf';

export function toRecCards(recs: RecommendedEvent[]): RecCardData[] {
  return recs.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    when: fmtEventDate(r.start_at, r.end_at, r.timezone),
    city: r.city,
    venue_name: r.venue_name,
    primary_image_url: r.primary_image_url,
    price: formatPrice(r.price_from, r.price_to, r.currency),
    reasons: r.reasons.slice(0, 2).map(reasonText),
    explore: r.reasons.some((x) => x.code === 'EXPLORE'),
  }));
}
