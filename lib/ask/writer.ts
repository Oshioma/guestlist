// ASK WRITER — the interpretation layer. Same injectable pattern as every
// AI client in this codebase: an Anthropic client when a key exists, a
// deterministic template otherwise (and always as the validation
// fallback). The AI only ever narrates evidence the tools returned.

import { VOICE_PROFILE } from '../intelligence/voice';
import type { AskCard, AskIntent } from './types';

export type AskWriteInput = {
  question: string;
  intent: AskIntent;
  cards: AskCard[];
  channel: 'website' | 'x';
  relaxation: string | null;
};

export type AskWriteResult =
  | { ok: true; commentary: string; model: string; inputTokens?: number; outputTokens?: number }
  | { ok: false; error: string };

export interface AskWriterClient {
  write(input: AskWriteInput): Promise<AskWriteResult>;
}

const MODEL = 'claude-sonnet-5';

export class AnthropicAskWriter implements AskWriterClient {
  constructor(private apiKey: string) {}
  async write(input: AskWriteInput): Promise<AskWriteResult> {
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
          max_tokens: 250,
          system: `${VOICE_PROFILE}

You are answering a member's question about going out, over REAL Guestlist results provided below.
Write 1–3 short sentences of commentary ONLY — the event cards render separately with their own facts.
Never introduce an event, artist, venue, promoter, city, date, price or count that is not in the results.
Be selective and opinionated, like the person who actually knows what's going on. No emoji lists, no hype.`,
          messages: [{
            role: 'user',
            content: `Question: ${input.question}

RESULTS (the only permitted source of facts):
${JSON.stringify(input.cards.map((c) => ({
  title: c.title, when: c.when, venue: c.venueName, city: c.city,
  reasons: c.reasons, social: c.social, momentum: c.momentumNote,
})))}
${input.relaxation ? `\nConstraint note to convey: ${input.relaxation}` : ''}

Write the commentary.`,
          }],
        }),
      });
      if (!res.ok) return { ok: false, error: `anthropic ${res.status}` };
      const data = await res.json();
      const text: string = data.content?.[0]?.text?.trim() ?? '';
      if (!text) return { ok: false, error: 'empty' };
      return {
        ok: true, commentary: text, model: MODEL,
        inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens,
      };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 200) };
    }
  }
}

// Deterministic voice — the default without a key, the test client, and
// the guaranteed-safe fallback when validation rejects an AI draft.
export class TemplateAskWriter implements AskWriterClient {
  async write(input: AskWriteInput): Promise<AskWriteResult> {
    const n = input.cards.length;
    let commentary: string;
    if (n === 0) {
      commentary = input.relaxation ?? 'Nothing in Guestlist looks strong enough for that exact combination.';
    } else if (n === 1) {
      commentary = `One that stands out: ${input.cards[0].title}.`;
    } else {
      commentary = `${n === 2 ? 'Two' : n === 3 ? 'Three' : String(n)} I'd look at — ${input.cards[0].title} is probably the pick.`;
    }
    if (n > 0 && input.relaxation) commentary += ` ${input.relaxation}`;
    return { ok: true, commentary, model: 'template' };
  }
}

export function defaultAskWriter(): AskWriterClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicAskWriter(key) : new TemplateAskWriter();
}
