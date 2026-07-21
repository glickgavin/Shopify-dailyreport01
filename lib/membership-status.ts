/**
 * Membership status inference from billing cadence.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Simplee Memberships has no documented REST API or webhook system.
 * Shopify's subscription-contract webhooks require read_own_subscription_contracts
 * OAuth scope, which this store's custom app does not have.
 * All we can observe is the Shopify order history — one paid order per
 * billing cycle per member.
 *
 * THE HEURISTIC (contract_status)
 * ─────────────────────────────────
 *   days_since_last = snapshot_date − last billing event
 *
 *   ≤ ACTIVE_WINDOW  + has recurring  → 'active'
 *   ≤ ACTIVE_WINDOW  + intro only     → 'new'          (first recurring not yet due)
 *   > ACTIVE_WINDOW  + intro only     → 'intro_cancelled'
 *   > ACTIVE_WINDOW, ≤ SUSPECT_WINDOW → 'involuntary_suspect'
 *   > SUSPECT_WINDOW                  → 'churned'
 *
 * KNOWN LIMITATION
 * ────────────────
 * We CANNOT distinguish voluntary cancellation from a failed payment.
 * Both appear as "no new charge in the expected window."
 * 'involuntary_suspect' and 'churned' include both outcomes. True
 * separation requires Shopify's subscription-contract scope or Simplee
 * webhook events — neither is currently available on this store.
 */

import { format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';

// Simplee bills monthly. 7-day grace handles billing-date drift.
const BILLING_CYCLE_DAYS = 30;
const GRACE_DAYS          = 7;
const ACTIVE_WINDOW       = BILLING_CYCLE_DAYS + GRACE_DAYS;       // 37 days
const SUSPECT_WINDOW      = BILLING_CYCLE_DAYS * 2 + GRACE_DAYS;   // 67 days

export type ContractStatus =
  | 'new'                 // intro only; first recurring not yet due
  | 'active'              // billed within current cycle
  | 'intro_cancelled'     // intro only; window elapsed (cancelled OR failed)
  | 'involuntary_suspect' // had recurring; missed 1 cycle (cancel OR failed)
  | 'churned';            // missed 2+ cycles

export interface MembershipSnapshotResult {
  snapshot_date:       string;
  total:               number;
  active:              number;
  new_members:         number;
  intro_cancelled:     number;
  involuntary_suspect: number;
  churned:             number;
  billed_this_period:  number;
}

interface BillingEvent {
  customer_id: string;
  charged_at:  string;
  is_intro:    boolean;
  net_amount:  number;
}

interface SnapshotRow {
  snapshot_date:          string;
  customer_id:            string;
  was_billed_this_period: boolean;
  last_charge_amount:     number;
  contract_status:        ContractStatus;
  is_active:              boolean;
  first_seen_month:       string;
}

function inferOne(
  customerId: string,
  events: BillingEvent[], // pre-sorted ascending by caller
  asOf: Date,
): SnapshotRow {
  const last  = events[events.length - 1];
  const first = events[0];

  const daysSinceLast = Math.floor(
    (asOf.getTime() - new Date(last.charged_at).getTime()) / 86_400_000,
  );
  const hasRecurring = events.some((e) => !e.is_intro);

  // was_billed_this_period: any charge in the same calendar month as asOf
  const snapshotYYYYMM = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`;
  const wasBilledThisPeriod = events.some((e) => {
    const d = new Date(e.charged_at);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` === snapshotYYYYMM;
  });

  let contract_status: ContractStatus;
  if (daysSinceLast <= ACTIVE_WINDOW) {
    contract_status = hasRecurring ? 'active' : 'new';
  } else if (!hasRecurring) {
    contract_status = 'intro_cancelled';
  } else if (daysSinceLast <= SUSPECT_WINDOW) {
    contract_status = 'involuntary_suspect';
  } else {
    contract_status = 'churned';
  }

  const firstChargeDate = new Date(first.charged_at);
  const firstSeenMonth  = `${firstChargeDate.getUTCFullYear()}-${
    String(firstChargeDate.getUTCMonth() + 1).padStart(2, '0')}-01`;

  return {
    snapshot_date:          format(asOf, 'yyyy-MM-dd'),
    customer_id:            customerId,
    was_billed_this_period: wasBilledThisPeriod,
    last_charge_amount:     last.net_amount,
    contract_status,
    is_active:              contract_status === 'active' || contract_status === 'new',
    first_seen_month:       firstSeenMonth,
  };
}

/**
 * Write one membership_status_snapshots row per known member for `date`.
 *
 * Idempotent: deletes and replaces rows for `date` only — prior dates
 * are never touched (the table is append-only for past dates).
 *
 * Returns a result object with total + per-status counts for logging.
 */
export async function runMembershipStatusSnapshot(
  date: string,
): Promise<MembershipSnapshotResult> {
  // Paginate past PostgREST's 1000-row default — otherwise only the oldest
  // 1000 events (up to `date`) are returned, truncating recent months and
  // corrupting the active / new / churned counts derived below.
  const events: Array<{ customer_id: string; charged_at: string; is_intro: boolean; net_amount: number }> = [];
  {
    const PAGE = 1000;
    for (let from = 0; from < 1_000_000; from += PAGE) {
      const { data: page, error: fetchErr } = await supabaseAdmin
        .from('membership_billing_events')
        .select('customer_id, charged_at, is_intro, net_amount')
        .lte('charged_at', `${date}T23:59:59Z`)
        .order('charged_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (fetchErr) throw new Error(`membership_billing_events fetch: ${fetchErr.message}`);
      if (!page || page.length === 0) break;
      events.push(...page);
      if (page.length < PAGE) break;
    }
  }

  const result: MembershipSnapshotResult = {
    snapshot_date: date,
    total: 0, active: 0, new_members: 0,
    intro_cancelled: 0, involuntary_suspect: 0, churned: 0,
    billed_this_period: 0,
  };

  if (!events || events.length === 0) return result;

  // Group by customer (events already sorted asc)
  const byCustomer = new Map<string, BillingEvent[]>();
  for (const e of events) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, []);
    byCustomer.get(e.customer_id)!.push(e as BillingEvent);
  }

  const asOf = new Date(`${date}T23:59:59Z`);
  const rows: SnapshotRow[] = [];

  for (const [cid, evts] of Array.from(byCustomer)) {
    const row = inferOne(cid, evts, asOf);
    rows.push(row);
    result.total++;
    if (row.was_billed_this_period) result.billed_this_period++;
    switch (row.contract_status) {
      case 'active':              result.active++;              break;
      case 'new':                 result.new_members++;         break;
      case 'intro_cancelled':     result.intro_cancelled++;     break;
      case 'involuntary_suspect': result.involuntary_suspect++; break;
      case 'churned':             result.churned++;             break;
    }
  }

  // Delete this date's rows then insert fresh (idempotent)
  const { error: delErr } = await supabaseAdmin
    .from('membership_status_snapshots')
    .delete()
    .eq('snapshot_date', date);
  if (delErr) throw new Error(`membership_status_snapshots delete: ${delErr.message}`);

  const { error: insErr } = await supabaseAdmin
    .from('membership_status_snapshots')
    .insert(rows);
  if (insErr) throw new Error(`membership_status_snapshots insert: ${insErr.message}`);

  return result;
}
