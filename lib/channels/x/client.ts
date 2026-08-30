// X CHANNEL ADAPTER — the only code that talks to api.x.com.
//
// It authenticates, posts, replies, uploads media, reads mentions, records
// usage/cost, and handles rate limits and uncertain writes. It has NO
// opinion about what is culturally interesting — that's the Intelligence
// Core's job.
//
// A transport seam makes the whole adapter deterministic in tests and in
// environments with no X credentials: when system_settings.x_mock.enabled
// is true (or no account is connected), operations run against the mock
// transport, which honours scripted failures/uncertainty, generates stable
// IDs and still writes the usage ledger.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { query, queryOne } from '../../db';
import { getSetting, setSetting } from '../../settings';
import { recordCircuit, circuitOpen, recordUsage, type XPriority } from './budget';
import { xPricing } from './pricing';

const X_API = 'https://api.x.com';

// ---------------------------------------------------------------------------
// Token encryption — AES-256-GCM, key derived from X_TOKEN_SECRET (or
// SESSION_SECRET). Tokens never reach the browser and are never logged.
// ---------------------------------------------------------------------------

function tokenKey(): Buffer {
  const secret = process.env.X_TOKEN_SECRET || process.env.SESSION_SECRET || 'dev-secret';
  return createHash('sha256').update(`x-tokens:${secret}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptToken(stored: string): string | null {
  try {
    const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Account state
// ---------------------------------------------------------------------------

export type XAccount = {
  id: string;
  handle: string | null;
  external_user_id: string | null;
  status: string;
  token_expires_at: string | null;
  scopes: string[];
  last_api_call_at: string | null;
  last_post_at: string | null;
  last_mention_sync_at: string | null;
  mention_cursor: string | null;
  last_error: string | null;
  connected_at: string | null;
};

export async function xAccount(): Promise<XAccount | null> {
  return queryOne<XAccount>(
    `select id, handle, external_user_id, status, token_expires_at::text, scopes,
            last_api_call_at::text, last_post_at::text, last_mention_sync_at::text,
            mention_cursor, last_error, connected_at::text
       from social_accounts where platform = 'x'`
  );
}

async function accessToken(): Promise<string | null> {
  const row = await queryOne<{ access_token_enc: string | null }>(
    `select access_token_enc from social_accounts where platform = 'x' and status = 'connected'`
  );
  return row?.access_token_enc ? decryptToken(row.access_token_enc) : null;
}

async function touchAccount(patch: { post?: boolean; mentionSync?: boolean; error?: string | null }): Promise<void> {
  await query(
    `update social_accounts set
        last_api_call_at = now(),
        last_post_at = case when $1 then now() else last_post_at end,
        last_mention_sync_at = case when $2 then now() else last_mention_sync_at end,
        last_error = $3
      where platform = 'x'`,
    [patch.post ?? false, patch.mentionSync ?? false, patch.error ?? null]
  );
}

// ---------------------------------------------------------------------------
// Transport seam
// ---------------------------------------------------------------------------

export type XResponse = {
  status: number;
  json: Record<string, unknown> | null;
  requestId: string | null;
  uncertain?: boolean; // the request MAY have succeeded — do not blind-retry
};

type MockConfig = {
  enabled?: boolean;
  fail_next?: boolean;         // next write returns 500
  uncertain_next?: boolean;    // next write "times out" after send
  rate_limit_next?: boolean;   // next call returns 429
  mentions?: {
    id: string; text: string; author_handle?: string; author_id?: string;
    conversation_id?: string; created_at?: string;
  }[];
};

async function mockConfig(): Promise<MockConfig> {
  return (await getSetting<MockConfig>('x_mock')) ?? {};
}

async function consumeMockFlag(flag: 'fail_next' | 'uncertain_next' | 'rate_limit_next'): Promise<boolean> {
  const cfg = await mockConfig();
  if (!cfg[flag]) return false;
  await setSetting('x_mock', { ...cfg, [flag]: false }, null);
  return true;
}

export async function xMockEnabled(): Promise<boolean> {
  const cfg = await mockConfig();
  if (cfg.enabled) return true;
  const account = await xAccount();
  return !account || account.status !== 'connected';
}

async function mockRequest(method: string, path: string): Promise<XResponse> {
  if (await consumeMockFlag('rate_limit_next')) {
    return { status: 429, json: { title: 'Too Many Requests' }, requestId: `mock-${randomUUID().slice(0, 8)}` };
  }
  if (method === 'POST' && await consumeMockFlag('fail_next')) {
    return { status: 500, json: { title: 'Internal Server Error' }, requestId: `mock-${randomUUID().slice(0, 8)}` };
  }
  if (method === 'POST' && await consumeMockFlag('uncertain_next')) {
    return { status: 0, json: null, requestId: null, uncertain: true };
  }
  const requestId = `mock-${randomUUID().slice(0, 8)}`;
  if (path.startsWith('/2/tweets') && method === 'POST') {
    return { status: 201, json: { data: { id: `18${Date.now()}${Math.floor(Math.random() * 1000)}` } }, requestId };
  }
  if (path.includes('/mentions')) {
    const cfg = await mockConfig();
    const account = await xAccount();
    const since = account?.mention_cursor;
    const mentions = (cfg.mentions ?? []).filter((m) => !since || BigInt(m.id) > BigInt(since));
    return {
      status: 200,
      json: {
        data: mentions.map((m) => ({
          id: m.id, text: m.text, author_id: m.author_id ?? 'mock-author',
          conversation_id: m.conversation_id ?? m.id, created_at: m.created_at ?? new Date().toISOString(),
        })),
        includes: { users: mentions.map((m) => ({ id: m.author_id ?? 'mock-author', username: m.author_handle ?? 'raver' })) },
        meta: { result_count: mentions.length, newest_id: mentions[0]?.id },
      },
      requestId,
    };
  }
  if (path.startsWith('/2/media')) {
    return { status: 200, json: { data: { id: `media-${randomUUID().slice(0, 8)}` } }, requestId };
  }
  if (path.startsWith('/2/users/me')) {
    return { status: 200, json: { data: { id: 'mock-guestlist', username: 'guestlist' } }, requestId };
  }
  if (method === 'GET' && path.startsWith('/2/tweets/')) {
    return { status: 200, json: { data: { id: path.split('/').pop() } }, requestId };
  }
  return { status: 200, json: {}, requestId };
}

async function realRequest(
  method: string, path: string,
  body?: Record<string, unknown> | null
): Promise<XResponse> {
  const token = await accessToken();
  if (!token) return { status: 401, json: { title: 'No connected X account' }, requestId: null };
  try {
    const res = await fetch(`${X_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, requestId: res.headers.get('x-request-id') };
  } catch (err) {
    // The write may or may not have landed — NEVER blind-retry.
    return { status: 0, json: { error: String(err).slice(0, 200) }, requestId: null, uncertain: method !== 'GET' };
  }
}

async function xRequest(method: string, path: string, body?: Record<string, unknown> | null): Promise<XResponse> {
  return (await xMockEnabled()) ? mockRequest(method, path) : realRequest(method, path, body);
}

// ---------------------------------------------------------------------------
// Operations — each records usage + circuit state.
// ---------------------------------------------------------------------------

export type PostResult =
  | { ok: true; externalId: string; requestId: string | null }
  | { ok: false; error: string; uncertain?: boolean; rateLimited?: boolean };

export async function xCreatePost(input: {
  text: string;
  replyToExternalId?: string | null;
  mediaIds?: string[];
  hasLink: boolean;
  priority: XPriority;
  draftId?: string | null;
  job?: string | null;
}): Promise<PostResult> {
  const op = input.replyToExternalId ? 'reply_create' : (input.hasLink ? 'post_create_link' : 'post_create');
  if (await circuitOpen('post_create')) {
    return { ok: false, error: 'CIRCUIT_OPEN: posting paused after repeated failures' };
  }
  const pricing = await xPricing();
  const estimated = input.hasLink ? pricing.post_create_link : pricing.post_create;
  const body: Record<string, unknown> = { text: input.text };
  if (input.replyToExternalId) body.reply = { in_reply_to_tweet_id: input.replyToExternalId };
  if (input.mediaIds?.length) body.media = { media_ids: input.mediaIds };

  const res = await xRequest('POST', '/2/tweets', body);
  await recordUsage({
    operation: op, endpoint: 'POST /2/tweets', estimatedCostUsd: estimated,
    priority: input.priority, httpStatus: res.status, xRequestId: res.requestId,
    draftId: input.draftId ?? null, job: input.job ?? null,
  });
  if (res.uncertain) {
    await recordCircuit('post_create', false);
    await touchAccount({ error: 'uncertain write on POST /2/tweets' });
    return { ok: false, error: 'Uncertain result: the post may or may not have published', uncertain: true };
  }
  const id = (res.json as { data?: { id?: string } } | null)?.data?.id;
  if (res.status === 201 && id) {
    await recordCircuit('post_create', true);
    await touchAccount({ post: true, error: null });
    return { ok: true, externalId: id, requestId: res.requestId };
  }
  await recordCircuit('post_create', false);
  const detail = JSON.stringify(res.json)?.slice(0, 200);
  await touchAccount({ error: `POST /2/tweets ${res.status}: ${detail}` });
  return { ok: false, error: `X API ${res.status}: ${detail}`, rateLimited: res.status === 429 };
}

// Verify whether an uncertain write actually landed (CRITICAL priority read).
export async function xVerifyPost(externalId: string): Promise<boolean> {
  const pricing = await xPricing();
  const res = await xRequest('GET', `/2/tweets/${externalId}`);
  await recordUsage({
    operation: 'post_read', endpoint: 'GET /2/tweets/:id', estimatedCostUsd: pricing.post_read,
    priority: 'critical', httpStatus: res.status, xRequestId: res.requestId,
  });
  return res.status === 200;
}

export async function xUploadMedia(input: {
  bytes: Buffer; mime: string; priority: XPriority; draftId?: string | null;
}): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const pricing = await xPricing();
  // v2 media upload (initialize/append/finalize consolidated for our sizes).
  const res = await xRequest('POST', '/2/media/upload', {
    media_category: 'tweet_image', media_type: input.mime,
    total_bytes: input.bytes.length,
  });
  await recordUsage({
    operation: 'media_upload', endpoint: 'POST /2/media/upload',
    estimatedCostUsd: pricing.media_upload, priority: input.priority,
    httpStatus: res.status, xRequestId: res.requestId, draftId: input.draftId ?? null,
  });
  const id = (res.json as { data?: { id?: string } } | null)?.data?.id;
  if (res.status === 200 && id) return { ok: true, mediaId: id };
  return { ok: false, error: `media upload failed (${res.status})` };
}

export type FetchedMention = {
  external_id: string; text: string; author_handle: string | null;
  author_external_id: string | null; conversation_id: string | null; created_at_x: string | null;
};

export async function xFetchMentions(opts: {
  maxResults: number; priority: XPriority; job?: string | null;
}): Promise<{ ok: true; mentions: FetchedMention[]; newestId: string | null } | { ok: false; error: string }> {
  if (await circuitOpen('mention_read')) {
    return { ok: false, error: 'CIRCUIT_OPEN: mention sync paused after repeated failures' };
  }
  const account = await xAccount();
  const userId = account?.external_user_id ?? 'me';
  const pricing = await xPricing();
  const since = account?.mention_cursor ? `&since_id=${account.mention_cursor}` : '';
  const res = await xRequest('GET',
    `/2/users/${userId}/mentions?max_results=${opts.maxResults}&expansions=author_id&tweet.fields=conversation_id,created_at${since}`);
  const data = res.json as {
    data?: { id: string; text: string; author_id?: string; conversation_id?: string; created_at?: string }[];
    includes?: { users?: { id: string; username: string }[] };
    meta?: { newest_id?: string };
  } | null;
  const returned = data?.data?.length ?? 0;
  await recordUsage({
    operation: 'mention_read', endpoint: 'GET /2/users/:id/mentions',
    resources: Math.max(1, returned),
    estimatedCostUsd: Math.max(1, returned) * pricing.post_read,
    priority: opts.priority, httpStatus: res.status, xRequestId: res.requestId, job: opts.job ?? null,
  });
  if (res.status !== 200) {
    await recordCircuit('mention_read', false);
    return { ok: false, error: `mentions fetch failed (${res.status})` };
  }
  await recordCircuit('mention_read', true);
  await touchAccount({ mentionSync: true, error: null });
  const users = new Map((data?.includes?.users ?? []).map((u) => [u.id, u.username]));
  return {
    ok: true,
    newestId: data?.meta?.newest_id ?? null,
    mentions: (data?.data ?? []).map((m) => ({
      external_id: m.id, text: m.text,
      author_handle: m.author_id ? (users.get(m.author_id) ?? null) : null,
      author_external_id: m.author_id ?? null,
      conversation_id: m.conversation_id ?? null,
      created_at_x: m.created_at ?? null,
    })),
  };
}
