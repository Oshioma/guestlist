// Strict validated shape of an extraction result. AI and structured-data
// parsing both produce candidates for this shape; nothing reaches the
// database without passing through this schema plus the pipeline's own
// normalisation. The model never writes to tables.

import { z } from 'zod';
import { EVENT_TYPES } from '@/lib/util';

export const FIELD_SOURCE_VALUES = [
  'json-ld', 'opengraph', 'meta', 'page', 'url', 'feed', 'ai', 'entity-match',
] as const;
export type FieldSource = (typeof FIELD_SOURCE_VALUES)[number];

// ADVISORY FIELD, NEVER FATAL. `notes` is free text the model may add for a
// human reader — it only ever becomes a warning. Models routinely return a
// single note as a bare string instead of an array, and that alone used to
// fail the whole parse and throw away an otherwise-valid extraction
// ("invalid_shape: notes: expected array, received string"). So normalise
// instead of validating: wrap a scalar, drop non-strings, and clamp length and
// count rather than erroring on them. Data-bearing arrays such as `artists`
// stay strict on purpose — silently reshaping those would invent content.
const advisoryNotes = z
  .preprocess((v) => {
    const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v : [];
    return arr
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 20)
      .map((n) => n.slice(0, 300));
  }, z.array(z.string()))
  .default([]);

const nullableTrimmed = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length ? s : null))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const confidence = z.number().min(0).max(100);

export const extractionResultSchema = z.object({
  title: z.string().trim().min(1).max(300),
  short_description: nullableTrimmed,
  description: z.string().trim().max(8000).nullable().optional().transform((v) => v || null),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }).nullable().optional().transform((v) => v ?? null),
  timezone: nullableTrimmed,
  venue: z
    .object({
      name: z.string().trim().min(1).max(200),
      address: nullableTrimmed,
      city: nullableTrimmed,
      country: nullableTrimmed,
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  city: nullableTrimmed,
  country: nullableTrimmed,
  promoter: z
    .object({
      name: z.string().trim().min(1).max(200),
      website: nullableTrimmed,
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  artists: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        billing_order: z.number().int().min(1).max(200),
      })
    )
    .max(60)
    .default([]),
  genres: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        confidence: confidence,
      })
    )
    .max(12)
    .default([]),
  event_type: z
    .enum(EVENT_TYPES.map((t) => t.value) as [string, ...string[]])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  ticket_url: nullableTrimmed,
  image_url: nullableTrimmed,
  price_from: z.number().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
  price_to: z.number().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  source_url: z.string().url(),
  canonical_url: nullableTrimmed,
  field_confidence: z.record(z.string(), confidence).default({}),
  field_sources: z.record(z.string(), z.enum(FIELD_SOURCE_VALUES)).default({}),
  warnings: z.array(z.string().max(300)).max(40).default([]),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// What the AI is allowed to return: a subset (no field_sources — those are
// assigned by application code; AI-provided values are always tagged 'ai').
export const aiProposalSchema = z.object({
  is_event: z.boolean(),
  is_music_event: z.boolean().nullable().optional().transform((v) => v ?? null),
  title: z.string().trim().min(1).max(300).nullable().optional().transform((v) => v ?? null),
  short_description: nullableTrimmed,
  description: z.string().trim().max(8000).nullable().optional().transform((v) => v || null),
  // Local wall-clock date/times as printed on the page, no timezone maths.
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v ?? null),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().transform((v) => v ?? null),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v ?? null),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().transform((v) => v ?? null),
  timezone: nullableTrimmed,
  venue_name: nullableTrimmed,
  venue_address: nullableTrimmed,
  city: nullableTrimmed,
  country: nullableTrimmed,
  promoter_name: nullableTrimmed,
  promoter_website: nullableTrimmed,
  artists: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
  genres: z
    .array(z.object({ name: z.string().trim().min(1).max(80), confidence: confidence }))
    .max(12)
    .default([]),
  event_type: nullableTrimmed,
  ticket_url: nullableTrimmed,
  image_url: nullableTrimmed,
  price_from: z.number().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
  price_to: z.number().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  field_confidence: z.record(z.string(), confidence).default({}),
  notes: advisoryNotes,
});

export type AIProposal = z.infer<typeof aiProposalSchema>;
