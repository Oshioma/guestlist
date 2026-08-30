// The @GUESTLIST Desk API — every editorial and control action, admin-only,
// audited. AI can never call any of this: posting requires an approval row
// written by a human admin session, and the database trigger double-checks.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdmin } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import { findOpportunities, expireOpportunities } from '@/lib/intelligence/candidates';
import {
  approveDraft, createDraftForOpportunity, draftReplyForMention, editDraft,
  ingestMentions, publishDraft, rejectDraft, scheduleDraft, xAudit,
} from '@/lib/intelligence/core';
import { budgetStatus, setBudget, xSwitches } from '@/lib/channels/x/budget';

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const draftId = typeof body.draftId === 'string' ? body.draftId : '';

    if (action === 'find_opportunities') {
      const found = await findOpportunities();
      const expired = await expireOpportunities();
      return NextResponse.json({ ok: true, ...found, expired });
    }

    if (action === 'dismiss_opportunity') {
      await query(
        `update intelligence_opportunities set status = 'dismissed'
          where id = $1 and status in ('open', 'drafted')`,
        [String(body.opportunityId ?? '')]);
      await xAudit('opportunity_dismissed', { actorId: admin.id, opportunityId: body.opportunityId });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_draft') {
      const result = await createDraftForOpportunity(String(body.opportunityId ?? ''), {
        actorId: admin.id,
        channel: body.channel === 'website' ? 'website' : 'x',
      });
      return result.ok
        ? NextResponse.json(result)
        : NextResponse.json({ error: result.error, problems: result.problems ?? [] }, { status: 400 });
    }

    if (action === 'edit_draft') {
      const result = await editDraft(draftId, String(body.body ?? ''), admin.id);
      return result.ok
        ? NextResponse.json(result)
        : NextResponse.json({ error: result.error, problems: result.problems ?? [] }, { status: 400 });
    }

    if (action === 'approve') {
      const result = await approveDraft(draftId, admin.id);
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (action === 'reject') {
      const result = await rejectDraft(draftId, admin.id, String(body.reason ?? 'other'),
        typeof body.note === 'string' ? body.note : null);
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (action === 'schedule') {
      const result = await scheduleDraft(draftId, admin.id, String(body.when ?? ''), String(body.timezone ?? ''));
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (action === 'post_now') {
      // override=true is the audited POST ONCE ANYWAY escape hatch.
      const result = await publishDraft(draftId, {
        actorId: admin.id, override: body.override === true,
      });
      return result.ok
        ? NextResponse.json(result)
        : NextResponse.json({ error: result.error, state: result.state }, { status: 409 });
    }

    if (action === 'draft_reply') {
      const result = await draftReplyForMention(String(body.mentionId ?? ''), { actorId: admin.id });
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (action === 'ignore_mention') {
      await query(`update x_mentions set status = 'ignored' where id = $1`, [String(body.mentionId ?? '')]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'sync_mentions') {
      return NextResponse.json({ ok: true, ...(await ingestMentions('desk-manual')) });
    }

    if (action === 'set_budget') {
      const budget = Number(body.budgetUsd);
      if (!Number.isFinite(budget) || budget < 0 || budget > 100000) {
        return NextResponse.json({ error: 'Invalid budget' }, { status: 400 });
      }
      await setBudget(budget, admin.id);
      await xAudit('budget_changed', { actorId: admin.id, detail: `$${budget}` });
      return NextResponse.json({ ok: true, status: await budgetStatus() });
    }

    if (action === 'set_switches') {
      const current = await xSwitches();
      const next = { ...current };
      for (const k of ['automation', 'posting', 'mention_sync', 'replies', 'analytics'] as const) {
        if (typeof body[k] === 'boolean') next[k] = body[k];
      }
      await setSetting('x_switches', next, admin.id);
      await xAudit('kill_switch', { actorId: admin.id, detail: JSON.stringify(next) });
      return NextResponse.json({ ok: true, switches: next });
    }

    if (action === 'set_billing_period') {
      const start = String(body.periodStart ?? '');
      const end = String(body.periodEnd ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
        return NextResponse.json({ error: 'Invalid billing period' }, { status: 400 });
      }
      await queryOne(
        `insert into x_billing_periods (period_start, period_end, budget_usd, created_by)
         values ($1, $2, coalesce((select budget_usd from x_billing_periods order by created_at desc limit 1), 50), $3)
         returning id`,
        [start, end, admin.id]);
      await xAudit('billing_period_changed', { actorId: admin.id, detail: `${start} → ${end}` });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
