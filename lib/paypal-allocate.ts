import { supabaseAdmin } from '@/lib/supabase';
import { allocateStoreCredit, resolveCreditEmail } from '@/lib/store-credit';

// Shared allocation loop for paypal_subscription_ledger rows, used by both the
// admin Allocate button and the daily auto-allocate cron so the money-moving
// logic exists exactly once.
//
// Concurrency-safe: each row is atomically CLAIMED (claimFrom → processing)
// BEFORE the Shopify credit mutation runs. The claim is a conditional status
// transition, so two concurrent callers can never both reach the mutation for
// the same row — the second claim matches zero rows. On a terminal outcome the
// row moves processing → allocated | failed.

export interface AllocateResult {
  id: string;
  ok: boolean;
  status: string;
  reason?: string;
  detail?: string;
  email?: string;
  credit_reference?: string;
}

export async function allocateLedgerRows(
  ids: string[],
  actor: string,
  claimFrom: string[],
): Promise<AllocateResult[]> {
  const results: AllocateResult[] = [];

  for (const id of ids) {
    // ── Atomically claim the row (claimFrom → processing) ────────────────────
    const { data: claimed, error: claimErr } = await (supabaseAdmin as any)
      .from('paypal_subscription_ledger')
      .update({ credit_status: 'processing', credit_error: null, credit_allocated_by: actor })
      .eq('id', id)
      .in('credit_status', claimFrom)
      .select('id, gross_cents, currency, payer_email, custom_field_email');

    if (claimErr) {
      results.push({ id, ok: false, status: 'error', reason: 'claim_failed', detail: claimErr.message });
      continue;
    }

    const row = (claimed ?? [])[0];
    if (!row) {
      // Not claimable — already processing/allocated/skipped/refunded. Report current state.
      const { data: cur } = await (supabaseAdmin as any)
        .from('paypal_subscription_ledger')
        .select('credit_status')
        .eq('id', id)
        .maybeSingle();
      const st = cur?.credit_status ?? 'unknown';
      results.push({ id, ok: false, status: st, reason: 'not_claimable', detail: `row is ${st}` });
      continue;
    }

    const email = resolveCreditEmail(row);
    if (!email) {
      await (supabaseAdmin as any)
        .from('paypal_subscription_ledger')
        .update({ credit_status: 'failed', credit_error: 'no email available (custom_field or payer)', credit_allocated_by: actor })
        .eq('id', row.id).eq('credit_status', 'processing');
      results.push({ id: row.id, ok: false, status: 'failed', reason: 'no_email', detail: 'no email available' });
      continue;
    }

    const outcome = await allocateStoreCredit({
      email,
      amountCents: row.gross_cents,
      currency: row.currency ?? 'USD',
    });

    if (outcome.ok) {
      const { error: upErr } = await (supabaseAdmin as any)
        .from('paypal_subscription_ledger')
        .update({
          credit_status: 'allocated',
          credit_amount_cents: row.gross_cents,
          credit_email: outcome.email,
          credit_shopify_customer_id: outcome.shopifyCustomerId,
          credit_reference: outcome.creditReference,
          credit_allocated_at: new Date().toISOString(),
          tagged_at: outcome.tagged ? new Date().toISOString() : null,
          credit_allocated_by: actor,
          credit_error: null,
        })
        .eq('id', row.id).eq('credit_status', 'processing');

      if (upErr) {
        // Credit succeeded in Shopify but our write failed — surface loudly so it
        // isn't silently retried (which would double-credit). Leave row 'processing'.
        results.push({ id: row.id, ok: false, status: 'processing', reason: 'db_write_failed', detail: upErr.message, email: outcome.email, credit_reference: outcome.creditReference });
      } else {
        results.push({ id: row.id, ok: true, status: 'allocated', email: outcome.email, credit_reference: outcome.creditReference });
      }
    } else {
      await (supabaseAdmin as any)
        .from('paypal_subscription_ledger')
        .update({ credit_status: 'failed', credit_error: `${outcome.reason}: ${outcome.detail}`, credit_email: outcome.email, credit_allocated_by: actor })
        .eq('id', row.id).eq('credit_status', 'processing');
      results.push({ id: row.id, ok: false, status: 'failed', reason: outcome.reason, detail: outcome.detail, email: outcome.email });
    }
  }

  return results;
}
