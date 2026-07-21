import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { allocateStoreCredit, resolveCreditEmail } from '@/lib/store-credit';
import { getAdminSessionUser } from '@/lib/admin-session';

/**
 * POST /api/admin/paypal-subscriptions/allocate
 * Body: { ids: string[]; actor?: string }
 *
 * Concurrency-safe: each row is atomically CLAIMED (pending/failed → processing)
 * BEFORE the Shopify credit mutation runs. The claim is a conditional status
 * transition, so two concurrent requests (double-click, retry, two operators)
 * can never both reach the mutation for the same row — the second claim matches
 * zero rows. On a terminal outcome the row moves processing → allocated | failed.
 */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { ids?: string[]; actor?: string } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter(x => typeof x === 'string') : [];
  const actor = body?.actor ?? user.email ?? 'admin';
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const results: Array<{
    id: string;
    ok: boolean;
    status: string;
    reason?: string;
    detail?: string;
    email?: string;
    credit_reference?: string;
  }> = [];

  for (const id of ids) {
    // ── Atomically claim the row (pending/failed → processing) ────────────────
    const { data: claimed, error: claimErr } = await (supabaseAdmin as any)
      .from('paypal_subscription_ledger')
      .update({ credit_status: 'processing', credit_error: null, credit_allocated_by: actor })
      .eq('id', id)
      .in('credit_status', ['pending', 'failed'])
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

  return NextResponse.json({ results });
}
