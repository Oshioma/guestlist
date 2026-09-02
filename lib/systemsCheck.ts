// SYSTEMS CHECK: is everything this deployment leans on actually wired up?
//
// Two kinds of answer live here. "Is the variable set" is cheap and comes
// from the process environment; "does the key work" costs one small request
// to the provider (a Stripe price, Resend's domain list, Anthropic's model
// list…) and is only ever run from the admin page. Nothing here prints a
// secret: the page says set / not set, never what.

import { query, queryOne } from './db';
import { auditSchema } from './schemaAudit';
import { getPlan, formatPence } from './membership';
import { stripeRequest, StripeError } from './stripe';

export type Verdict = 'ok' | 'warn' | 'bad' | 'off';
export type Check = { name: string; verdict: Verdict; detail: string; hint?: string };
export type Group = { key: string; name: string; blurb: string; checks: Check[] };
export type SystemsReport = { groups: Group[]; bad: number; warn: number; ranAt: string };

const env = (k: string) => (process.env[k] ?? '').trim();
const isSet = (k: string) => env(k).length > 0;
const TIMEOUT_MS = 6000;

// Every request to a provider gets the same short leash: a slow provider
// should show as "slow", not hang the page.
async function ping(url: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.text().catch(() => '') };
}

function failed(name: string, err: unknown, hint?: string): Check {
  const msg = err instanceof Error ? err.message : String(err);
  const detail = /timeout|abort/i.test(msg) ? `No answer within ${TIMEOUT_MS / 1000}s` : msg.slice(0, 160);
  return { name, verdict: 'bad', detail, hint };
}

function ago(d: string | Date | null | undefined): string {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Every variable the code reads, so the page can say which are set.
export const ENV_INVENTORY: { group: string; vars: { name: string; why: string; required?: boolean; devOnly?: boolean }[] }[] = [
  { group: 'Core', vars: [
    { name: 'DATABASE_URL', why: 'Postgres connection', required: true },
    { name: 'SESSION_SECRET', why: 'Signs login cookies and unsubscribe links', required: true },
    { name: 'SITE_URL', why: 'Absolute links in emails and Stripe redirects' },
    { name: 'SUPPLY_CRON_SECRET', why: 'Lets the scheduled jobs in (emails, scans, cleanup)', required: true },
    { name: 'CRON_SECRET', why: 'Vercel’s own cron header — accepted as an alternative' },
  ] },
  { group: 'Stripe · membership', vars: [
    { name: 'STRIPE_SECRET_KEY', why: 'Turns real checkout on' },
    { name: 'STRIPE_PRICE_MEMBERSHIP_MONTHLY', why: 'The £30/month price to sell' },
    { name: 'STRIPE_WEBHOOK_SECRET', why: 'Verifies events Stripe sends back' },
  ] },
  { group: 'Resend · email', vars: [
    { name: 'RESEND_API_KEY', why: 'Sends mail' },
    { name: 'EMAIL_FROM', why: 'The From address, on a verified domain' },
  ] },
  { group: 'Anthropic · AI', vars: [
    { name: 'ANTHROPIC_API_KEY', why: 'Extraction, discovery, article coach, Ask writer' },
    { name: 'EXTRACTION_AI_MODEL', why: 'Model override for event extraction' },
    { name: 'SUPPLY_AI_MODEL', why: 'Model override for the supply engine' },
    { name: 'DISCOVERY_AI_MODEL', why: 'Model override for source discovery' },
    { name: 'ARTICLE_AI_MODEL', why: 'Model override for Balance editorial' },
    { name: 'INTERVIEW_AI_MODEL', why: 'Model override for interviews' },
  ] },
  { group: 'Images · storage', vars: [
    { name: 'UNSPLASH_ACCESS_KEY', why: 'Balance image search' },
    { name: 'PEXELS_API_KEY', why: 'Balance image search' },
    { name: 'SUPABASE_URL', why: 'Supabase Storage for article and archive images' },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', why: 'Server-only key for Storage uploads' },
  ] },
  { group: 'YouTube · video archive', vars: [
    { name: 'YOUTUBE_API_KEY', why: 'Reads the public channel' },
    { name: 'YOUTUBE_OAUTH_CLIENT_ID', why: 'Owner login for captions' },
    { name: 'YOUTUBE_OAUTH_CLIENT_SECRET', why: 'Owner login for captions' },
    { name: 'YOUTUBE_OAUTH_REDIRECT_URI', why: 'Must match the Google console exactly' },
    { name: 'YOUTUBE_OAUTH_ENCRYPTION_KEY', why: 'Encrypts the stored refresh token' },
  ] },
  { group: 'X · @guestlist', vars: [
    { name: 'X_CLIENT_ID', why: 'X app login' },
    { name: 'X_CLIENT_SECRET', why: 'X app login' },
    { name: 'X_REDIRECT_URI', why: 'Must match the X developer portal' },
    { name: 'X_TOKEN_SECRET', why: 'Encrypts stored X tokens (falls back to SESSION_SECRET)' },
  ] },
  { group: 'Supply engine', vars: [
    { name: 'SUPPLY_RENDER_TOKEN', why: 'Hosted browser for sites that render in JavaScript' },
    { name: 'SUPPLY_RENDER_ENDPOINT', why: 'Browserless endpoint (has a default)' },
    { name: 'SUPPLY_FETCH_ALLOW_HOSTS', why: 'DEV/TEST ONLY — never in production', devOnly: true },
  ] },
];

// ---------------------------------------------------------------------------

async function coreGroup(): Promise<Group> {
  const checks: Check[] = [];
  try {
    const row = await queryOne<{ v: string }>(`select version() as v`);
    checks.push({ name: 'Database', verdict: 'ok', detail: (row?.v ?? 'Connected').split(' on ')[0].slice(0, 60) });
  } catch (err) {
    checks.push(failed('Database', err, 'Check DATABASE_URL and that Supabase is up.'));
  }
  try {
    const a = await auditSchema();
    checks.push(a.ok
      ? { name: 'Schema', verdict: 'ok', detail: `Up to date — ${a.checkedTables} tables checked` }
      : { name: 'Schema', verdict: 'bad', detail: `Behind — ${a.missingTables.length} tables and ${a.missingColumns.length} columns missing`, hint: 'Open Database for the list and run the migration SQL.' });
  } catch (err) {
    checks.push(failed('Schema', err));
  }
  const secret = env('SESSION_SECRET');
  checks.push(!secret ? { name: 'Session secret', verdict: 'bad', detail: 'SESSION_SECRET is not set — nobody can stay logged in' }
    : secret === 'change-me' || secret.length < 16 ? { name: 'Session secret', verdict: 'bad', detail: 'SESSION_SECRET is the placeholder or too short', hint: 'Set a long random value. Changing it logs everyone out once.' }
    : { name: 'Session secret', verdict: 'ok', detail: 'Set' });
  checks.push(isSet('SITE_URL')
    ? { name: 'Site URL', verdict: /^https:\/\//.test(env('SITE_URL')) ? 'ok' : 'warn', detail: env('SITE_URL') }
    : { name: 'Site URL', verdict: 'warn', detail: 'SITE_URL not set — links default to https://www.guestlist.net' });
  checks.push(isSet('SUPPLY_CRON_SECRET') || isSet('CRON_SECRET')
    ? { name: 'Scheduled jobs', verdict: 'ok', detail: `Cron secret set${isSet('CRON_SECRET') && !isSet('SUPPLY_CRON_SECRET') ? ' (CRON_SECRET)' : ''}` }
    : { name: 'Scheduled jobs', verdict: 'bad', detail: 'No SUPPLY_CRON_SECRET — emails, source scans and cleanup jobs are refused' });
  if (isSet('SUPPLY_FETCH_ALLOW_HOSTS')) {
    const prod = process.env.NODE_ENV === 'production';
    checks.push({ name: 'Fetch allow-list', verdict: prod ? 'bad' : 'warn', detail: `SUPPLY_FETCH_ALLOW_HOSTS is set${prod ? ' in production — it disables SSRF protection for those hosts' : ' (dev/test only)'}`, hint: prod ? 'Remove it from the production environment.' : undefined });
  }
  checks.push({ name: 'Hosting', verdict: 'ok', detail: `${process.env.VERCEL ? 'Vercel' : 'Not Vercel'} · ${process.env.NODE_ENV ?? 'unknown'}` });
  return { key: 'core', name: 'Core', blurb: 'Database, sessions, links and the cron that runs everything else.', checks };
}

async function stripeGroup(): Promise<Group> {
  const checks: Check[] = [];
  const key = env('STRIPE_SECRET_KEY');
  if (!key) {
    checks.push({ name: 'Secret key', verdict: 'off', detail: 'Not set — /membership shows COMING SOON and collects the waitlist' });
    return { key: 'stripe', name: 'Stripe · membership billing', blurb: 'Real checkout is off until STRIPE_SECRET_KEY is set.', checks };
  }
  const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const test = key.startsWith('sk_test_') || key.startsWith('rk_test_');
  checks.push(live ? { name: 'Secret key', verdict: 'ok', detail: 'Live key' }
    : test ? { name: 'Secret key', verdict: 'warn', detail: 'TEST key — real cards will be declined', hint: 'Swap for the sk_live_ key when you are ready to charge.' }
    : { name: 'Secret key', verdict: 'warn', detail: 'Set, but not in a format Stripe usually issues' });

  const priceId = env('STRIPE_PRICE_MEMBERSHIP_MONTHLY');
  const plan = await getPlan().catch(() => null);
  if (!priceId) {
    checks.push({ name: 'Membership price', verdict: 'bad', detail: 'STRIPE_PRICE_MEMBERSHIP_MONTHLY not set — JOIN cannot open a checkout' });
  } else {
    try {
      const p = await stripeRequest<{ id: string; active: boolean; unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null; livemode: boolean }>('GET', `/prices/${encodeURIComponent(priceId)}`);
      const shown = p.unit_amount != null ? `${formatPence(p.unit_amount, p.currency.toUpperCase())} / ${p.recurring?.interval ?? 'one-off'}` : 'no amount';
      const matches = !!plan && p.unit_amount === plan.price_pence && p.currency.toUpperCase() === plan.currency.toUpperCase() && p.recurring?.interval === plan.interval;
      checks.push(!p.active ? { name: 'Membership price', verdict: 'bad', detail: `${shown} — but the price is archived in Stripe`, hint: 'Create an active price and update the variable.' }
        : !p.recurring ? { name: 'Membership price', verdict: 'bad', detail: `${shown} — not a recurring price` }
        : !matches && plan ? { name: 'Membership price', verdict: 'warn', detail: `${shown} in Stripe, but the plan here is ${formatPence(plan.price_pence, plan.currency)} / ${plan.interval}`, hint: 'Members would be charged the Stripe amount. Align one with the other.' }
        : { name: 'Membership price', verdict: 'ok', detail: `${shown}, active${p.livemode ? '' : ' (test mode)'}` });
    } catch (err) {
      checks.push(err instanceof StripeError && err.status === 401 ? { name: 'Membership price', verdict: 'bad', detail: 'Stripe rejected the secret key (401)', hint: 'Copy the key again from Stripe → Developers → API keys.' }
        : err instanceof StripeError && err.status === 404 ? { name: 'Membership price', verdict: 'bad', detail: 'No price with that id — is it from the other (test/live) mode?' }
        : failed('Membership price', err));
    }
  }
  checks.push(isSet('STRIPE_WEBHOOK_SECRET')
    ? { name: 'Webhook secret', verdict: 'ok', detail: 'Set' }
    : { name: 'Webhook secret', verdict: 'bad', detail: 'STRIPE_WEBHOOK_SECRET not set — events are rejected, so paid members never activate', hint: 'Stripe → Developers → Webhooks → your endpoint → Signing secret.' });
  try {
    const last = await queryOne<{ event_type: string; processed_at: string }>(`select event_type, processed_at from membership_billing_events order by processed_at desc limit 1`);
    checks.push(last ? { name: 'Webhook traffic', verdict: 'ok', detail: `Last event ${ago(last.processed_at)} (${last.event_type})` }
      : { name: 'Webhook traffic', verdict: 'warn', detail: 'No events received yet', hint: 'Normal before the first checkout. After one, an event should show here within a minute; if not, check the endpoint URL is https://…/api/webhooks/stripe.' });
  } catch (err) { checks.push(failed('Webhook traffic', err)); }
  return { key: 'stripe', name: 'Stripe · membership billing', blurb: 'JOIN opens a Stripe Checkout; the webhook brings the answer back.', checks };
}

async function emailGroup(): Promise<Group> {
  const checks: Check[] = [];
  const key = env('RESEND_API_KEY');
  const from = env('EMAIL_FROM');
  if (!key && !from) {
    checks.push({ name: 'Resend', verdict: 'off', detail: 'RESEND_API_KEY and EMAIL_FROM not set — mail is logged, never sent' });
  } else if (!key || !from) {
    checks.push({ name: 'Resend', verdict: 'bad', detail: `${!key ? 'RESEND_API_KEY' : 'EMAIL_FROM'} missing — both are needed before anything sends` });
  } else {
    const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
    const domain = addr.split('@')[1]?.toLowerCase() ?? '';
    checks.push(domain ? { name: 'From address', verdict: 'ok', detail: from } : { name: 'From address', verdict: 'bad', detail: 'EMAIL_FROM is not an email address' });
    try {
      const r = await ping('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401 || r.status === 403) checks.push({ name: 'Resend key', verdict: 'bad', detail: `Resend rejected the key (${r.status})` });
      else if (r.status !== 200) checks.push({ name: 'Resend key', verdict: 'warn', detail: `Resend answered ${r.status}` });
      else {
        const list = (JSON.parse(r.body) as { data?: { name: string; status: string }[] }).data ?? [];
        const d = list.find((x) => x.name.toLowerCase() === domain || domain.endsWith(`.${x.name.toLowerCase()}`));
        checks.push(!d ? { name: 'Resend key', verdict: 'warn', detail: `Key works, but ${domain} is not one of the ${list.length} domains on this Resend account`, hint: 'Add and verify the domain in Resend, or send from one that is verified.' }
          : d.status === 'verified' ? { name: 'Resend key', verdict: 'ok', detail: `Key works · ${d.name} verified` }
          : { name: 'Resend key', verdict: 'bad', detail: `Key works, but ${d.name} is "${d.status}" — Resend will refuse to send from it`, hint: 'Finish the DNS records in Resend → Domains.' });
      }
    } catch (err) { checks.push(failed('Resend key', err)); }
  }
  try {
    const q = await queryOne<{ pending: number; oldest_pending: string | null; failed_24h: number; sent_24h: number; last_sent: string | null }>(
      `select count(*) filter (where status = 'pending')::int as pending,
              min(created_at) filter (where status = 'pending') as oldest_pending,
              count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')::int as failed_24h,
              count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent_24h,
              max(sent_at) as last_sent
         from email_outbox`);
    const stuck = q?.oldest_pending && Date.now() - new Date(q.oldest_pending).getTime() > 2 * 3600 * 1000;
    checks.push(stuck ? { name: 'Outbox', verdict: 'warn', detail: `${q!.pending} waiting, oldest ${ago(q!.oldest_pending)} — the send-emails job may not be running`, hint: 'Check the cron schedule and SUPPLY_CRON_SECRET.' }
      : { name: 'Outbox', verdict: (q?.failed_24h ?? 0) > 0 ? 'warn' : 'ok', detail: `${q?.pending ?? 0} waiting · ${q?.sent_24h ?? 0} sent and ${q?.failed_24h ?? 0} failed in 24h · last sent ${ago(q?.last_sent)}` });
  } catch (err) { checks.push(failed('Outbox', err)); }
  return { key: 'email', name: 'Resend · email', blurb: 'Digests, alerts, membership receipts and every transactional message.', checks };
}

async function aiGroup(): Promise<Group> {
  const checks: Check[] = [];
  const key = env('ANTHROPIC_API_KEY');
  if (!key) {
    checks.push({ name: 'Anthropic key', verdict: 'off', detail: 'Not set — extraction runs on structured data only; the article coach uses its fallback' });
    return { key: 'ai', name: 'Anthropic · AI', blurb: 'Event extraction, source discovery, Balance coach, Ask writer.', checks };
  }
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  try {
    const r = await ping('https://api.anthropic.com/v1/models?limit=1', { headers });
    checks.push(r.status === 200 ? { name: 'Anthropic key', verdict: 'ok', detail: 'Key accepted' }
      : r.status === 401 ? { name: 'Anthropic key', verdict: 'bad', detail: 'Anthropic rejected the key (401)' }
      : { name: 'Anthropic key', verdict: 'warn', detail: `Anthropic answered ${r.status}` });
  } catch (err) { checks.push(failed('Anthropic key', err)); }
  const overrides = ['EXTRACTION_AI_MODEL', 'SUPPLY_AI_MODEL', 'DISCOVERY_AI_MODEL', 'ARTICLE_AI_MODEL', 'INTERVIEW_AI_MODEL'].filter(isSet);
  for (const v of overrides) {
    const model = env(v);
    try {
      const r = await ping(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, { headers });
      checks.push(r.status === 200 ? { name: v, verdict: 'ok', detail: model }
        : r.status === 404 ? { name: v, verdict: 'bad', detail: `${model} — Anthropic does not know this model id`, hint: 'Check the id for typos or a retired model.' }
        : { name: v, verdict: 'warn', detail: `${model} — answered ${r.status}` });
    } catch (err) { checks.push(failed(v, err)); }
  }
  if (overrides.length === 0) checks.push({ name: 'Models', verdict: 'ok', detail: 'No overrides — code defaults in use' });
  return { key: 'ai', name: 'Anthropic · AI', blurb: 'Event extraction, source discovery, Balance coach, Ask writer.', checks };
}

async function imagesGroup(): Promise<Group> {
  const checks: Check[] = [];
  if (!isSet('UNSPLASH_ACCESS_KEY')) checks.push({ name: 'Unsplash', verdict: 'off', detail: 'Not set — Balance image search skips Unsplash' });
  else {
    try {
      const r = await ping(`https://api.unsplash.com/search/photos?query=music&per_page=1&client_id=${encodeURIComponent(env('UNSPLASH_ACCESS_KEY'))}`);
      checks.push(r.status === 200 ? { name: 'Unsplash', verdict: 'ok', detail: 'Key works' } : { name: 'Unsplash', verdict: 'bad', detail: `Unsplash answered ${r.status}` });
    } catch (err) { checks.push(failed('Unsplash', err)); }
  }
  if (!isSet('PEXELS_API_KEY')) checks.push({ name: 'Pexels', verdict: 'off', detail: 'Not set — Balance image search skips Pexels' });
  else {
    try {
      const r = await ping('https://api.pexels.com/v1/curated?per_page=1', { headers: { Authorization: env('PEXELS_API_KEY') } });
      checks.push(r.status === 200 ? { name: 'Pexels', verdict: 'ok', detail: 'Key works' } : { name: 'Pexels', verdict: 'bad', detail: `Pexels answered ${r.status}` });
    } catch (err) { checks.push(failed('Pexels', err)); }
  }
  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  const svc = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url && !svc) checks.push({ name: 'Supabase Storage', verdict: 'off', detail: 'Not set — Pexels picks and archive uploads cannot be stored' });
  else if (!url || !svc) checks.push({ name: 'Supabase Storage', verdict: 'bad', detail: `${!url ? 'SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY'} missing` });
  else {
    try {
      const r = await ping(`${url}/storage/v1/bucket`, { headers: { Authorization: `Bearer ${svc}`, apikey: svc } });
      if (r.status !== 200) checks.push({ name: 'Supabase Storage', verdict: 'bad', detail: `Storage answered ${r.status} — check the service-role key` });
      else {
        const names = (JSON.parse(r.body) as { name: string }[]).map((b) => b.name);
        const missing = ['balance-article-images', 'archive'].filter((b) => !names.includes(b));
        checks.push(missing.length === 0 ? { name: 'Supabase Storage', verdict: 'ok', detail: 'Key works · buckets balance-article-images and archive present' }
          : { name: 'Supabase Storage', verdict: 'warn', detail: `Key works · bucket${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not created yet`, hint: 'The archive bucket is created on first upload; balance-article-images must be public and created by hand.' });
      }
    } catch (err) { checks.push(failed('Supabase Storage', err)); }
  }
  return { key: 'images', name: 'Images · storage', blurb: 'Balance image search and where chosen pictures are kept.', checks };
}

async function youtubeGroup(): Promise<Group> {
  const checks: Check[] = [];
  if (!isSet('YOUTUBE_API_KEY')) checks.push({ name: 'Data API key', verdict: 'off', detail: 'Not set — the video archive cannot sync the channel' });
  else {
    try {
      const r = await ping(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(env('YOUTUBE_API_KEY'))}`);
      checks.push(r.status === 200 ? { name: 'Data API key', verdict: 'ok', detail: 'Key works' }
        : r.status === 403 ? { name: 'Data API key', verdict: 'bad', detail: 'Google refused (403) — YouTube Data API v3 not enabled for this key, or quota exhausted' }
        : { name: 'Data API key', verdict: 'bad', detail: `Google answered ${r.status}` });
    } catch (err) { checks.push(failed('Data API key', err)); }
  }
  const oauthVars = ['YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'YOUTUBE_OAUTH_REDIRECT_URI', 'YOUTUBE_OAUTH_ENCRYPTION_KEY'];
  const missing = oauthVars.filter((v) => !isSet(v));
  const oauthOn = missing.length === 0;
  checks.push(missing.length === oauthVars.length ? { name: 'Owner login (OAuth)', verdict: 'off', detail: 'Not set — captions cannot be read' }
    : missing.length ? { name: 'Owner login (OAuth)', verdict: 'bad', detail: `Missing ${missing.join(', ')}` }
    : { name: 'Owner login (OAuth)', verdict: 'ok', detail: `Set · redirect ${env('YOUTUBE_OAUTH_REDIRECT_URI')}` });
  try {
    const c = await queryOne<{ channel_title: string | null; updated_at: string }>(`select channel_title, updated_at from youtube_oauth_connections where provider = 'youtube'`);
    checks.push(c ? { name: 'Connected channel', verdict: 'ok', detail: `${c.channel_title ?? 'Connected'} · ${ago(c.updated_at)}` }
      : { name: 'Connected channel', verdict: oauthOn ? 'warn' : 'off', detail: 'Not connected', hint: oauthOn ? 'Connect from Video archive → YouTube.' : undefined });
  } catch (err) { checks.push(failed('Connected channel', err)); }
  try {
    const s = await queryOne<{ status: string; last_synced_at: string | null; video_count: number; last_error: string | null }>(`select status, last_synced_at, video_count, last_error from youtube_channel_imports order by updated_at desc limit 1`);
    checks.push(!s ? { name: 'Channel sync', verdict: 'off', detail: 'Never run' }
      : s.status === 'failed' ? { name: 'Channel sync', verdict: 'bad', detail: `Failed: ${(s.last_error ?? '').slice(0, 120)}` }
      : { name: 'Channel sync', verdict: 'ok', detail: `${s.status} · ${s.video_count} videos · last ${ago(s.last_synced_at)}` });
  } catch (err) { checks.push(failed('Channel sync', err)); }
  return { key: 'youtube', name: 'YouTube · video archive', blurb: 'Public channel sync and the owner login that reads captions.', checks };
}

async function xGroup(): Promise<Group> {
  const checks: Check[] = [];
  const vars = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REDIRECT_URI'];
  const missing = vars.filter((v) => !isSet(v));
  checks.push(missing.length === vars.length ? { name: 'X app', verdict: 'off', detail: 'Not set — @guestlist cannot post or read mentions' }
    : missing.length ? { name: 'X app', verdict: 'bad', detail: `Missing ${missing.join(', ')}` }
    : { name: 'X app', verdict: 'ok', detail: `Set · redirect ${env('X_REDIRECT_URI')}` });
  if (missing.length < vars.length) checks.push(isSet('X_TOKEN_SECRET') ? { name: 'Token encryption', verdict: 'ok', detail: 'X_TOKEN_SECRET set' }
    : { name: 'Token encryption', verdict: 'warn', detail: 'X_TOKEN_SECRET not set — falling back to SESSION_SECRET', hint: 'Fine, but rotating SESSION_SECRET would then also disconnect X.' });
  try {
    const a = await queryOne<{ handle: string | null; status: string; token_expires_at: string | null; last_post_at: string | null; last_api_call_at: string | null }>(
      `select handle, status, token_expires_at, last_post_at, last_api_call_at from social_accounts where platform = 'x' order by updated_at desc limit 1`);
    const expired = a?.token_expires_at && new Date(a.token_expires_at).getTime() < Date.now();
    checks.push(!a ? { name: 'Account', verdict: missing.length ? 'off' : 'warn', detail: 'Not connected', hint: missing.length ? undefined : 'Connect from Comms → @guestlist.' }
      : a.status !== 'connected' ? { name: 'Account', verdict: 'bad', detail: `@${a.handle ?? '?'} is "${a.status}"`, hint: 'Reconnect from Comms → @guestlist.' }
      : expired ? { name: 'Account', verdict: 'warn', detail: `@${a.handle} connected, token expired ${ago(a.token_expires_at)} — will refresh on next call` }
      : { name: 'Account', verdict: 'ok', detail: `@${a.handle} connected · last post ${ago(a.last_post_at)} · last call ${ago(a.last_api_call_at)}` });
  } catch (err) { checks.push(failed('Account', err)); }
  return { key: 'x', name: 'X · @guestlist', blurb: 'The account that posts and answers on X.', checks };
}

async function supplyGroup(): Promise<Group> {
  const checks: Check[] = [];
  checks.push(isSet('SUPPLY_RENDER_TOKEN')
    ? { name: 'Hosted browser', verdict: 'ok', detail: `On · ${env('SUPPLY_RENDER_ENDPOINT') || 'https://production-sfo.browserless.io'}` }
    : { name: 'Hosted browser', verdict: 'off', detail: 'SUPPLY_RENDER_TOKEN not set — sites that render in the browser are read as empty' });
  try {
    const s = await queryOne<{ started_at: string; status: string; n24: number; failed24: number }>(
      `select (select started_at from source_scans order by started_at desc limit 1) as started_at,
              (select status from source_scans order by started_at desc limit 1) as status,
              count(*) filter (where started_at > now() - interval '24 hours')::int as n24,
              count(*) filter (where started_at > now() - interval '24 hours' and status = 'failed')::int as failed24
         from source_scans`);
    const stale = s?.started_at && Date.now() - new Date(s.started_at).getTime() > 3 * 86400 * 1000;
    checks.push(!s?.started_at ? { name: 'Source scans', verdict: 'warn', detail: 'No scans recorded yet' }
      : stale ? { name: 'Source scans', verdict: 'warn', detail: `Last scan ${ago(s.started_at)} — is the scan-sources cron firing?` }
      : { name: 'Source scans', verdict: s.failed24 > 0 && s.failed24 >= s.n24 / 2 ? 'warn' : 'ok', detail: `Last ${ago(s.started_at)} (${s.status}) · ${s.n24} in 24h, ${s.failed24} failed` });
  } catch (err) { checks.push(failed('Source scans', err)); }
  return { key: 'supply', name: 'Supply engine', blurb: 'Where events come from when nobody types them in.', checks };
}

export async function runSystemsCheck(): Promise<SystemsReport> {
  const groups = await Promise.all([coreGroup(), stripeGroup(), emailGroup(), aiGroup(), imagesGroup(), youtubeGroup(), xGroup(), supplyGroup()]);
  const all = groups.flatMap((g) => g.checks);
  return {
    groups,
    bad: all.filter((c) => c.verdict === 'bad').length,
    warn: all.filter((c) => c.verdict === 'warn').length,
    ranAt: new Date().toISOString(),
  };
}

export function envStatus(): { group: string; vars: { name: string; why: string; state: 'set' | 'missing' | 'unset' | 'danger' }[] }[] {
  const prod = process.env.NODE_ENV === 'production';
  return ENV_INVENTORY.map((g) => ({
    group: g.group,
    vars: g.vars.map((v) => ({
      name: v.name, why: v.why,
      state: isSet(v.name) ? (v.devOnly && prod ? 'danger' : 'set') : v.required ? 'missing' : 'unset',
    })),
  }));
}
