// GUESTLIST INTELLIGENCE CORE — shared types.
//
// Channel-independent by construction: nothing in lib/intelligence/ knows
// whether an opportunity ends up on X, on Guestlist.net, in an email or in
// a future concierge. Channels consume opportunities; they never define
// what is culturally interesting.

export const OPPORTUNITY_TYPES = [
  'TONIGHT_PICK', 'TONIGHT_PATTERN', 'WEEKEND_PATTERN', 'NEW_EVENT',
  'NEW_LINEUP', 'NOTABLE_LINEUP', 'ARTIST_APPEARANCE', 'PROMOTER_ACTIVITY',
  'CITY_MOMENT', 'GENRE_MOMENT', 'EVENT_MOMENTUM', 'WORTH_TRAVELLING_FOR',
  'ARCHIVE_ANNIVERSARY', 'ON_THIS_NIGHT', 'ARCHIVE_FLYER',
  'I_WAS_THERE_MOMENT', 'EDITORIAL_OBSERVATION',
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

// Not every type matters equally. These weights order the desk and feed
// the score; they are editorial policy in one place.
export const OPPORTUNITY_TYPE_WEIGHTS: Record<OpportunityType, number> = {
  ON_THIS_NIGHT: 10,        // the archive is @guestlist's superpower
  ARCHIVE_ANNIVERSARY: 10,
  TONIGHT_PATTERN: 9,       // "London's unusually strong for jungle tonight"
  GENRE_MOMENT: 9,
  EVENT_MOMENTUM: 8,        // something is genuinely accelerating
  CITY_MOMENT: 8,
  NOTABLE_LINEUP: 7,
  WORTH_TRAVELLING_FOR: 7,
  WEEKEND_PATTERN: 7,
  TONIGHT_PICK: 6,
  ARCHIVE_FLYER: 6,
  I_WAS_THERE_MOMENT: 6,
  ARTIST_APPEARANCE: 5,
  NEW_LINEUP: 5,
  NEW_EVENT: 4,
  PROMOTER_ACTIVITY: 3,
  EDITORIAL_OBSERVATION: 3,
};

export type Confidence = 'low' | 'medium' | 'high';

export type Opportunity = {
  id: string;
  type: OpportunityType;
  headline: string;
  reason: string;
  suggested_angle: string | null;
  score: number;
  confidence: Confidence;
  city: string | null;
  location_id: string | null;
  genres: string[];
  linked_event_ids: string[];
  linked_artist_names: string[];
  linked_promoter_ids: string[];
  linked_venue_ids: string[];
  linked_archive_event_ids: string[];
  linked_archive_media_ids: string[];
  evidence: EvidencePack;
  channels: string[];
  fingerprint: string;
  detected_at: string;
  expires_at: string;
  status: 'open' | 'drafted' | 'dismissed' | 'expired' | 'published';
};

// ---------------------------------------------------------------------------
// Evidence packs — the ONLY source of AI factual claims.
// ---------------------------------------------------------------------------

export type EventEvidence = {
  id: string;
  title: string;
  slug: string;
  url: string;
  status: string;
  listing_status: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  date_label: string;          // "Saturday 14 September"
  time_label: string;          // "22:00"
  venue: string | null;
  city: string | null;
  country: string | null;
  artists: string[];
  genres: string[];
  promoter: string | null;
  price_from: string | null;
  price_to: string | null;
  currency: string | null;
  ticket_url: string | null;
  metrics: {
    views_24h: number;
    ticket_clicks_24h: number;
    interested: number;
    going: number;
    going_6h: number;
    saves: number;
    shares_24h: number;
    heat: number;
    heat_label: string | null;
  };
};

export type ArchiveEvidence = {
  id: string;
  title: string;
  slug: string;
  url: string;
  display_date: string;
  date_precision: string;
  year: number | null;
  years_ago: number | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  lineup: string[];
  genres: string[];
  promoter: string | null;
  i_was_there_public: number;  // PUBLIC marks only — privacy holds here too
  source_attribution: string | null;
  media: { id: string; path: string; rights: string; hidden: boolean }[];
};

export type EvidencePack = {
  version: 1;
  built_at: string;
  events: EventEvidence[];
  archive: ArchiveEvidence[];
  aggregates: Record<string, number | string | null>;
  // Deterministic fact-locking allowlists: a draft may only use numbers
  // and proper nouns that appear here.
  numbers: string[];
  names: string[];
};

export function emptyEvidence(): EvidencePack {
  return {
    version: 1, built_at: new Date().toISOString(),
    events: [], archive: [], aggregates: {}, numbers: [], names: [],
  };
}
