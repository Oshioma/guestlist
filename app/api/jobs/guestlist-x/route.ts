// @guestlist automation cron — run HOURLY (or on demand from the desk).
//
//   1. Deterministic opportunity discovery (no X cost at all)
//   2. Expiry sweep
//   3. Scheduled/budget-paused approved drafts → publish (HIGH priority)
//   4. Mention ingestion (MEDIUM — skipped in conservation only when LOW,
//      fully skipped when budget exhausted or kill-switched)
//
// Every X-touching stage runs behind kill switches, the budget gate,
// per-job cost guards and the circuit breaker. Discovery always runs —
// intelligence is free; only the channel costs money.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCurrentMember } from '@/lib/auth';
import { expireOpportunities, findOpportunities } from '@/lib/intelligence/candidates';
import { ingestMentions, processScheduledDrafts } from '@/lib/intelligence/core';
import { budgetStatus } from '@/lib/channels/x/budget';

export const maxDuration = 300;

function secretMatches(header: string | null): boolean {
  const secret = process.env.SUPPLY_CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  if (!secretMatches(req.headers.get('authorization'))) {
    const member = await getCurrentMember();
    if (member?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const discovery = await findOpportunities();
  const expired = await expireOpportunities();
  const publishing = await processScheduledDrafts('cron:guestlist-x');
  const mentions = await ingestMentions('cron:x-mentions');
  const budget = await budgetStatus();
  return NextResponse.json({
    ok: true,
    discovery,
    expired,
    publishing,
    mentions,
    budget: {
      spent: budget.spent_usd, reserved: budget.reserved_usd,
      available: budget.available_usd, pct: budget.pct_used,
      conservation: budget.conservation, exhausted: budget.exhausted,
    },
  });
}
