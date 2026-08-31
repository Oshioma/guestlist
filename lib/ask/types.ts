// ASK @GUESTLIST — types. One channel-independent engine: the website,
// @guestlist X replies, and future channels all speak these shapes.

export type AskDate =
  | { kind: 'tonight' }
  | { kind: 'tomorrow' }
  | { kind: 'weekend' }
  | { kind: 'next_weekend' }
  | { kind: 'day'; dow: number }              // 0=Sun … 6=Sat, next occurrence
  | { kind: 'iso'; date: string }             // YYYY-MM-DD
  | { kind: 'next_month' }
  | { kind: 'window'; days: number };         // "soon"-ish default horizons

export type AskSocial = 'connections' | 'close_friends' | 'scene' | null;

// Bounded, structured conversation state — the ONLY context carried between
// turns. Never an unbounded transcript.
export type AskIntent = {
  city: string | null;           // canonical city name
  cityAmbiguous?: boolean;       // true → engine must clarify
  date: AskDate | null;
  genres: string[];              // genre names/slugs as matched (parents or subs)
  oldSchool?: boolean;           // "old-school" style preference
  daytime?: boolean;
  lateNight?: boolean;           // 23:00+ start
  afterHour?: number | null;     // "after 2am" → 2
  priceMax?: number | null;      // event-currency naive cap; "cheap" → 15, "free" → 0
  sizePref?: 'small' | 'big' | null;
  social?: AskSocial;
  momentum?: boolean;            // "what's heating up"
  worthTravelling?: boolean;
  travelCity?: string | null;    // "I'm in Ibiza next weekend"
  archive?: {                    // historical questions
    query: string | null;        // venue/promoter/free text
    year: number | null;
  } | null;
  pastToPresent?: boolean;       // "anything like the nights I went to at…"
  personalized?: boolean;        // "surprise me", "for me"
  artist?: string | null;
  venue?: string | null;
  promoter?: string | null;
};

export type AskCard = {
  type: 'event' | 'archive';
  id: string;
  // Canonical display data resolved server-side — NEVER AI-generated.
  title: string;
  slug: string;
  when: string;                  // preformatted in the event's own timezone
  city: string | null;
  venueName: string | null;
  price: string | null;
  imageUrl: string | null;
  genres: string[];
  reasons: string[];             // explainable reason chips
  social: { connectionsGoing: number; closeGoing: number; names: string[] } | null;
  momentumNote: string | null;   // explanation, never a score
  href: string;                  // carries ?src=ask-{id} attribution
};

export type AskAnswerType =
  | 'DIRECT_ANSWER' | 'EVENT_RECOMMENDATIONS' | 'SOCIAL_DISCOVERY'
  | 'ARCHIVE_DISCOVERY' | 'PAST_TO_PRESENT' | 'NO_RESULTS'
  | 'CLARIFICATION' | 'FOLLOW_UP';

export type AskAnswer = {
  type: AskAnswerType;
  commentary: string;            // validated @guestlist voice, short
  cards: AskCard[];
  followUps: string[];           // suggested next questions (chips)
  clarification: string | null;  // one concise question, when needed
  relaxation: string | null;     // which constraint blocked + smallest loosening
  conversationId: string;
  messageId: string;
};
