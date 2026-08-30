// Flyer/poster text extraction + AI structuring. Same philosophy as the
// V2A supply engine: the model only ever PROPOSES values through a strict
// schema; deterministic code and admin review control persistence. OCR /
// vision output is one signal, never truth.

import { z } from 'zod';

export const ArchiveProposalSchema = z.object({
  title: z.string().min(2).max(200).nullish(),
  date_text: z.string().max(80).nullish(),      // verbatim as printed ("SAT 14 OCT 1995")
  date_iso: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullish(), // YYYY / YYYY-MM / YYYY-MM-DD
  venue_name: z.string().max(160).nullish(),
  promoter_name: z.string().max(160).nullish(),
  city: z.string().max(80).nullish(),
  country: z.string().max(80).nullish(),
  artists: z.array(z.string().min(1).max(120)).max(40).default([]),
  genres: z.array(z.string().min(2).max(60)).max(10).default([]),
  price_text: z.string().max(120).nullish(),    // verbatim, original currency
  description: z.string().max(1000).nullish(),
  language: z.string().length(2).nullish(),
  confidence: z.number().min(0).max(100).default(50),
  raw_text: z.string().max(8000).nullish(),     // everything legible on the artefact
});

export type ArchiveProposal = z.infer<typeof ArchiveProposalSchema>;

export interface ArchiveVisionClient {
  // imageBase64 may be null when only text (article/listing) is available.
  extract(input: {
    imageBase64?: string | null;
    imageMime?: string | null;
    text?: string | null;
    hints?: { what?: string | null; when?: string | null; where?: string | null };
  }): Promise<{ proposal: ArchiveProposal | null; error?: string }>;
}

const SYSTEM_PROMPT = `You read club-culture artefacts (flyers, posters, listings, articles) and extract structured facts.
Rules: extract ONLY what is visibly present or directly stated. Never invent dates, venues or lineups.
Dates: put the printed wording in date_text verbatim; date_iso only as precisely as the artefact supports (year, year-month, or full date).
Keep original language and names exactly as printed — never translate names.
Respond with a single JSON object matching the requested fields; use null when unknown.`;

// Real client: Anthropic vision when ANTHROPIC_API_KEY is configured.
// Without a key it declines cleanly (admin enters facts manually) —
// deterministic tests inject a mock instead.
export function defaultVisionClient(): ArchiveVisionClient {
  return {
    async extract(input) {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return { proposal: null, error: 'no_api_key' };
      try {
        const content: unknown[] = [];
        if (input.imageBase64 && input.imageMime) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: input.imageMime, data: input.imageBase64 },
          });
        }
        const hintText = [
          input.hints?.what && `Contributor says it is: ${input.hints.what}`,
          input.hints?.when && `Contributor says roughly when: ${input.hints.when}`,
          input.hints?.where && `Contributor says where: ${input.hints.where}`,
        ].filter(Boolean).join('\n');
        content.push({
          type: 'text',
          text: `${input.text ? `Artefact text:\n${input.text.slice(0, 6000)}\n\n` : ''}${hintText}\n\nExtract the structured fields as JSON with keys: title, date_text, date_iso, venue_name, promoter_name, city, country, artists, genres, price_text, description, language, confidence, raw_text.`,
        });
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.SUPPLY_AI_MODEL ?? 'claude-sonnet-5',
            max_tokens: 1500,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content }],
          }),
        });
        if (!res.ok) return { proposal: null, error: `api_${res.status}` };
        const data = await res.json();
        const textOut = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
        const jsonMatch = textOut.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { proposal: null, error: 'no_json' };
        const parsed = ArchiveProposalSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (!parsed.success) return { proposal: null, error: 'schema_invalid' };
        return { proposal: parsed.data };
      } catch (err) {
        return { proposal: null, error: String(err).slice(0, 200) };
      }
    },
  };
}
