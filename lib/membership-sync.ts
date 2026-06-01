import { fetchOrdersForDate } from '@/lib/queries/orders';
import { upsertMembershipBillingEvents } from '@/lib/persistence';
import { supabaseAdmin } from '@/lib/supabase';

export interface MembershipSyncResult {
  date:        string;
  rows_synced: number;
  intro:       number;
  recurring:   number;
}

/**
 * Fetch a day's Shopify orders, extract VIP Membership line items, and upsert
 * them into membership_billing_events.  Updates the sync-state cursor on success.
 *
 * Idempotent: re-running for the same date is safe (upsert with ignoreDuplicates).
 */
export async function syncMembershipEventsForDate(date: string): Promise<MembershipSyncResult> {
  const { membershipBillingRows } = await fetchOrdersForDate(date);
  const rowsSynced = await upsertMembershipBillingEvents(membershipBillingRows);

  const intro     = membershipBillingRows.filter(r => r.is_intro).length;
  const recurring = membershipBillingRows.length - intro;

  if (membershipBillingRows.length > 0) {
    const maxChargedAt = membershipBillingRows.reduce(
      (max, r) => (r.charged_at > max ? r.charged_at : max),
      membershipBillingRows[0].charged_at,
    );
    await supabaseAdmin
      .from('membership_sync_state')
      .update({
        last_synced_charged_at: maxChargedAt,
        last_run_at:            new Date().toISOString(),
        last_run_status:        'success',
        last_run_rows:          rowsSynced,
      })
      .eq('id', 1);
  }

  return { date, rows_synced: rowsSynced, intro, recurring };
}
