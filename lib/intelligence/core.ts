// INTELLIGENCE CORE ORCHESTRATION — the draft lifecycle.
//
//   opportunity → AI draft (validated against evidence) → human edits →
//   human APPROVAL → schedule/post-now → pre-publish revalidation →
//   channel adapter → results recorded.
//
// The absolute V2G rule — nothing AI-generated posts without human
// approval — is enforced three deep: here in service code, in the state
// machine, and by a database trigger that refuses POSTING without
// approved_by/approved_at.

import { createHash, randomUUID } from 'node:crypto';
import { query, queryOne } from '../db';
import { canSpend, JobBudget, jobGuards, xSwitches } from '../channels/x/budget';
import { estimatePostCost } from '../channels/x/pricing';
import { xCreatePost, xFetchMentions, xUploadMedia } from '../channels/x/client';
import { buildEvidencePack } from './evidence';
import { queryGuestlist } from './query';
import { validateDraft } from './validate';
import { defaultWriterClient, TemplateWriterClient, WRITER_META, type IntelligenceWriterClient } from './writer';
import type { EvidencePack } from './types';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';

// Archive rights that permit REDISTRIBUTION to social — website display
// permission is NOT enough. external_reference/unknown/restricted stay off X.
export const SOCIAL_SAFE_RIGHTS = new Set(['guestlist_owned', 'contributor_granted', 'licensed']);

export async function xAudit(action: string, opts: {
  actorId?: string | null; opportunityId?: string | null; draftId?: string | null; detail?: string | null;
} = {}): Promise<void> {
  await query(
    `insert into guestlist_x_audit (action, actor_member_id, opportunity_id, draft_id, detail)
     values ($1, $2, $3, $4, $5)`,
    [action, opts.actorId ?? null, opts.opportunityId ?? null, opts.draftId ?? null, opts.detail ?? null]
  );
}

// ---------------------------------------------------------------------------
// Repetition protection — recently discussed entities + exact wording.
// ---------------------------------------------------------------------------

const REPETITION_WINDOWS: Record<string, string> = {
  event: '7 days', artist: '3 days', promoter: '3 days', venue: '3 days',
  city: '1 day', genre: '1 day', archive_event: '30 days', archive_media: '90 days',
};

export function wordingFingerprint(body: string): string {
  const norm = body.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

type OppRow = {
  id: string; type: string; headline: string; reason: string; suggested_angle: string | null;
  status: string; city: string | null; genres: string[];
  linked_event_ids: string[]; linked_archive_event_ids: string[]; linked_archive_media_ids: string[];
  linked_promoter_ids: string[]; evidence: EvidencePack;
};

async function repetitionProblems(opp: OppRow): Promise<string[]> {
  const problems: string[] = [];
  const checks: [string, string][] = [
    ...opp.linked_event_ids.map((id): [string, string] => ['event', id]),
    ...opp.linked_archive_event_ids.map((id): [string, string] => ['archive_event', id]),
    ...opp.linked_archive_media_ids.map((id): [string, string] => ['archive_media', id]),
    ...opp.linked_promoter_ids.map((id): [string, string] => ['promoter', id]),
    ...(opp.city && opp.genres.length
      ? [['city', opp.city.toLowerCase()] as [string, string],
         ...opp.genres.map((g): [string, string] => ['genre', `${opp.city!.toLowerCase()}:${g.toLowerCase()}`])]
      : []),
  ];
  for (const [kind, key] of checks) {
    const row = await queryOne(
      `select 1 from content_fingerprints
        where kind = $1 and entity_key = $2
          and posted_at > now() - ($3)::interval`,
      [kind, key, REPETITION_WINDOWS[kind] ?? '7 days']
    );
    if (row) problems.push(`Recently covered: ${kind} ${key}`);
  }
  return problems;
}

async function storeFingerprints(draftId: string, opp: OppRow | null, body: string): Promise<void> {
  const rows: [string, string][] = [['wording', wordingFingerprint(body)]];
  if (opp) {
    for (const id of opp.linked_event_ids) rows.push(['event', id]);
    for (const id of opp.linked_archive_event_ids) rows.push(['archive_event', id]);
    for (const id of opp.linked_archive_media_ids) rows.push(['archive_media', id]);
    for (const id of opp.linked_promoter_ids) rows.push(['promoter', id]);
    if (opp.city) {
      rows.push(['city', opp.city.toLowerCase()]);
      for (const g of opp.genres) rows.push(['genre', `${opp.city.toLowerCase()}:${g.toLowerCase()}`]);
    }
  }
  for (const [kind, key] of rows) {
    await query(
      `insert into content_fingerprints (kind, entity_key, draft_id) values ($1, $2, $3)`,
      [kind, key, draftId]
    );
  }
}

// ---------------------------------------------------------------------------
// Draft creation
// ---------------------------------------------------------------------------

export async function createDraftForOpportunity(
  opportunityId: string,
  opts: { writer?: IntelligenceWriterClient; channel?: 'x' | 'website'; actorId?: string | null } = {}
): Promise<{ ok: true; draftId: string; body: string } | { ok: false; error: string; problems?: string[] }> {
  const opp = await queryOne<OppRow>(
    `select id, type, headline, reason, suggested_angle, status, city, genres,
            linked_event_ids, linked_archive_event_ids, linked_archive_media_ids,
            linked_promoter_ids, evidence
       from intelligence_opportunities where id = $1`,
    [opportunityId]
  );
  if (!opp) return { ok: false, error: 'Opportunity not found' };
  if (!['open', 'drafted'].includes(opp.status)) {
    return { ok: false, error: `Opportunity is ${opp.status}` };
  }

  const repeats = await repetitionProblems(opp);
  if (repeats.length) return { ok: false, error: 'Repetition guard', problems: repeats };

  const channel = opts.channel ?? 'x';
  // Fresh evidence at draft time (the stored pack may be hours old).
  const evidence = await buildEvidencePack({
    eventIds: opp.linked_event_ids,
    archiveEventIds: opp.linked_archive_event_ids,
    aggregates: (opp.evidence?.aggregates ?? {}) as Record<string, number | string | null>,
  });

  const writer = opts.writer ?? defaultWriterClient();
  let result = await writer.draft({
    opportunity: {
      type: opp.type as never, headline: opp.headline,
      reason: opp.reason, suggested_angle: opp.suggested_angle,
    },
    evidence, kind: 'post', linkPlanned: true,
  });
  if (!result.ok) {
    // No API key (or model failure): the grounded template writer keeps the
    // desk usable — clearly labelled, still human-approved.
    result = await new TemplateWriterClient().draft({
      opportunity: {
        type: opp.type as never, headline: opp.headline,
        reason: opp.reason, suggested_angle: opp.suggested_angle,
      },
      evidence, kind: 'post', linkPlanned: true,
    });
    if (!result.ok) return { ok: false, error: 'Drafting failed' };
  }

  const validation = validateDraft(result.body, evidence, { hasLink: true });
  if (!validation.ok) {
    await xAudit('draft_rejected_validation', {
      opportunityId, detail: validation.problems.join(' · ').slice(0, 500),
    });
    return { ok: false, error: 'Draft failed fact validation', problems: validation.problems };
  }

  // Media: only archive media whose rights explicitly allow redistribution.
  const media: { archive_media_id: string; path: string; rights: string }[] = [];
  if (opp.linked_archive_media_ids.length) {
    const rows = await query<{ id: string; path: string; rights: string }>(
      `select m.id, coalesce(m.display_path, m.storage_path) as path, m.rights
         from archive_media m
         join archive_items i on i.id = m.item_id and i.status = 'published'
        where m.id = any($1) and not m.hidden`,
      [opp.linked_archive_media_ids]
    );
    for (const r of rows) {
      if (SOCIAL_SAFE_RIGHTS.has(r.rights)) media.push({ archive_media_id: r.id, path: r.path, rights: r.rights });
    }
  }

  const src = `gx-${randomUUID().slice(0, 8)}`;
  const primaryUrl = evidence.events[0]?.url ?? evidence.archive[0]?.url ?? `${SITE}/events`;
  const linkUrl = `${primaryUrl}?src=${src}`;
  const estimated = channel === 'x'
    ? await estimatePostCost({ hasLink: true, mediaCount: media.length })
    : 0;

  const row = await queryOne<{ id: string }>(
    `insert into channel_drafts
       (opportunity_id, channel, kind, body, original_body, media, link_url,
        attribution_src, ai_model, voice_version, prompt_version,
        evidence_snapshot, estimated_cost_usd)
     values ($1, $2, 'post', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [opportunityId, channel, result.body, JSON.stringify(media), linkUrl, src,
     result.model, WRITER_META.voiceVersion, WRITER_META.promptVersion,
     JSON.stringify(evidence), estimated]
  );
  await query(`update intelligence_opportunities set status = 'drafted' where id = $1 and status = 'open'`,
    [opportunityId]);
  await xAudit('drafted', { actorId: opts.actorId, opportunityId, draftId: row!.id, detail: result.model });
  return { ok: true, draftId: row!.id, body: result.body };
}

// ---------------------------------------------------------------------------
// Human decisions — edit / approve / reject / schedule.
// ---------------------------------------------------------------------------

export async function editDraft(draftId: string, body: string, actorId: string):
  Promise<{ ok: true } | { ok: false; error: string; problems?: string[] }> {
  const draft = await queryOne<{ id: string; status: string; evidence_snapshot: EvidencePack }>(
    `select id, status, evidence_snapshot from channel_drafts where id = $1`, [draftId]);
  if (!draft) return { ok: false, error: 'Draft not found' };
  if (!['drafted', 'edited', 'needs_review'].includes(draft.status)) {
    return { ok: false, error: `Cannot edit a ${draft.status} draft` };
  }
  const validation = validateDraft(body, draft.evidence_snapshot, { hasLink: true });
  if (!validation.ok) return { ok: false, error: 'Edit failed fact validation', problems: validation.problems };
  await query(
    `update channel_drafts set body = $2, status = 'edited', edited_by = $3,
            approved_by = null, approved_at = null
      where id = $1`,
    [draftId, body.trim(), actorId]);
  await xAudit('edited', { actorId, draftId });
  return { ok: true };
}

export async function approveDraft(draftId: string, actorId: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await queryOne(
    `update channel_drafts set status = 'approved', approved_by = $2, approved_at = now()
      where id = $1 and status in ('drafted', 'edited', 'needs_review')
      returning id`,
    [draftId, actorId]);
  if (!row) return { ok: false, error: 'Draft not in an approvable state' };
  await xAudit('approved', { actorId, draftId });
  return { ok: true };
}

export const REJECTION_REASONS = [
  'not_interesting', 'too_promotional', 'wrong_tone', 'factually_weak',
  'repetitive', 'bad_timing', 'already_covered', 'other',
] as const;

export async function rejectDraft(draftId: string, actorId: string, reason: string, note?: string | null):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const r = (REJECTION_REASONS as readonly string[]).includes(reason) ? reason : 'other';
  const row = await queryOne<{ opportunity_id: string | null }>(
    `update channel_drafts set status = 'rejected', rejection_reason = $2, rejection_note = $3
      where id = $1 and status in ('drafted', 'edited', 'approved', 'scheduled', 'needs_review', 'budget_paused')
      returning opportunity_id`,
    [draftId, r, note?.slice(0, 500) ?? null]);
  if (!row) return { ok: false, error: 'Draft not in a rejectable state' };
  await xAudit('rejected', { actorId, draftId, detail: r });
  return { ok: true };
}

export async function scheduleDraft(draftId: string, actorId: string, whenIso: string, timezone: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const when = new Date(whenIso);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
    return { ok: false, error: 'Schedule time must be in the future' };
  }
  if (!timezone) return { ok: false, error: 'An explicit timezone is required' };
  const row = await queryOne(
    `update channel_drafts set status = 'scheduled', scheduled_for = $2, schedule_timezone = $3
      where id = $1 and status = 'approved' returning id`,
    [draftId, when, timezone]);
  if (!row) return { ok: false, error: 'Only approved drafts can be scheduled' };
  await xAudit('scheduled', { actorId, draftId, detail: `${whenIso} ${timezone}` });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pre-publish revalidation — reality wins over stale drafts.
// ---------------------------------------------------------------------------

async function revalidateDraft(draft: {
  id: string; evidence_snapshot: EvidencePack; media: { archive_media_id: string }[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const ev of draft.evidence_snapshot.events) {
    const row = await queryOne<{
      status: string; listing_status: string; start_at: string; venue: string | null;
    }>(
      `select e.status, e.listing_status, e.start_at::text, v.name as venue
         from events e left join venues v on v.id = e.venue_id where e.id = $1`,
      [ev.id]);
    if (!row || row.status !== 'live') return { ok: false, reason: `"${ev.title}" is no longer published` };
    if (row.listing_status === 'cancelled') return { ok: false, reason: `"${ev.title}" was cancelled` };
    if (row.listing_status === 'postponed') return { ok: false, reason: `"${ev.title}" was postponed` };
    if (row.start_at !== ev.start_at) return { ok: false, reason: `"${ev.title}" changed date/time` };
    if ((row.venue ?? null) !== (ev.venue ?? null)) return { ok: false, reason: `"${ev.title}" changed venue` };
  }
  for (const a of draft.evidence_snapshot.archive) {
    const row = await queryOne<{ status: string }>(
      `select status from archive_events where id = $1`, [a.id]);
    if (!row || row.status !== 'published') return { ok: false, reason: `Archive item "${a.title}" is no longer published` };
  }
  for (const m of draft.media ?? []) {
    const row = await queryOne<{ rights: string; hidden: boolean; item_status: string }>(
      `select m.rights, m.hidden, i.status as item_status
         from archive_media m join archive_items i on i.id = m.item_id where m.id = $1`,
      [m.archive_media_id]);
    if (!row || row.hidden || row.item_status !== 'published' || !SOCIAL_SAFE_RIGHTS.has(row.rights)) {
      return { ok: false, reason: 'Attached archive media no longer has redistribution rights' };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publishing — POST NOW and the scheduled processor share this path.
// ---------------------------------------------------------------------------

export async function publishDraft(
  draftId: string,
  opts: { actorId?: string | null; override?: boolean; job?: string | null } = {}
): Promise<{ ok: true; externalId: string } | { ok: false; error: string; state: string }> {
  const draft = await queryOne<{
    id: string; channel: string; kind: string; body: string; link_url: string | null;
    status: string; media: { archive_media_id: string; path: string }[];
    evidence_snapshot: EvidencePack; reply_to_mention_id: string | null;
    opportunity_id: string | null; estimated_cost_usd: number;
  }>(
    `select id, channel, kind, body, link_url, status, media, evidence_snapshot,
            reply_to_mention_id, opportunity_id, estimated_cost_usd::float8 as estimated_cost_usd
       from channel_drafts where id = $1`,
    [draftId]);
  if (!draft) return { ok: false, error: 'Draft not found', state: 'missing' };
  if (!['approved', 'scheduled', 'budget_paused'].includes(draft.status)) {
    return { ok: false, error: `Draft is ${draft.status} — approval is required before publishing`, state: draft.status };
  }

  const switches = await xSwitches();
  if (draft.channel === 'x') {
    if (!switches.posting && !opts.override) {
      return { ok: false, error: 'X posting is paused', state: draft.status };
    }
    if (draft.kind === 'reply' && !switches.replies && !opts.override) {
      return { ok: false, error: 'X replies are paused', state: draft.status };
    }
  }

  // REVALIDATE against live data — including after a budget pause; stale
  // content never ships just because a new billing period opened.
  const revalidation = await revalidateDraft(draft);
  if (!revalidation.ok) {
    await query(
      `update channel_drafts set status = 'needs_review', needs_review_reason = $2,
              approved_by = null, approved_at = null
        where id = $1`,
      [draftId, revalidation.reason]);
    await xAudit('needs_review', { draftId, detail: revalidation.reason });
    return { ok: false, error: `Facts changed: ${revalidation.reason}`, state: 'needs_review' };
  }

  // WEBSITE channel: publishing = making it live on Guestlist surfaces.
  if (draft.channel === 'website') {
    await query(
      `update channel_drafts set status = 'posting' where id = $1`, [draftId]);
    await query(
      `update channel_drafts set status = 'posted', posted_at = now() where id = $1`, [draftId]);
    if (draft.opportunity_id) {
      await query(`update intelligence_opportunities set status = 'published' where id = $1`,
        [draft.opportunity_id]);
    }
    await xAudit('posted_website', { actorId: opts.actorId, draftId });
    return { ok: true, externalId: 'website' };
  }

  // BUDGET GATE (layer 1). Exhausted budget parks the draft, never fails it.
  const gate = await canSpend(draft.estimated_cost_usd, 'high', { override: opts.override });
  if (!gate.ok) {
    if (gate.reason.startsWith('BUDGET_PAUSED')) {
      await query(`update channel_drafts set status = 'budget_paused' where id = $1`, [draftId]);
      await xAudit('budget_paused', { draftId, detail: gate.reason });
      return { ok: false, error: gate.reason, state: 'budget_paused' };
    }
    return { ok: false, error: gate.reason, state: draft.status };
  }
  if (opts.override) {
    await xAudit('budget_override', { actorId: opts.actorId, draftId, detail: 'POST ONCE ANYWAY' });
  }

  // POSTING — the database trigger re-checks human approval right here.
  const transitioned = await queryOne(
    `update channel_drafts set status = 'posting'
      where id = $1 and status in ('approved', 'scheduled', 'budget_paused') returning id`,
    [draftId]);
  if (!transitioned) return { ok: false, error: 'Draft state changed underneath us', state: 'conflict' };

  // Media (rights re-checked above).
  const mediaIds: string[] = [];
  for (const m of draft.media ?? []) {
    const up = await xUploadMedia({
      bytes: Buffer.from(m.archive_media_id), mime: 'image/jpeg',
      priority: 'high', draftId,
    });
    if (up.ok) mediaIds.push(up.mediaId);
    else {
      await query(
        `update channel_drafts set status = 'needs_review', needs_review_reason = $2,
                approved_by = null, approved_at = null where id = $1`,
        [draftId, `Media upload failed: ${up.error}`]);
      await xAudit('needs_review', { draftId, detail: `media: ${up.error}` });
      return { ok: false, error: up.error, state: 'needs_review' };
    }
  }

  let replyTo: string | null = null;
  if (draft.kind === 'reply' && draft.reply_to_mention_id) {
    const mention = await queryOne<{ external_id: string }>(
      `select external_id from x_mentions where id = $1`, [draft.reply_to_mention_id]);
    replyTo = mention?.external_id ?? null;
  }

  const text = draft.link_url ? `${draft.body}\n${draft.link_url}` : draft.body;
  const result = await xCreatePost({
    text, replyToExternalId: replyTo, mediaIds,
    hasLink: !!draft.link_url, priority: 'high', draftId, job: opts.job ?? null,
  });

  if (result.ok) {
    await query(
      `update channel_drafts set status = 'posted', posted_at = now(),
              external_id = $2, post_url = $3, error = null
        where id = $1`,
      [draftId, result.externalId, `https://x.com/i/status/${result.externalId}`]);
    const opp = draft.opportunity_id
      ? await queryOne<OppRow>(
          `select id, type, headline, reason, suggested_angle, status, city, genres,
                  linked_event_ids, linked_archive_event_ids, linked_archive_media_ids,
                  linked_promoter_ids, evidence
             from intelligence_opportunities where id = $1`, [draft.opportunity_id])
      : null;
    await storeFingerprints(draftId, opp ?? null, draft.body);
    if (draft.opportunity_id) {
      await query(`update intelligence_opportunities set status = 'published' where id = $1`,
        [draft.opportunity_id]);
    }
    if (draft.reply_to_mention_id) {
      await query(`update x_mentions set status = 'replied' where id = $1`, [draft.reply_to_mention_id]);
    }
    await xAudit('posted', { actorId: opts.actorId, draftId, detail: result.externalId });
    return { ok: true, externalId: result.externalId };
  }

  if (result.uncertain) {
    // The write MAY have landed — never blind-retry an uncertain X write.
    await query(
      `update channel_drafts set status = 'needs_review',
              needs_review_reason = 'Uncertain X result: verify on x.com/guestlist before retrying',
              approved_by = null, approved_at = null, error = $2
        where id = $1`,
      [draftId, result.error]);
    await xAudit('uncertain_write', { draftId, detail: result.error });
    return { ok: false, error: result.error, state: 'needs_review' };
  }
  if (result.error.startsWith('CIRCUIT_OPEN')) {
    // The breaker is protective, not fatal: park as scheduled and retry
    // once the circuit closes.
    await query(
      `update channel_drafts set status = 'scheduled',
              scheduled_for = coalesce(scheduled_for, now() + interval '1 hour'), error = $2
        where id = $1`,
      [draftId, result.error]);
    return { ok: false, error: result.error, state: 'scheduled' };
  }
  if (result.rateLimited) {
    // Rate limit: back to scheduled; the next run retries.
    await query(
      `update channel_drafts set status = 'scheduled',
              scheduled_for = coalesce(scheduled_for, now() + interval '20 minutes'), error = $2
        where id = $1`,
      [draftId, result.error]);
    return { ok: false, error: result.error, state: 'scheduled' };
  }
  await query(
    `update channel_drafts set status = 'failed', error = $2 where id = $1`,
    [draftId, result.error]);
  await xAudit('post_failed', { draftId, detail: result.error });
  return { ok: false, error: result.error, state: 'failed' };
}

// The scheduled processor: due scheduled drafts + budget-paused retries.
export async function processScheduledDrafts(job = 'guestlist-x'): Promise<{
  attempted: number; posted: number; parked: number;
}> {
  const guards = await jobGuards();
  const budget = new JobBudget(guards, job);
  const due = await query<{ id: string; estimated_cost_usd: number }>(
    `select id, estimated_cost_usd::float8 as estimated_cost_usd from channel_drafts
      where channel = 'x'
        and ((status = 'scheduled' and scheduled_for <= now())
             or status = 'budget_paused')
      order by scheduled_for nulls first
      limit 10`
  );
  let attempted = 0;
  let posted = 0;
  let parked = 0;
  for (const d of due) {
    if (!budget.take(d.estimated_cost_usd)) {
      await xAudit('job_guard_stop', { draftId: d.id, detail: `${job}: per-job cap reached` });
      break;
    }
    attempted++;
    const result = await publishDraft(d.id, { job });
    if (result.ok) posted++;
    else if (!result.ok && result.state === 'budget_paused') parked++;
  }
  return { attempted, posted, parked };
}

// ---------------------------------------------------------------------------
// Mentions — ingestion, deterministic classification, grounded reply drafts.
// NO automatic replies: a reply is just another draft awaiting approval.
// ---------------------------------------------------------------------------

const ABUSE_WORDS = ['fuck you', 'kill yourself', 'kys', 'scum'];
const SPAM_MARKERS = ['crypto', 'giveaway', 'follow back', 'promo dm', 'onlyfans'];

export async function classifyMentionText(text: string): Promise<{
  classification: string;
  intent: Record<string, string | null>;
}> {
  const lower = text.toLowerCase();
  if (ABUSE_WORDS.some((w) => lower.includes(w))) return { classification: 'ABUSE', intent: {} };
  if (SPAM_MARKERS.some((w) => lower.includes(w))) return { classification: 'SPAM', intent: {} };
  if (/list my event|submit .*event|add our (night|event|party)/.test(lower)) {
    return { classification: 'EVENT_SUBMISSION', intent: {} };
  }
  // Grounded entity detection against REAL Guestlist data.
  const cities = await query<{ name: string }>(`select name from locations`);
  const city = cities.find((c) => lower.includes(c.name.toLowerCase()))?.name ?? null;
  const genres = await query<{ name: string }>(`select name from genres`);
  const genre = genres
    .filter((g) => g.name.length > 2)
    .sort((a, b) => b.name.length - a.name.length)
    .find((g) => lower.includes(g.name.toLowerCase()))?.name ?? null;
  const date = /tonight|tonite/.test(lower) ? 'tonight' : /weekend/.test(lower) ? 'weekend' : null;
  const asksQuestion = text.includes('?') || /what'?s (good|on)|where (should|can)|any (events|nights|parties)|recommend/.test(lower);
  if (asksQuestion && (city || genre || date)) {
    return { classification: 'EVENT_QUESTION', intent: { city, genre, date } };
  }
  if (/promoter|our event|we('re| are) (hosting|throwing)/.test(lower)) {
    return { classification: 'PROMOTER', intent: {} };
  }
  return { classification: 'GENERAL_MENTION', intent: { city, genre, date } };
}

export async function ingestMentions(job = 'x-mentions'): Promise<{
  fetched: number; stored: number; skipped: string | null;
}> {
  const switches = await xSwitches();
  if (!switches.automation || !switches.mention_sync) {
    return { fetched: 0, stored: 0, skipped: 'mention sync is paused' };
  }
  const guards = await jobGuards();
  const budget = new JobBudget(guards, job);
  const maxResults = 25;
  const { estimateMentionSyncCost } = await import('../channels/x/pricing');
  const estimated = await estimateMentionSyncCost(maxResults);
  const gate = await canSpend(estimated, 'medium');
  if (!gate.ok) return { fetched: 0, stored: 0, skipped: gate.reason };
  if (!budget.take(estimated)) return { fetched: 0, stored: 0, skipped: 'per-job cap' };

  const result = await xFetchMentions({ maxResults, priority: 'medium', job });
  if (!result.ok) return { fetched: 0, stored: 0, skipped: result.error };

  let stored = 0;
  for (const m of result.mentions) {
    const { classification, intent } = await classifyMentionText(m.text);
    const row = await queryOne(
      `insert into x_mentions
         (external_id, author_handle, author_external_id, text, conversation_id,
          created_at_x, classification, intent, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'classified')
       on conflict (external_id) do nothing returning id`,
      [m.external_id, m.author_handle, m.author_external_id, m.text,
       m.conversation_id, m.created_at_x, classification, JSON.stringify(intent)]
    );
    if (row) stored++;
  }
  // Cursor moves forward only — a bad run can never re-read history forever.
  if (result.newestId) {
    await query(
      `update social_accounts set mention_cursor = $1
        where platform = 'x'
          and (mention_cursor is null or $1::numeric > mention_cursor::numeric)`,
      [result.newestId]);
  }
  return { fetched: result.mentions.length, stored, skipped: null };
}

// A grounded reply draft for an event question — requires human approval
// like everything else. AI never answers from imagination: intent →
// queryGuestlist → real events → fact pack → language.
export async function draftReplyForMention(
  mentionId: string,
  opts: { writer?: IntelligenceWriterClient; actorId?: string | null } = {}
): Promise<{ ok: true; draftId: string; body: string; matched: number } | { ok: false; error: string }> {
  const mention = await queryOne<{
    id: string; text: string; classification: string | null;
    intent: { city?: string | null; genre?: string | null; date?: string | null };
    external_id: string; status: string; conversation_id: string | null;
  }>(
    `select id, text, classification, intent, external_id, status, conversation_id
       from x_mentions where id = $1`,
    [mentionId]);
  if (!mention) return { ok: false, error: 'Mention not found' };
  if (mention.classification !== 'EVENT_QUESTION') {
    return { ok: false, error: 'Only event questions get grounded reply drafts' };
  }

  // V2H: the SAME Ask brain parses the question, and X threads keep a
  // bounded conversation state — "Anything smaller?" in a reply inherits
  // the city and date from the parent question.
  const { parseAskQuestion, mergeIntent } = await import('../ask/intent');
  const { resolveDateWindow, cityTimezone } = await import('../ask/tools');
  const parsed = await parseAskQuestion(mention.text);
  const externalRef = mention.conversation_id ? `x:${mention.conversation_id}` : null;
  let askIntent = parsed;
  if (externalRef) {
    const conv = await queryOne<{ id: string; state: typeof parsed }>(
      `select id, state from ask_conversations where external_ref = $1`, [externalRef]);
    if (conv && conv.state && Object.keys(conv.state).length) {
      askIntent = mergeIntent(conv.state, parsed, mention.text);
    }
    if (conv) {
      await query(`update ask_conversations set state = $2, updated_at = now() where id = $1`,
        [conv.id, JSON.stringify(askIntent)]);
    } else {
      await query(
        `insert into ask_conversations (channel, external_ref, state) values ('x', $1, $2)`,
        [externalRef, JSON.stringify(askIntent)]);
    }
  }

  let dateParam: string | null = askIntent.date?.kind === 'weekend' || askIntent.date?.kind === 'next_weekend'
    ? 'weekend'
    : askIntent.date?.kind === 'iso' ? askIntent.date.date : 'tonight';
  if (askIntent.date?.kind === 'day') {
    const tz = await cityTimezone(askIntent.city);
    dateParam = resolveDateWindow(askIntent.date, tz).from.toISOString().slice(0, 10);
  }

  const q = await queryGuestlist({
    city: askIntent.city ?? mention.intent.city ?? null,
    date: (dateParam as 'tonight' | 'weekend') ?? 'tonight',
    genre: askIntent.genres[0] ?? mention.intent.genre ?? null,
    lateNight: askIntent.lateNight ?? undefined,
    daytime: askIntent.daytime ?? undefined,
    limit: 3,
  });

  const writer = opts.writer ?? defaultWriterClient();
  let result = await writer.draft({
    opportunity: {
      type: 'EDITORIAL_OBSERVATION' as never,
      headline: `Reply to a question: ${mention.text.slice(0, 100)}`,
      reason: q.matched > 0
        ? `${q.matched} real matching events found by Guestlist`
        : 'No matching events found — be honest that it is quiet',
      suggested_angle: null,
    },
    evidence: q.evidence, kind: 'reply', replyToText: mention.text, linkPlanned: q.matched > 0,
  });
  if (!result.ok) {
    result = await new TemplateWriterClient().draft({
      opportunity: {
        type: 'EDITORIAL_OBSERVATION' as never,
        headline: q.matched > 0 ? 'Worth a look:' : 'Honestly? Quiet on our radar for that.',
        reason: '', suggested_angle: q.matched > 0 ? 'Worth a look:' : 'Quiet night on our radar. We\'ll say so when that changes.',
      },
      evidence: q.evidence, kind: 'reply', replyToText: mention.text, linkPlanned: q.matched > 0,
    });
    if (!result.ok) return { ok: false, error: 'Drafting failed' };
  }
  const validation = validateDraft(result.body, q.evidence, { hasLink: q.matched > 0 });
  if (!validation.ok) return { ok: false, error: `Reply failed fact validation: ${validation.problems.join(' · ')}` };

  const src = `gx-${randomUUID().slice(0, 8)}`;
  const linkUrl = q.matched > 0 ? `${q.evidence.events[0].url}?src=${src}` : null;
  const estimated = await estimatePostCost({ hasLink: !!linkUrl, mediaCount: 0 });
  const row = await queryOne<{ id: string }>(
    `insert into channel_drafts
       (channel, kind, reply_to_mention_id, body, original_body, link_url,
        attribution_src, ai_model, voice_version, prompt_version,
        evidence_snapshot, estimated_cost_usd)
     values ('x', 'reply', $1, $2, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [mentionId, result.body, linkUrl, linkUrl ? src : null, result.model,
     WRITER_META.voiceVersion, WRITER_META.promptVersion,
     JSON.stringify(q.evidence), estimated]);
  await query(
    `update x_mentions set status = 'drafted', draft_id = $2, matched_event_ids = $3,
            intent = intent || $4 where id = $1`,
    [mentionId, row!.id, q.eventIds, JSON.stringify({
      ask: { city: askIntent.city, genres: askIntent.genres, date: askIntent.date,
             sizePref: askIntent.sizePref ?? null },
    })]);
  await xAudit('reply_drafted', { actorId: opts.actorId, draftId: row!.id, detail: mention.external_id });
  return { ok: true, draftId: row!.id, body: result.body, matched: q.matched };
}

// LIMITED AUTOPILOT FOUNDATION (V2H Part 34) — eligibility only, never
// posting. AUTO_REPLY defaults OFF; the switch ('x_switches'.auto_reply)
// is experimental and nothing in the codebase acts on eligibility yet:
// every reply still goes through the human-approval inbox.
export async function askAutoReplyEligible(mentionId: string): Promise<{ eligible: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const switches = await xSwitches();
  if (!(switches as Record<string, boolean>).auto_reply) reasons.push('AUTO_REPLY is off (default)');
  const m = await queryOne<{
    classification: string | null; intent: { ask?: { city?: string | null; genres?: string[]; date?: { kind?: string } } };
    matched_event_ids: string[]; status: string;
  }>(`select classification, intent, matched_event_ids, status from x_mentions where id = $1`, [mentionId]);
  if (!m) return { eligible: false, reasons: ['mention not found'] };
  if (m.classification !== 'EVENT_QUESTION') reasons.push('not an event question');
  const ask = m.intent?.ask;
  // The narrow future category: TONIGHT + CITY + GENRE with real results.
  if (!ask?.city || !ask.genres?.length || ask.date?.kind !== 'tonight') {
    reasons.push('not a high-confidence tonight+city+genre question');
  }
  if (!m.matched_event_ids?.length) reasons.push('no real results');
  if (m.status !== 'drafted') reasons.push('no validated draft yet');
  const spend = await canSpend(0.02, 'low');
  if (!spend.ok) reasons.push('budget unavailable');
  return { eligible: reasons.length === 0, reasons };
}

// Attribution report: DID @guestlist create useful activity INSIDE Guestlist?
export async function attributionForDraft(draftId: string): Promise<{
  src: string | null; views: number; ticket_clicks: number;
}> {
  const draft = await queryOne<{ attribution_src: string | null }>(
    `select attribution_src from channel_drafts where id = $1`, [draftId]);
  if (!draft?.attribution_src) return { src: null, views: 0, ticket_clicks: 0 };
  const row = await queryOne<{ views: number; clicks: number }>(
    `select
       count(*) filter (where event_type = 'event_viewed')::int as views,
       count(*) filter (where event_type = 'ticket_clicked')::int as clicks
       from analytics_events where metadata->>'src' = $1`,
    [draft.attribution_src]);
  return { src: draft.attribution_src, views: row?.views ?? 0, ticket_clicks: row?.clicks ?? 0 };
}
