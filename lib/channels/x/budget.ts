// X BUDGET ENGINE — two-layer protection, layer 1.
//
// Layer 1 (here): Guestlist's own configurable budget per billing period,
// with reservations for scheduled content, centralized warning thresholds,
// conservation mode, priority classes, per-job guards and a circuit
// breaker. Layer 2 is X's own Developer Console spending limit on the
// prepaid credit balance — configured by the admin at
// developer.x.com → Billing (documented in the desk settings). Guestlist's
// internal estimate is a guardrail, never the billing authority.

import { query, queryOne } from '../../db';
import { getSetting, setSetting } from '../../settings';

export type XPriority = 'critical' | 'high' | 'medium' | 'low';

// Centralized thresholds (percent of budget). Overridable via settings.
export const X_BUDGET_THRESHOLDS = {
  warnings: [50, 75, 90, 100] as number[],
  conservation: 80,
};

export type XBudgetStatus = {
  period_start: string;
  period_end: string;
  budget_usd: number;
  spent_usd: number;
  reserved_usd: number;
  available_usd: number;
  pct_used: number;
  warnings: number[];      // thresholds crossed by spend alone
  conservation: boolean;   // >= conservation threshold (spend + reserved)
  exhausted: boolean;      // >= 100% spent
  by_operation: { operation: string; cost: number; n: number }[];
};

// The current billing period row; created on demand. X's pay-per-use
// billing follows the credit/spending-limit cycle, which the admin aligns
// here — default is the calendar month until adjusted.
export async function currentBillingPeriod(): Promise<{
  id: string; period_start: string; period_end: string; budget_usd: number;
}> {
  const existing = await queryOne<{ id: string; period_start: string; period_end: string; budget_usd: number }>(
    `select id, period_start::text, period_end::text, budget_usd::float8 as budget_usd
       from x_billing_periods
      where current_date >= period_start and current_date < period_end
      order by created_at desc limit 1`
  );
  if (existing) return existing;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const defaultBudget = (await getSetting<number>('x_default_budget_usd')) ?? 50;
  const row = await queryOne<{ id: string; period_start: string; period_end: string; budget_usd: number }>(
    `insert into x_billing_periods (period_start, period_end, budget_usd)
     values ($1, $2, $3)
     returning id, period_start::text, period_end::text, budget_usd::float8 as budget_usd`,
    [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), defaultBudget]
  );
  return row!;
}

export async function setBudget(budgetUsd: number, adminId: string): Promise<void> {
  const period = await currentBillingPeriod();
  await query(`update x_billing_periods set budget_usd = $2, created_by = $3 where id = $1`,
    [period.id, budgetUsd, adminId]);
  await setSetting('x_default_budget_usd', budgetUsd, adminId);
}

export async function budgetStatus(): Promise<XBudgetStatus> {
  const period = await currentBillingPeriod();
  const [spend, reserved, ops] = await Promise.all([
    queryOne<{ total: number }>(
      `select coalesce(sum(coalesce(confirmed_cost_usd, estimated_cost_usd)), 0)::float8 as total
         from x_usage_ledger
        where created_at >= $1::date and created_at < $2::date`,
      [period.period_start, period.period_end]
    ),
    // Reservation: approved/scheduled/paused X drafts not yet posted hold
    // their estimated cost so you cannot schedule $100 against a $50 cap.
    queryOne<{ total: number }>(
      `select coalesce(sum(estimated_cost_usd), 0)::float8 as total
         from channel_drafts
        where channel = 'x' and status in ('approved', 'scheduled', 'budget_paused', 'posting')`
    ),
    query<{ operation: string; cost: number; n: number }>(
      `select operation, sum(coalesce(confirmed_cost_usd, estimated_cost_usd))::float8 as cost,
              count(*)::int as n
         from x_usage_ledger
        where created_at >= $1::date and created_at < $2::date
        group by operation order by cost desc`,
      [period.period_start, period.period_end]
    ),
  ]);
  const spent = spend?.total ?? 0;
  const res = reserved?.total ?? 0;
  const pct = period.budget_usd > 0 ? (spent / period.budget_usd) * 100 : 100;
  const committedPct = period.budget_usd > 0 ? ((spent + res) / period.budget_usd) * 100 : 100;
  const conservationAt = (await getSetting<number>('x_conservation_pct')) ?? X_BUDGET_THRESHOLDS.conservation;
  return {
    period_start: period.period_start,
    period_end: period.period_end,
    budget_usd: period.budget_usd,
    spent_usd: Math.round(spent * 1e6) / 1e6,
    reserved_usd: Math.round(res * 1e6) / 1e6,
    available_usd: Math.round((period.budget_usd - spent - res) * 1e6) / 1e6,
    pct_used: Math.round(pct * 10) / 10,
    warnings: X_BUDGET_THRESHOLDS.warnings.filter((w) => pct >= w),
    conservation: committedPct >= conservationAt,
    exhausted: pct >= 100,
    by_operation: ops,
  };
}

// Kill switches — settings-backed, no deployment needed.
export type XSwitches = {
  automation: boolean; posting: boolean; mention_sync: boolean;
  replies: boolean; analytics: boolean;
};

export async function xSwitches(): Promise<XSwitches> {
  const stored = await getSetting<Partial<XSwitches>>('x_switches');
  return {
    automation: stored?.automation !== false,
    posting: stored?.posting !== false,
    mention_sync: stored?.mention_sync !== false,
    replies: stored?.replies !== false,
    analytics: stored?.analytics !== false,
  };
}

// Central spend gate. Every X operation asks here first.
export async function canSpend(
  estimatedUsd: number,
  priority: XPriority,
  opts: { override?: boolean } = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const switches = await xSwitches();
  if (!switches.automation && priority !== 'critical' && !opts.override) {
    return { ok: false, reason: 'X automation is paused' };
  }
  const status = await budgetStatus();
  if (opts.override) return { ok: true }; // explicit, audited admin override
  if (status.exhausted) {
    return priority === 'critical'
      ? { ok: true }
      : { ok: false, reason: 'BUDGET_PAUSED: monthly X budget exhausted' };
  }
  if (status.conservation && priority === 'low') {
    return { ok: false, reason: 'CONSERVATION: low-priority X reads suspended' };
  }
  if (estimatedUsd > 0 && estimatedUsd > status.budget_usd - status.spent_usd) {
    return priority === 'critical'
      ? { ok: true }
      : { ok: false, reason: 'BUDGET_PAUSED: operation would exceed the X budget' };
  }
  return { ok: true };
}

export async function recordUsage(entry: {
  operation: string;
  endpoint?: string | null;
  resources?: number;
  estimatedCostUsd: number;
  confirmedCostUsd?: number | null;
  priority: XPriority;
  httpStatus?: number | null;
  xRequestId?: string | null;
  opportunityId?: string | null;
  draftId?: string | null;
  mentionId?: string | null;
  job?: string | null;
  detail?: string | null;
}): Promise<void> {
  await query(
    `insert into x_usage_ledger
       (operation, endpoint, resources, estimated_cost_usd, confirmed_cost_usd, priority,
        http_status, x_request_id, opportunity_id, draft_id, mention_id, job, detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [entry.operation, entry.endpoint ?? null, entry.resources ?? 1,
     entry.estimatedCostUsd, entry.confirmedCostUsd ?? null, entry.priority,
     entry.httpStatus ?? null, entry.xRequestId ?? null, entry.opportunityId ?? null,
     entry.draftId ?? null, entry.mentionId ?? null, entry.job ?? null, entry.detail ?? null]
  );
}

// ---------------------------------------------------------------------------
// Per-job cost guards + circuit breaker — runaway protection.
// ---------------------------------------------------------------------------

export type JobGuards = { maxRequestsPerRun: number; maxCostPerRunUsd: number };

export async function jobGuards(): Promise<JobGuards> {
  const stored = await getSetting<Partial<JobGuards>>('x_job_guards');
  return {
    maxRequestsPerRun: stored?.maxRequestsPerRun ?? 50,
    maxCostPerRunUsd: stored?.maxCostPerRunUsd ?? 5,
  };
}

export class JobBudget {
  requests = 0;
  costUsd = 0;
  constructor(private guards: JobGuards, public job: string) {}
  // Returns false (and the caller must STOP + flag) once a cap is hit.
  take(estimatedUsd: number): boolean {
    if (this.requests + 1 > this.guards.maxRequestsPerRun) return false;
    if (this.costUsd + estimatedUsd > this.guards.maxCostPerRunUsd) return false;
    this.requests++;
    this.costUsd += estimatedUsd;
    return true;
  }
}

type CircuitState = Record<string, { failures: number; open_until: string | null }>;
const CIRCUIT_OPEN_AFTER = 5;       // consecutive failures
const CIRCUIT_OPEN_MINUTES = 60;

export async function circuitOpen(operation: string): Promise<boolean> {
  const state = (await getSetting<CircuitState>('x_circuit')) ?? {};
  const s = state[operation];
  return !!(s?.open_until && new Date(s.open_until).getTime() > Date.now());
}

export async function recordCircuit(operation: string, success: boolean): Promise<void> {
  const state = (await getSetting<CircuitState>('x_circuit')) ?? {};
  const s = state[operation] ?? { failures: 0, open_until: null };
  if (success) {
    state[operation] = { failures: 0, open_until: null };
  } else {
    s.failures += 1;
    if (s.failures >= CIRCUIT_OPEN_AFTER) {
      s.open_until = new Date(Date.now() + CIRCUIT_OPEN_MINUTES * 60_000).toISOString();
    }
    state[operation] = s;
  }
  await setSetting('x_circuit', state, null);
}
