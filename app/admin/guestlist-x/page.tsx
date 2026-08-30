// ADMIN → @GUESTLIST — the editorial intelligence desk. Opportunities with
// evidence, drafts awaiting judgement, the schedule, what posted, what was
// rejected (and why), the X inbox, and settings: connection, budget, kill
// switches. An editorial desk, not a developer console.

import Link from 'next/link';
import { query } from '@/lib/db';
import { budgetStatus, xSwitches } from '@/lib/channels/x/budget';
import { xAccount, xMockEnabled } from '@/lib/channels/x/client';
import { attributionForDraft } from '@/lib/intelligence/core';
import {
  BudgetPanel, DeskActions, DraftCard, MentionActions, RunDiscovery,
  SettingsSwitches, XConnectPanel,
} from '@/components/admin/GuestlistXDesk';

export const dynamic = 'force-dynamic';

const TABS = [
  ['opportunities', 'Opportunities'],
  ['drafts', 'Drafts'],
  ['scheduled', 'Scheduled'],
  ['posted', 'Posted'],
  ['rejected', 'Rejected'],
  ['inbox', 'X Inbox'],
  ['settings', 'Settings'],
] as const;

export default async function GuestlistXPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : 'opportunities';
  const budget = await budgetStatus();

  return (
    <main>
      <h1 className="adminTitle">@guestlist</h1>
      <p className="adminSub">
        {`The living voice of Guestlist. X budget: $${budget.spent_usd.toFixed(2)} spent · $${budget.reserved_usd.toFixed(2)} reserved · $${budget.available_usd.toFixed(2)} available of $${budget.budget_usd.toFixed(0)}`}
        {budget.exhausted ? ' · ⛔ BUDGET PAUSED' : budget.conservation ? ' · ⚠ conservation mode' : ''}
      </p>
      <div className="statePills" style={{ marginBottom: 18 }}>
        {TABS.map(([t, label]) => (
          <Link key={t} href={`/admin/guestlist-x?tab=${t}`}
                className={`statePill${tab === t ? ' active' : ''}`}>
            {label}
          </Link>
        ))}
      </div>

      {tab === 'opportunities' && <OpportunitiesTab />}
      {tab === 'drafts' && <DraftsTab statuses={['drafted', 'edited', 'approved', 'needs_review']} empty="Nothing waiting on your judgement." />}
      {tab === 'scheduled' && <DraftsTab statuses={['scheduled', 'budget_paused', 'posting']} empty="Nothing scheduled." />}
      {tab === 'posted' && <PostedTab />}
      {tab === 'rejected' && <RejectedTab />}
      {tab === 'inbox' && <InboxTab />}
      {tab === 'settings' && <SettingsTab />}
    </main>
  );
}

async function OpportunitiesTab() {
  const opportunities = await query<{
    id: string; type: string; headline: string; reason: string; suggested_angle: string | null;
    score: number; confidence: string; city: string | null; status: string; detected_at: string;
    evidence: { events?: { title: string; date_label: string; venue: string | null; metrics?: { going: number } }[];
                archive?: { title: string; display_date: string }[] };
  }>(
    `select id, type, headline, reason, suggested_angle, score::float8 as score,
            confidence, city, status, detected_at::text, evidence
       from intelligence_opportunities
      where status in ('open', 'drafted') and expires_at > now()
      order by score desc, detected_at desc limit 25`
  );
  return (
    <>
      <RunDiscovery />
      {opportunities.length === 0 && (
        <p className="adminSub" style={{ marginTop: 14 }}>
          No strong opportunities right now — and that’s fine. @guestlist is
          allowed to say nothing.
        </p>
      )}
      {opportunities.map((o) => (
        <div className="adminRow" key={o.id} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{o.headline}</strong>
            <span className="statePill">{o.type.replace(/_/g, ' ')}</span>
            <span className={`statePill${o.confidence === 'high' ? ' active' : ''}`}>
              {o.confidence.toUpperCase()}
            </span>
            {o.status === 'drafted' && <span className="statePill">drafted</span>}
          </div>
          <div className="youHistoryMeta">{`WHY WE NOTICED — ${o.reason}`}</div>
          {(o.evidence.events ?? []).slice(0, 3).map((e, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {`· ${e.title} — ${e.date_label}${e.venue ? ` · ${e.venue}` : ''}${e.metrics ? ` · ${e.metrics.going} going` : ''}`}
            </div>
          ))}
          {(o.evidence.archive ?? []).slice(0, 2).map((a, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {`· ${a.title} — ${a.display_date} (Archive)`}
            </div>
          ))}
          {o.suggested_angle && (
            <div style={{ fontSize: 13 }}>{`SUGGESTED ANGLE — “${o.suggested_angle}”`}</div>
          )}
          <DeskActions opportunityId={o.id} drafted={o.status === 'drafted'} />
        </div>
      ))}
    </>
  );
}

async function loadDrafts(statuses: string[]) {
  return query<{
    id: string; channel: string; kind: string; body: string; status: string;
    link_url: string | null; estimated_cost_usd: number; scheduled_for: string | null;
    schedule_timezone: string | null; needs_review_reason: string | null; error: string | null;
    created_at: string; headline: string | null; media: unknown[];
  }>(
    `select d.id, d.channel, d.kind, d.body, d.status, d.link_url,
            d.estimated_cost_usd::float8 as estimated_cost_usd,
            d.scheduled_for::text, d.schedule_timezone, d.needs_review_reason, d.error,
            d.created_at::text, o.headline, d.media
       from channel_drafts d
       left join intelligence_opportunities o on o.id = d.opportunity_id
      where d.status = any($1)
      order by d.created_at desc limit 30`,
    [statuses]
  );
}

async function DraftsTab({ statuses, empty }: { statuses: string[]; empty: string }) {
  const drafts = await loadDrafts(statuses);
  return (
    <>
      {drafts.length === 0 && <p className="adminSub">{empty}</p>}
      {drafts.map((d) => <DraftCard key={d.id} draft={d} />)}
    </>
  );
}

async function PostedTab() {
  const drafts = await query<{
    id: string; body: string; posted_at: string; external_id: string | null;
    post_url: string | null; channel: string; kind: string; headline: string | null;
  }>(
    `select d.id, d.body, d.posted_at::text, d.external_id, d.post_url, d.channel, d.kind, o.headline
       from channel_drafts d
       left join intelligence_opportunities o on o.id = d.opportunity_id
      where d.status = 'posted' order by d.posted_at desc limit 25`
  );
  const attribution = new Map<string, { views: number; ticket_clicks: number }>();
  for (const d of drafts) attribution.set(d.id, await attributionForDraft(d.id));
  return (
    <>
      {drafts.length === 0 && <p className="adminSub">Nothing posted yet.</p>}
      {drafts.map((d) => {
        const a = attribution.get(d.id);
        return (
          <div className="adminRow" key={d.id} style={{ display: 'grid', gap: 4 }}>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{d.body}</div>
            <div className="youHistoryMeta">
              {`${d.channel === 'x' ? (d.kind === 'reply' ? 'X reply' : 'X post') : 'Website'} · ${new Date(d.posted_at).toLocaleString('en-GB')}`}
              {d.post_url && d.channel === 'x' && ` · ${d.post_url}`}
              {a && ` · GUESTLIST IMPACT: ${a.views} event views, ${a.ticket_clicks} ticket clicks from this post`}
            </div>
          </div>
        );
      })}
    </>
  );
}

async function RejectedTab() {
  const drafts = await query<{
    id: string; body: string; rejection_reason: string | null; rejection_note: string | null;
    created_at: string; headline: string | null;
  }>(
    `select d.id, d.body, d.rejection_reason, d.rejection_note, d.created_at::text, o.headline
       from channel_drafts d
       left join intelligence_opportunities o on o.id = d.opportunity_id
      where d.status = 'rejected' order by d.updated_at desc limit 25`
  );
  return (
    <>
      {drafts.length === 0 && <p className="adminSub">Nothing rejected yet.</p>}
      {drafts.map((d) => (
        <div className="adminRow" key={d.id} style={{ display: 'grid', gap: 4 }}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-muted)' }}>{d.body}</div>
          <div className="youHistoryMeta">
            {`Rejected: ${(d.rejection_reason ?? 'other').replace(/_/g, ' ')}`}
            {d.rejection_note && ` · “${d.rejection_note}”`}
          </div>
        </div>
      ))}
    </>
  );
}

async function InboxTab() {
  const mentions = await query<{
    id: string; author_handle: string | null; text: string; classification: string | null;
    intent: Record<string, string | null>; status: string; ingested_at: string;
    matched_event_ids: string[]; draft_id: string | null;
  }>(
    `select id, author_handle, text, classification, intent, status,
            ingested_at::text, matched_event_ids, draft_id
       from x_mentions
      where status in ('new', 'classified', 'drafted')
      order by ingested_at desc limit 30`
  );
  return (
    <>
      <MentionActions sync />
      {mentions.length === 0 && <p className="adminSub" style={{ marginTop: 12 }}>Inbox clear.</p>}
      {mentions.map((m) => (
        <div className="adminRow" key={m.id} style={{ display: 'grid', gap: 4 }}>
          <div>
            <strong>{m.author_handle ? `@${m.author_handle}` : 'someone'}</strong>{' '}
            <span style={{ fontSize: 14 }}>{m.text}</span>
          </div>
          <div className="youHistoryMeta">
            {`${(m.classification ?? 'UNCLASSIFIED').replace(/_/g, ' ')}`}
            {m.intent?.city && ` · city: ${m.intent.city}`}
            {m.intent?.genre && ` · genre: ${m.intent.genre}`}
            {m.intent?.date && ` · when: ${m.intent.date}`}
            {m.matched_event_ids.length > 0 && ` · ${m.matched_event_ids.length} matching events`}
            {m.status === 'drafted' && ' · reply drafted — see Drafts'}
          </div>
          <MentionActions mentionId={m.id}
                          canDraft={m.classification === 'EVENT_QUESTION' && m.status !== 'drafted'} />
        </div>
      ))}
    </>
  );
}

async function SettingsTab() {
  const [account, budget, switches, mock, ledger] = await Promise.all([
    xAccount(), budgetStatus(), xSwitches(), xMockEnabled(),
    query<{ operation: string; n: number; cost: number }>(
      `select operation, count(*)::int as n,
              sum(coalesce(confirmed_cost_usd, estimated_cost_usd))::float8 as cost
         from x_usage_ledger
        where created_at > now() - interval '30 days'
        group by operation order by cost desc limit 10`
    ),
  ]);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <XConnectPanel account={account ? {
        handle: account.handle, status: account.status,
        connected_at: account.connected_at, last_api_call_at: account.last_api_call_at,
        last_post_at: account.last_post_at, last_mention_sync_at: account.last_mention_sync_at,
        last_error: account.last_error,
      } : null} mock={mock} />
      <BudgetPanel status={budget} ledger={ledger} />
      <SettingsSwitches switches={switches} />
      <div className="adminRow" style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <strong>Layer 2 — X’s own spending limit.</strong> Guestlist’s budget
        above is an internal guardrail, not the billing authority. In the X
        Developer Console (developer.x.com → your project → Billing), buy
        prepaid credits and set a per-cycle spending limit at or just above
        your Guestlist budget. X’s pay-per-use billing follows that credit
        cycle — align the billing period here with it in the budget panel.
      </div>
    </div>
  );
}
