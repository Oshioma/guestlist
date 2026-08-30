// Deterministic overall-confidence calculation. The model reports per-field
// confidence only; the application computes the overall score from those
// fields plus source quality — never by asking the AI for "a number".

import { supplyConfig } from './config';

export type FieldConfidence = Record<string, number>;

const WEIGHTS: Record<string, number> = {
  title: 0.2,
  date: 0.25,
  venue: 0.15,
  city: 0.1,
  genres: 0.15,
  lineup: 0.05,
  image: 0.05,
  ticket_url: 0.05,
};

const TRUST_FACTOR: Record<string, number> = {
  trusted: 1.0,
  new: 0.92,
  restricted: 0.8,
  blocked: 0,
};

export function computeOverallConfidence(
  fields: FieldConfidence,
  sourceTrust: string | null
): number {
  // No reliable title or date → the extraction is not trustworthy at all.
  if (!(fields.title > 0) || !(fields.date > 0)) return 0;

  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const c = fields[key];
    if (typeof c === 'number') {
      weighted += c * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight === 0) return 0;
  const base = weighted / totalWeight;
  const factor = TRUST_FACTOR[sourceTrust ?? 'new'] ?? TRUST_FACTOR.new;
  return Math.round(base * factor * 10) / 10;
}

export type AutoPublishInput = {
  sourceTrust: string | null;
  overallConfidence: number;
  fieldConfidence: FieldConfidence;
  startAt: Date;
  hasLocation: boolean; // venue or city present
  mappedGenreCount: number;
  duplicateState: 'none' | 'possible' | 'likely' | 'exact';
  warnings: string[];
};

// Warnings that always block auto-publish (others are informational).
const BLOCKING_WARNING_PATTERNS = [
  /timezone/i, /past/i, /date/i, /unknown genre/i, /venue matched by name only/i,
  /eventStatus/i, // page itself marks the event cancelled/postponed
];

export function canAutoPublish(input: AutoPublishInput): { ok: boolean; reasons: string[] } {
  const cfg = supplyConfig.autoPublish;
  const reasons: string[] = [];

  if (input.sourceTrust !== 'trusted') reasons.push('source is not TRUSTED');
  if (input.startAt.getTime() <= Date.now()) reasons.push('event is not in the future');
  if (input.overallConfidence < cfg.minOverallConfidence) {
    reasons.push(`overall confidence ${input.overallConfidence} below ${cfg.minOverallConfidence}`);
  }
  if ((input.fieldConfidence.title ?? 0) < cfg.minTitleConfidence) reasons.push('title confidence too low');
  if ((input.fieldConfidence.date ?? 0) < cfg.minDateConfidence) reasons.push('date confidence too low');
  const locConf = Math.max(input.fieldConfidence.venue ?? 0, input.fieldConfidence.city ?? 0);
  if (!input.hasLocation || locConf < cfg.minLocationConfidence) reasons.push('location insufficient');
  if (input.mappedGenreCount === 0) reasons.push('no mapped genre');
  if (input.duplicateState !== 'none') reasons.push(`duplicate warning (${input.duplicateState})`);
  const blocking = input.warnings.filter((w) => BLOCKING_WARNING_PATTERNS.some((p) => p.test(w)));
  if (blocking.length) reasons.push(`warnings: ${blocking.join(' | ')}`);

  return { ok: reasons.length === 0, reasons };
}
