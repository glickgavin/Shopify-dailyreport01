/**
 * Membership status inference from billing cadence.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Simplee Memberships (the subscription app) has no documented public REST
 * API or webhook system. Shopify's own subscription-contract webhooks
 * (subscription_billing_attempts/failure, subscription_contracts/update)
 * require the `read_own_subscription_contracts` OAuth scope, which this
 * store's custom app does not have. All we can see is the Shopify order
 * history — one paid order per billing cycle per member.
 *
 * THE HEURISTIC
 * ─────────────
 * We infer membership status from the gap between the snapshot date and
 * the customer's last billing event:
 *
 *   ≤ ACTIVE_WINDOW days  + has a recurring charge  → 'active'
 *   ≤ ACTIVE_WINDOW days  + intro only               → 'new'
 *   > ACTIVE_WINDOW       + intro only               → 'intro_cancelled'
 *   > ACTIVE_WINDOW, ≤ SUSPECT_WINDOW + recurring    → 'involuntary_suspect'
 *   > SUSPECT_WINDOW      + recurring                → 'churned'
 *
 * KNOWN LIMITATION
 * ────────────────
 * We CANNOT distinguish voluntary cancellation from a payment failure.
 * Both show up as "no new charge in the expected window."
 * 'involuntary_suspect' and 'churned' are coarse buckets that include both
 * outcomes. True separation requires either Shopify's subscription-contract
 * scope (voluntary = CANCELLED status) or Simplee webhook events
 * (payment_failed vs customer_cancelled). Neither is currently available.
 */

import { format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';

// Simplee bills monthly. Allow a 7-day grace window for billing-date drift.
const BILLING_CYCLE_DAYS = 30;
const GRACE_DAYS = 7;

/** Customer billed within this window = still in active cycle. */
const ACTIVE_WINDOW  = BILLING_CYCLE_DAYS + GRACE_DAYS;       // 37 days
/** Missed one full cycle but not yet two. */
const SUSPECT_WINDOW = BILLING_CYCLE_DAYS * 2 + GRACE_DAYS;   // 67 days

export type ContractStatus =
  | 'new'                 // intro only, first recurring not yet due
  | 'active'              // billed within current cycle
  | 'intro_cancelled'     // only ever had intro; window elapsed (cancelled OR intro payment failed)
  | 'involuntary_suspect' // had recurring charges; missed 1 cycle (voluntary cancel OR payment failure)
  | 'churned';            // missed 2+ cycles

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
  events: BillingEvent[],
  asOf: Date,
): SnapshotRow {
  // events already sorted ascending by caller
  const last  = events[events.length - 1];
  const first = events[0];

  const daysSinceLast = Math.floor(
    (asOf.getTime() - new Date(last.charged_at).getTime()) / 86_400_000,
  );

  const hasRecurring = events.some((e) => !e.is_intro);

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
  const firstSeenMonth  = `${firstChargeDate.getFullYear()}-${
    String(firstChargeDate.getMonth() + 1).padStart(2, '0')}-01`;

  return {
    snapshot_date:          format(asOf, 'yyyy-MM-dd'),
    customer_id:            customerId,
    was_billed_this_period: daysSinceLast <= ACTIVE_WINDOW,
    last_charge_amount:     last.net_amount,
    contract_status,
    is_active:              contract_status === 'active' || contract_status === 'new',
    first_seen_month:       firstSeenMonth,
  };
}

/**
 * Compute a membership status snapshot for every customer who has had
 * at least one billing event on or before `date`.
 *
 * For daily use: call with today's date.  The function deletes any existing
 * rows for that snapshot_date first so the pipeline is idempotent.
 * Past snapshot dates are never re-written (append-only contract of the table).
 *
 * Returns the number of customer rows written.
 */
export async function runMembershipStatusSnapshot(date: string): Promise<number> {
  // Load all billing events up to end of this date (UTC)
  const { data: events, error: fetchErr } = await supabaseAdmin
    .from('membership_billing_events')
    .select('customer_id, charged_at, is_intro, net_amount')
    .lte('charged_at', `${date}T23:59:59Z`)
    .order('charged_at', { ascending: true });

  if (fetchErr) throw new Error(`membership_billing_events fetch: ${fetchErr.message}`);
  if (!events || events.length === 0) return 0;

  // Group by customer
  const byCustomer = new Map<string, BillingEvent[]>();
  for (const e of events) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, []);
    byCustomer.get(e.customer_id)!.push(e as BillingEvent);
  }

  const asOf = new Date(`${date}T23:59:59Z`);
  const rows: SnapshotRow[] = [];
  for (const [cid, evts] of byCustomer) {
    rows.push(inferOne(cid, evts, asOf));
  }

  // Delete today's existing rows (idempotency for the current run date)
  const { error: delErr } = await supabaseAdmin
    .from('membership_status_snapshots')
    .delete()
    .eq('snapshot_date', date);
  if (delErr) throw new Error(`membership_status_snapshots delete: ${delErr.message}`);

  // Insert fresh
  const { error: insErr } = await supabaseAdmin
    .from('membership_status_snapshots')
    .insert(rows);
  if (insErr) throw new Error(`membership_status_snapshots insert: ${insErr.message}`);

  return rows.length;
}
