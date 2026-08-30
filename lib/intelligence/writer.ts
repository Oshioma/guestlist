// AI DRAFTING — the cultural judgement layer. The AI narrates evidence; it
// never discovers or invents. Injectable client (same pattern as the supply
// extraction and archive vision clients) so tests are deterministic and the
// system degrades gracefully without an ANTHROPIC_API_KEY.

import { PROMPT_VERSION, VOICE_PROFILE, VOICE_VERSION } from './voice';
import type { EvidencePack, Opportunity } from './types';

export type DraftResult =
  | { ok: true; body: string; model: string }
  | { ok: false; error: string };

export interface IntelligenceWriterClient {
  draft(input: {
    opportunity: Pick<Opportunity, 'type' | 'headline' | 'reason' | 'suggested_angle'>;
    evidence: EvidencePack;
    kind: 'post' | 'reply';
    replyToText?: string | null;
    linkPlanned: boolean;
  }): Promise<DraftResult>;
}

const MODEL = 'claude-sonnet-5';

function evidenceForPrompt(e: EvidencePack): string {
  return JSON.stringify({
    events: e.events.map((ev) => ({
      title: ev.title, date: ev.date_label, time: ev.time_label, venue: ev.venue,
      city: ev.city, country: ev.country, artists: ev.artists, genres: ev.genres,
      promoter: ev.promoter, going: ev.metrics.going, interested: ev.metrics.interested,
      going_last_6h: ev.metrics.going_6h, ticket_clicks_24h: ev.metrics.ticket_clicks_24h,
    })),
    archive: e.archive.map((a) => ({
      title: a.title, date: a.display_date, date_certainty: a.date_precision,
      year: a.year, years_ago: a.years_ago, venue: a.venue, city: a.city,
      lineup: a.lineup, genres: a.genres, i_was_there_public: a.i_was_there_public,
    })),
    aggregates: e.aggregates,
  });
}

class AnthropicWriterClient implements IntelligenceWriterClient {
  constructor(private apiKey: string) {}

  async draft(input: Parameters<IntelligenceWriterClient['draft']>[0]): Promise<DraftResult> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system: `${VOICE_PROFILE}\n\nYou are drafting one ${input.kind === 'reply' ? 'reply' : 'post'} for X.
Maximum ${input.linkPlanned ? 250 : 275} characters — a Guestlist link may be appended after your text.
Return ONLY the post text. No quotes, no preamble, no hashtag lists.`,
          messages: [{
            role: 'user',
            content: `${input.kind === 'reply' && input.replyToText
              ? `Someone asked @guestlist: "${input.replyToText}"\n\n` : ''}Editorial opportunity: ${input.opportunity.headline}
Why it surfaced: ${input.opportunity.reason}
${input.opportunity.suggested_angle ? `Suggested angle (optional): ${input.opportunity.suggested_angle}` : ''}

EVIDENCE (the only permitted source of facts):
${evidenceForPrompt(input.evidence)}

Write the ${input.kind}.`,
          }],
        }),
      });
      if (!res.ok) return { ok: false, error: `anthropic ${res.status}` };
      const data = await res.json();
      const text: string = data.content?.[0]?.text?.trim() ?? '';
      if (!text) return { ok: false, error: 'empty draft' };
      return { ok: true, body: text, model: MODEL };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 200) };
    }
  }
}

class UnavailableWriterClient implements IntelligenceWriterClient {
  async draft(): Promise<DraftResult> {
    return { ok: false, error: 'No ANTHROPIC_API_KEY configured' };
  }
}

// Deterministic fixture client for tests and for a useful no-key fallback
// in the desk: template drafts from evidence, clearly grounded.
export class TemplateWriterClient implements IntelligenceWriterClient {
  async draft(input: Parameters<IntelligenceWriterClient['draft']>[0]): Promise<DraftResult> {
    const e = input.evidence;
    let body = input.opportunity.suggested_angle ?? input.opportunity.headline;
    const lines: string[] = [body];
    if (e.events.length > 1) {
      lines.push('');
      for (const ev of e.events.slice(0, 3)) {
        lines.push(`${ev.title}${ev.venue ? ` — ${ev.venue}` : ''}`);
      }
    } else if (e.events.length === 1) {
      const ev = e.events[0];
      lines.push(`${ev.title} · ${ev.date_label}${ev.venue ? ` · ${ev.venue}` : ''}`);
    } else if (e.archive.length) {
      const a = e.archive[0];
      lines.push(`${a.title} · ${a.display_date}${a.venue ? ` · ${a.venue}` : ''}`);
      if (a.i_was_there_public > 0) lines.push(`${a.i_was_there_public} members were there.`);
    }
    body = lines.join('\n').slice(0, input.linkPlanned ? 250 : 275);
    return { ok: true, body, model: 'template' };
  }
}

export const WRITER_META = { voiceVersion: VOICE_VERSION, promptVersion: PROMPT_VERSION };

export function defaultWriterClient(): IntelligenceWriterClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicWriterClient(key) : new UnavailableWriterClient();
}
