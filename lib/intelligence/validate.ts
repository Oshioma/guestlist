// FACT LOCKING — deterministic validation between the AI and the world.
// Facts must trace to the evidence pack; voice is free, numbers are not.

import { BANNED_PHRASES, MAX_EMOJI, X_LINK_LENGTH, X_MAX_LENGTH } from './voice';
import type { EvidencePack } from './types';

export type DraftValidation = { ok: true; effectiveLength: number } | { ok: false; problems: string[] };

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function effectiveXLength(body: string, hasLink: boolean): number {
  // X wraps every URL to 23 chars; our Guestlist link is appended separately.
  const urlAdjusted = body.replace(/https?:\/\/\S+/g, 'x'.repeat(X_LINK_LENGTH));
  return urlAdjusted.length + (hasLink ? X_LINK_LENGTH + 1 : 0);
}

export function validateDraft(
  body: string,
  evidence: EvidencePack,
  opts: { hasLink?: boolean } = {}
): DraftValidation {
  const problems: string[] = [];
  const text = body.trim();
  if (!text) problems.push('Draft is empty');

  const effectiveLength = effectiveXLength(text, opts.hasLink ?? true);
  if (effectiveLength > X_MAX_LENGTH) {
    problems.push(`Too long for X: ${effectiveLength}/${X_MAX_LENGTH} characters including the link`);
  }

  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      problems.push(`Banned phrase for the @guestlist voice: "${phrase}"`);
    }
  }
  const emoji = text.match(EMOJI_RE) ?? [];
  if (emoji.length > MAX_EMOJI) {
    problems.push(`Too many emoji (${emoji.length}) — @guestlist uses at most ${MAX_EMOJI}`);
  }

  // THE FACT LOCK: every number in the draft must exist in the evidence
  // allowlist (counts, dates, years, times, prices, list ordinals 0–12).
  const allowed = new Set(evidence.numbers);
  for (const m of text.matchAll(/\d[\d,.:]*\d|\d/g)) {
    const raw = m[0].replace(/[,.:]+$/, '');
    const variants = [raw, raw.replace(/,/g, ''), ...raw.split(/[:.]/)];
    if (!variants.some((v) => v && allowed.has(v))) {
      problems.push(`Unsupported fact: the number "${raw}" is not in the evidence`);
    }
  }

  if (problems.length) return { ok: false, problems };
  return { ok: true, effectiveLength };
}
