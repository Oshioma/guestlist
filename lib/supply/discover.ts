// SOURCE DISCOVERY: given a country (optionally a city) and the genres we
// care about, propose clubs, promoters, festivals and calendars that might be
// worth monitoring.
//
// The model is a suggestion engine and nothing more. It proposes names and
// URLs; it never writes to the database, and nothing it says is believed —
// every candidate has to survive a real fetch (see probeTarget) before an
// admin adds it. That verification step is what makes an AI suggestion safe:
// an invented venue or a guessed URL simply fails to resolve and is shown as
// unreachable.
//
// The client is injectable so tests run deterministically and the feature
// degrades honestly when no ANTHROPIC_API_KEY is configured.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { parseAIJson } from './ai';
import { SOURCE_TYPES } from '@/lib/util';

export type DiscoveryRequest = {
  country: string;
  city?: string | null;
  genres: string[];
  limit: number;
};

const KINDS = [
  'venue_website',
  'promoter_website',
  'festival_website',
  'independent_calendar',
  'blog_publication',
] as const;

export type CandidateKind = (typeof KINDS)[number];

export type SourceCandidate = {
  name: string;
  url: string; // the page we would actually scan
  homepage: string | null;
  kind: CandidateKind;
  city: string | null;
  country: string;
  genres: string[];
  note: string | null;
};

export type DiscoveryOutcome =
  | { ok: true; candidates: SourceCandidate[]; model: string }
  | {
      ok: false;
      error: 'unavailable' | 'call_failed' | 'invalid_json' | 'invalid_shape';
      detail: string;
    };

export interface DiscoveryClient {
  available: boolean;
  propose(input: { system: string; user: string }): Promise<
    { ok: true; text: string; model: string } | { ok: false; detail: string }
  >;
}

const candidateSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().min(1).max(500),
  homepage: z.string().max(500).nullish(),
  kind: z.string().max(60).nullish(),
  city: z.string().max(120).nullish(),
  country: z.string().max(120).nullish(),
  genres: z.array(z.string().max(60)).max(12).nullish(),
  note: z.string().max(300).nullish(),
});

const responseSchema = z.object({ candidates: z.array(candidateSchema).max(40) });

export const DISCOVERY_SYSTEM_PROMPT = `You help Guestlist, a curated platform for dance-music culture, find event sources to monitor.

Given a country (sometimes a city) and a list of genres, list real clubs, promoters, festivals and independent listings sites in that place that programme those genres, and the page on their own website that lists what is coming up.

MATCHING RULE: a place qualifies if it regularly programmes ANY ONE of the requested genres. It does not have to cover them all, or even most of them — one is enough. A drum & bass club belongs in the results of a search that lists house, techno and drum & bass.

RULES:
- Only places you actually know exist. A shorter list of real venues is far better than a long list padded with plausible-sounding names. Never invent a club, a promoter or a festival.
- "url" must be the page that lists upcoming events (e.g. https://example.com/events, /whats-on, /programme). If you do not know that path, give the homepage instead — never guess a path you have not seen.
- Never propose an aggregator or ticketing platform (Resident Advisor, Dice, Skiddle, Eventbrite, Ticketmaster, Fatsoma, Songkick, Bandsintown, Facebook, Instagram, Meetup). Guestlist monitors sources directly.
- "kind" is one of: venue_website, promoter_website, festival_website, independent_calendar, blog_publication.
- "genres" are the genres from the requested list that this place actually programmes.
- "note" is at most one short sentence saying why it fits — no marketing copy.
- If you know nothing real for a place, return an empty list. That is a correct answer.

Output ONLY a single JSON object of the form {"candidates": [...]}, no markdown fences and no commentary.`;

export function buildDiscoveryUser(req: DiscoveryRequest): string {
  return [
    `Country: ${req.country}`,
    req.city ? `City: ${req.city}` : 'City: anywhere in the country',
    `Genres (any one of these is enough): ${req.genres.length ? req.genres.join(', ') : 'any dance music'}`,
    `Return at most ${req.limit} candidates.`,
  ].join('\n');
}

const ALLOWED_KINDS = new Set<string>(KINDS);
const BANNED_HOSTS = [
  'residentadvisor.net', 'ra.co', 'dice.fm', 'skiddle.com', 'eventbrite.com',
  'eventbrite.co.uk', 'ticketmaster.com', 'fatsoma.com', 'songkick.com',
  'bandsintown.com', 'facebook.com', 'instagram.com', 'meetup.com',
  'twitter.com', 'x.com', 'tiktok.com', 'linktr.ee',
];

export function isBannedCandidateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return BANNED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

// Nothing the model returns is trusted: URLs are re-parsed, hosts are checked
// against the aggregator ban list, and anything malformed is dropped rather
// than corrected.
function normaliseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!u.hostname.includes('.')) return null;
    if (isBannedCandidateHost(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function normaliseCandidates(raw: unknown, req: DiscoveryRequest): SourceCandidate[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: SourceCandidate[] = [];
  for (const c of parsed.data.candidates) {
    const url = normaliseUrl(c.url);
    if (!url) continue;
    const key = url.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = (c.kind ?? '').trim();
    out.push({
      name: c.name.trim(),
      url,
      homepage: normaliseUrl(c.homepage),
      kind: (ALLOWED_KINDS.has(kind) ? kind : 'venue_website') as CandidateKind,
      city: c.city?.trim() || req.city?.trim() || null,
      country: c.country?.trim() || req.country,
      genres: (c.genres ?? []).map((g) => g.trim()).filter(Boolean).slice(0, 8),
      note: c.note?.trim() || null,
    });
    if (out.length >= req.limit) break;
  }
  return out;
}

export function candidateKindLabel(kind: string): string {
  return SOURCE_TYPES.find((t) => t.value === kind)?.label ?? 'Other';
}

export async function discoverSources(
  req: DiscoveryRequest,
  client: DiscoveryClient
): Promise<DiscoveryOutcome> {
  if (!client.available) {
    return { ok: false, error: 'unavailable', detail: 'No ANTHROPIC_API_KEY configured' };
  }
  const res = await client.propose({
    system: DISCOVERY_SYSTEM_PROMPT,
    user: buildDiscoveryUser(req),
  });
  if (!res.ok) return { ok: false, error: 'call_failed', detail: res.detail };
  const raw = parseAIJson(res.text);
  if (raw == null) {
    return { ok: false, error: 'invalid_json', detail: 'Model output was not parseable JSON' };
  }
  const candidates = normaliseCandidates(raw, req);
  if (!candidates.length && !responseSchema.safeParse(raw).success) {
    return { ok: false, error: 'invalid_shape', detail: 'Model output did not match the expected shape' };
  }
  return { ok: true, candidates, model: res.model };
}

class AnthropicDiscoveryClient implements DiscoveryClient {
  available = true;
  private client: Anthropic;
  private model = process.env.DISCOVERY_AI_MODEL ?? 'claude-sonnet-5';

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async propose({ system, user }: { system: string; user: string }) {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 3_000,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { ok: true as const, text, model: this.model };
    } catch (err) {
      return { ok: false as const, detail: err instanceof Error ? err.message : 'unknown' };
    }
  }
}

class UnavailableDiscoveryClient implements DiscoveryClient {
  available = false;
  async propose() {
    return { ok: false as const, detail: 'No ANTHROPIC_API_KEY configured' };
  }
}

export function defaultDiscoveryClient(): DiscoveryClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicDiscoveryClient(key) : new UnavailableDiscoveryClient();
}
