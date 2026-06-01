/**
 * Membership LTV, survival curve, and cohort analytics.
 *
 * WHY SURVIVAL-BASED LTV
 * ──────────────────────
 * Classical ARPU/churn LTV = ARPU / churn_rate overstates badly here because
 * it ignores the $9.99 intro discount and the heavy month-1 drop-off, producing
 * an inflated figure (~$117). Walking the empirical survival curve captures the
 * actual cash-flow sequence: $9.99 at month 0, then $39.99 per subsequent month,
 * weighted by the real observed retention at each step.
 *
 * SURVIVAL CURVE CONSTRUCTION
 * ────────────────────────────
 * "Blended, weighted by cohort starters."  For each month-index k:
 *   eligible = customers whose cohort started ≥k months before lastCompleteMonth
 *   survival(k) = eligible customers who were billed in their k-th month
 *                 ÷ eligible customers (cohort-size-weighted average)
 * Only complete calendar months are included so partial data cannot bias the curve.
 *
 * LTV TAIL
 * ────────
 * conservative_ltv = empirical curve only.
 * projected_ltv    = conservative + geometric tail using avg of last-2 observed
 *                    conditional retentions; truncated when surviving fraction < 0.5%.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { Json } from '@/lib/types/database';

const INTRO_PRICE     = 9.99;
const RECURRING_PRICE = 39.99;

// ── internal types ────────────────────────────────────────────────────────────

interface BillingEvent {
  customer_id: string;
  charged_at:  string;
  net_amount:  number;
  is_intro:    boolean;
}

interface CustomerProfile {
  customerId:       string;
  firstAbsMonth:    number;       // year*12 + month(0-based) of first charge
  absMonthsCharged: Set<number>;  // all abs months with ≥1 charge
  chargeCount:      number;       // total billing events
  totalRevenue:     number;
}

// ── public types ──────────────────────────────────────────────────────────────

export interface SurvivalPoint {
  month_index:           number;
  survival_pct:          number;
  conditional_retention: number | null;
  eligible_customers:    number;
}

export interface MembershipMetricsResult {
  metric_date:       string;
  active_members:    number;
  new_signups:       number;
  mrr_net:           number;
  avg_monthly_churn: number;
  one_and_done_rate: number;
  conservative_ltv:  number;
  projected_ltv:     number;
  cohort_data: {
    cohort_triangle:              Record<string, Record<number, number>>;
    survival_curve:               SurvivalPoint[];
    billing_cycle_distribution:   { billed_1: number; billed_2: number; billed_3: number; billed_4plus: number };
    realized_revenue_per_starter: Record<string, number>;
    monthly_churn:                Array<{ month: string; churn_rate: number; base: number }>;
    ltv_assumptions:              { intro_price: number; recurring_price: number; tail_retention: number; tail_months: number };
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toAbsMonth(isoStr: string): number {
  const d = new Date(isoStr);
  return d.getUTCFullYear() * 12 + d.getUTCMonth(); // 0-based month
}

function absMonthToStr(absM: number): string {
  const year  = Math.floor(absM / 12);
  const month = (absM % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ── core computation ──────────────────────────────────────────────────────────

export async function computeMembershipMetrics(date: string): Promise<MembershipMetricsResult> {
  // Fetch ALL billing events — full history needed for cohort analysis.
  const { data: events, error: evErr } = await supabaseAdmin
    .from('membership_billing_events')
    .select('customer_id, charged_at, net_amount, is_intro')
    .order('charged_at', { ascending: true });
  if (evErr) throw new Error(`membership_billing_events fetch: ${evErr.message}`);
  if (!events || events.length === 0) throw new Error('No billing events found');

  // Fetch today's snapshot rows for active_members count.
  const { data: snapRows, error: snapErr } = await supabaseAdmin
    .from('membership_status_snapshots')
    .select('is_active')
    .eq('snapshot_date', date);
  if (snapErr) throw new Error(`membership_status_snapshots fetch: ${snapErr.message}`);

  // ── Date context ───────────────────────────────────────────────────────────
  const snapshotDate    = new Date(`${date}T00:00:00Z`);
  const currentAbsMonth = toAbsMonth(`${date}T00:00:00Z`);

  // Include the current calendar month as "complete" only when `date` is the
  // last day of that month (next day rolls into a new month).
  const nextDay      = new Date(snapshotDate.getTime() + 86_400_000);
  const isMonthEnd   = nextDay.getUTCMonth() !== snapshotDate.getUTCMonth();
  const lastComplete = isMonthEnd ? currentAbsMonth : currentAbsMonth - 1;

  // ── Build customer profiles ────────────────────────────────────────────────
  const profiles = new Map<string, CustomerProfile>();

  for (const e of events as BillingEvent[]) {
    const absM = toAbsMonth(e.charged_at);
    let p = profiles.get(e.customer_id);
    if (!p) {
      p = {
        customerId:       e.customer_id,
        firstAbsMonth:    absM,
        absMonthsCharged: new Set([absM]),
        chargeCount:      1,
        totalRevenue:     e.net_amount,
      };
      profiles.set(e.customer_id, p);
    } else {
      if (absM < p.firstAbsMonth) p.firstAbsMonth = absM;
      p.absMonthsCharged.add(absM);
      p.chargeCount++;
      p.totalRevenue += e.net_amount;
    }
  }

  const allCustomers = Array.from(profiles.values());

  // ── 1. Active members ──────────────────────────────────────────────────────
  const activeMembersCount = (snapRows ?? []).filter((r: { is_active: boolean }) => r.is_active).length;

  // ── 2. New signups: first charge in the current calendar month ─────────────
  const newSignups = allCustomers.filter(p => p.firstAbsMonth === currentAbsMonth).length;

  // ── 3. MRR: sum of all membership charges in last complete calendar month ──
  const mrrNet = (events as BillingEvent[])
    .filter(e => toAbsMonth(e.charged_at) === lastComplete)
    .reduce((sum, e) => sum + e.net_amount, 0);

  // ── 4. Cohort retention triangle ───────────────────────────────────────────
  const cohortMap = new Map<number, CustomerProfile[]>();
  for (const p of allCustomers) {
    if (!cohortMap.has(p.firstAbsMonth)) cohortMap.set(p.firstAbsMonth, []);
    cohortMap.get(p.firstAbsMonth)!.push(p);
  }

  const cohortTriangle: Record<string, Record<number, number>> = {};
  const realizedRevenuePerStarter: Record<string, number> = {};

  for (const [cohortAbsM, members] of Array.from(cohortMap)) {
    const key = absMonthToStr(cohortAbsM);
    cohortTriangle[key] = {};

    for (let k = 0; cohortAbsM + k <= lastComplete; k++) {
      const retained = members.filter(m => m.absMonthsCharged.has(cohortAbsM + k)).length;
      cohortTriangle[key][k] = Math.round((retained / members.length) * 10000) / 10000;
    }

    const totalRev = members.reduce((s, m) => s + m.totalRevenue, 0);
    realizedRevenuePerStarter[key] = Math.round((totalRev / members.length) * 100) / 100;
  }

  // ── 5. Blended survival curve (weighted by cohort starters) ───────────────
  const earliestCohort = Math.min(...allCustomers.map(p => p.firstAbsMonth));
  const maxK           = lastComplete - earliestCohort;

  const survivalCurve: SurvivalPoint[] = [];
  let prevSurvPct = 1.0;

  for (let k = 0; k <= maxK; k++) {
    // Eligible = customers whose cohort started early enough for month k to be complete.
    const eligible = allCustomers.filter(p => p.firstAbsMonth + k <= lastComplete);
    if (eligible.length === 0) break;

    const retained   = eligible.filter(p => p.absMonthsCharged.has(p.firstAbsMonth + k)).length;
    const survPct    = retained / eligible.length;
    const condRet    = k === 0 ? null : (prevSurvPct > 0 ? Math.round((survPct / prevSurvPct) * 10000) / 10000 : null);

    survivalCurve.push({
      month_index:           k,
      survival_pct:          Math.round(survPct * 10000) / 10000,
      conditional_retention: condRet,
      eligible_customers:    eligible.length,
    });

    prevSurvPct = survPct;
    if (survPct < 0.005) break;
  }

  // ── 6. Monthly churn (calendar-month) ──────────────────────────────────────
  const allAbsMs    = (events as BillingEvent[]).map(e => toAbsMonth(e.charged_at));
  const minAbsMonth = Math.min(...allAbsMs);

  const monthlyChurn: Array<{ month: string; churn_rate: number; base: number }> = [];

  for (let m = minAbsMonth; m < lastComplete; m++) {
    const billedInM = allCustomers.filter(p => p.absMonthsCharged.has(m));
    if (billedInM.length === 0) continue;
    const retained  = billedInM.filter(p => p.absMonthsCharged.has(m + 1)).length;
    const churnRate = 1 - retained / billedInM.length;
    monthlyChurn.push({
      month:      absMonthToStr(m),
      churn_rate: Math.round(churnRate * 10000) / 10000,
      base:       billedInM.length,
    });
  }

  const avgMonthlyChurn = monthlyChurn.length > 0
    ? monthlyChurn.reduce((s, m) => s + m.churn_rate, 0) / monthlyChurn.length
    : 0;

  // ── 7. One-and-done rate ───────────────────────────────────────────────────
  // Denominator: members whose first-charge month + 1 ≤ lastComplete (had a chance to renew).
  const eligForRenewal  = allCustomers.filter(p => p.firstAbsMonth + 1 <= lastComplete);
  const oneAndDoneCount = eligForRenewal.filter(p => p.absMonthsCharged.size === 1).length;
  const oneAndDoneRate  = eligForRenewal.length > 0 ? oneAndDoneCount / eligForRenewal.length : 0;

  // ── 8. Billing-cycle distribution (unique months billed) ──────────────────
  const billingCycleDist = {
    billed_1:    allCustomers.filter(p => p.absMonthsCharged.size === 1).length,
    billed_2:    allCustomers.filter(p => p.absMonthsCharged.size === 2).length,
    billed_3:    allCustomers.filter(p => p.absMonthsCharged.size === 3).length,
    billed_4plus: allCustomers.filter(p => p.absMonthsCharged.size >= 4).length,
  };

  // ── 9. LTV (survival-based) ────────────────────────────────────────────────
  let conservativeLtv = 0;
  for (const s of survivalCurve) {
    const price = s.month_index === 0 ? INTRO_PRICE : RECURRING_PRICE;
    conservativeLtv += price * s.survival_pct;
  }

  // Projected tail: geometric extrapolation beyond observed window.
  let tailRetention = 0;
  let tailMonths    = 0;
  let projectedLtv  = conservativeLtv;

  const observedCondRetentions = survivalCurve
    .filter(s => s.conditional_retention !== null)
    .map(s => s.conditional_retention!);

  if (observedCondRetentions.length >= 2) {
    const lastTwo = observedCondRetentions.slice(-2);
    tailRetention = (lastTwo[0] + lastTwo[1]) / 2;

    if (tailRetention > 0 && tailRetention < 1) {
      const lastPoint = survivalCurve[survivalCurve.length - 1];
      let remaining   = lastPoint.survival_pct * tailRetention;
      while (remaining >= 0.005 && tailMonths < 120) {
        projectedLtv += RECURRING_PRICE * remaining;
        remaining    *= tailRetention;
        tailMonths++;
      }
    }
  }

  return {
    metric_date:       date,
    active_members:    activeMembersCount,
    new_signups:       newSignups,
    mrr_net:           Math.round(mrrNet * 100) / 100,
    avg_monthly_churn: Math.round(avgMonthlyChurn * 10000) / 10000,
    one_and_done_rate: Math.round(oneAndDoneRate * 10000) / 10000,
    conservative_ltv:  Math.round(conservativeLtv * 100) / 100,
    projected_ltv:     Math.round(projectedLtv * 100) / 100,
    cohort_data: {
      cohort_triangle:              cohortTriangle,
      survival_curve:               survivalCurve,
      billing_cycle_distribution:   billingCycleDist,
      realized_revenue_per_starter: realizedRevenuePerStarter,
      monthly_churn:                monthlyChurn,
      ltv_assumptions: {
        intro_price:     INTRO_PRICE,
        recurring_price: RECURRING_PRICE,
        tail_retention:  Math.round(tailRetention * 10000) / 10000,
        tail_months:     tailMonths,
      },
    },
  };
}

// ── persistence ───────────────────────────────────────────────────────────────

export async function saveMembershipMetrics(result: MembershipMetricsResult): Promise<void> {
  const { cohort_data, ...scalar } = result;
  const { error } = await supabaseAdmin
    .from('membership_metrics_daily')
    .upsert({ ...scalar, cohort_data: cohort_data as unknown as Json }, { onConflict: 'metric_date' });
  if (error) throw new Error(`membership_metrics_daily upsert: ${error.message}`);
}

export async function computeAndSaveMembershipMetrics(date: string): Promise<MembershipMetricsResult> {
  const result = await computeMembershipMetrics(date);
  await saveMembershipMetrics(result);
  return result;
}
