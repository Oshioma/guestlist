// URL ingestion service boundary (V2A).
//
// V1 shipped this module with a stub extractor; the Event Supply Engine
// replaces it with the real pipeline in lib/supply/pipeline.ts:
//   safe fetch → structured metadata → AI gap-filling → validation →
//   normalisation → entity matching → dedupe → moderation/publishing.
// This module remains the entry point for member submissions: it owns the
// event_submissions bookkeeping and delegates extraction to the pipeline.

import { queryOne } from './db';
import { runExtractionPipeline, type PipelineContext, type PipelineOutcome } from './supply/pipeline';

export type SubmissionOutcome =
  | { status: 'invalid'; message: string }
  | {
      status: 'created' | 'duplicate' | 'checking';
      submissionId: string;
      eventId: string | null;
      summary: { title: string; date: string | null; city: string | null } | null;
    };

export async function processUrlSubmission(
  rawUrl: string,
  submittedBy: string | null,
  opts: { ipHash?: string | null; pipeline?: PipelineContext } = {}
): Promise<SubmissionOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return { status: 'invalid', message: 'That doesn’t look like a valid link.' };
  }
  const cleanUrl = parsed.toString();

  const submission = await queryOne<{ id: string }>(
    `insert into event_submissions (url, submitted_by, ip_hash) values ($1, $2, $3) returning id`,
    [cleanUrl, submittedBy, opts.ipHash ?? null]
  );
  const submissionId = submission!.id;

  let outcome: PipelineOutcome;
  try {
    outcome = await runExtractionPipeline(cleanUrl, {
      ...opts.pipeline,
      submissionId,
      memberId: submittedBy,
      scanKind: 'submission',
    });
  } catch (err) {
    console.error('submission pipeline error', err);
    return { status: 'checking', submissionId, eventId: null, summary: null };
  }

  if (outcome.status === 'duplicate_linked') {
    return { status: 'duplicate', submissionId, eventId: outcome.eventId, summary: null };
  }
  if (outcome.eventId) {
    return { status: 'created', submissionId, eventId: outcome.eventId, summary: outcome.summary };
  }
  // Extraction failed — the failure state lives on the extraction record for
  // admins; the member just gets a friendly "we're checking it".
  return { status: 'checking', submissionId, eventId: null, summary: null };
}
