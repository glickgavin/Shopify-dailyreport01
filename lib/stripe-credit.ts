import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { allocateStoreCredit, debitStoreCredit } from '@/lib/store-credit';

// ── Stripe invoices → Shopify store credit ───────────────────────────────────
// Shared processing logic for the Stripe webhook (invoice.paid /
// charge.refunded), the hourly retry cron, and the admin Retry button.
// Mirrors the PayPal ledger's concurrency model: each row is atomically
// CLAIMED (conditional status transition → 'processing') before any Shopify
// mutation runs, so two concurrent deliveries can never double-credit.
//
// Business failures are recorded on the row + audit log and reported as ok
// HTTP-wise; only Stripe signature problems are rejected upstream.

const db = supabaseAdmin as any;

export interface CreditConfig {
  allocation_enabled: boolean;
  allocation_percentage: number;
  min_amount_cents: number;
  max_amount_cents: number | null;
  eligible_currencies: string[];
}

export async function loadCreditConfig(): Promise<CreditConfig> {
  const { data, error } = await db.from('stripe_credit_config').select('*').eq('id', 1).single();
  if (error || !data) throw new Error(`stripe_credit_config load: ${error?.message ?? 'missing row'}`);
  return data as CreditConfig;
}

async function auditLog(row: {
  invoice_id?: string | null;
  refund_id?: string | null;
  transaction_type: 'credit' | 'debit';
  shopify_customer_id?: string | null;
  customer_email?: string | null;
  amount_cents: number;
  currency: string;
  success: boolean;
  error_message?: string | null;
  shopify_response?: unknown;
  request_id: string;
}): Promise<void> {
  const { error } = await db.from('stripe_credit_logs').insert(row);
  if (error) console.error(`[stripe-credit] audit log insert failed: ${error.message}`);
}

export interface ProcessResult {
  id: string;               // stripe invoice/refund id
  status: string;           // terminal allocation/debit status (or 'already_processed')
  detail?: string;
}

// ── invoice.paid ─────────────────────────────────────────────────────────────

export async function processInvoicePaid(invoice: Stripe.Invoice, requestId: string): Promise<ProcessResult> {
  const inv = invoice as unknown as Record<string, any>;
  const stripeInvoiceId: string = inv.id;
  const email: string | null = (inv.customer_email ?? null)?.toLowerCase() ?? null;
  const stripeCustomerId: string | null = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
  const amountPaid: number = inv.amount_paid ?? 0;
  const currency: string = String(inv.currency ?? 'usd').toUpperCase();
  const log = (msg: string) => console.log(`[stripe-credit][${requestId}] ${stripeInvoiceId}: ${msg}`);

  // Idempotency: existing row not pending → already handled (or in flight).
  const { data: existing } = await db
    .from('stripe_credit_invoices')
    .select('id, allocation_status')
    .eq('stripe_invoice_id', stripeInvoiceId)
    .maybeSingle();
  if (existing && existing.allocation_status !== 'pending') {
    log(`already processed (${existing.allocation_status})`);
    return { id: stripeInvoiceId, status: 'already_processed', detail: existing.allocation_status };
  }

  // Upsert the row as pending with the raw invoice.
  const { data: upserted, error: upErr } = await db
    .from('stripe_credit_invoices')
    .upsert({
      stripe_invoice_id: stripeInvoiceId,
      stripe_customer_id: stripeCustomerId,
      customer_email: email,
      amount_paid: amountPaid,
      currency,
      status: String(inv.status ?? 'paid'),
      billing_reason: inv.billing_reason ?? null,
      invoice_data: inv,
    }, { onConflict: 'stripe_invoice_id' })
    .select('id')
    .single();
  if (upErr || !upserted) throw new Error(`invoice upsert: ${upErr?.message}`);
  const rowId: string = upserted.id;

  return allocateInvoiceRow(rowId, requestId);
}

/**
 * Claim a stripe_credit_invoices row and run the credit. Shared by the
 * webhook (claims from 'pending') and retries (claim from 'failed'/'processing').
 */
export async function allocateInvoiceRow(
  rowId: string,
  requestId: string,
  claimFrom: string[] = ['pending'],
): Promise<ProcessResult> {
  // ── Atomic claim ───────────────────────────────────────────────────────────
  const { data: claimed, error: claimErr } = await db
    .from('stripe_credit_invoices')
    .update({ allocation_status: 'processing', allocation_error: null })
    .eq('id', rowId)
    .in('allocation_status', claimFrom)
    .select('id, stripe_invoice_id, customer_email, amount_paid, currency');
  if (claimErr) throw new Error(`claim: ${claimErr.message}`);
  const row = (claimed ?? [])[0];
  if (!row) return { id: rowId, status: 'already_processed', detail: 'row not claimable' };

  const log = (msg: string) => console.log(`[stripe-credit][${requestId}] ${row.stripe_invoice_id}: ${msg}`);

  const terminal = async (status: string, patch: Record<string, unknown>) => {
    await db.from('stripe_credit_invoices')
      .update({ allocation_status: status, processed_at: new Date().toISOString(), ...patch })
      .eq('id', rowId).eq('allocation_status', 'processing');
  };

  // ── Config gates → skipped ─────────────────────────────────────────────────
  const cfg = await loadCreditConfig();
  const skip = async (reason: string) => {
    log(`skipped: ${reason}`);
    await terminal('skipped', { allocation_error: reason });
    return { id: row.stripe_invoice_id, status: 'skipped', detail: reason };
  };
  if (!cfg.allocation_enabled) return skip('allocation disabled');
  if (!cfg.eligible_currencies.includes(row.currency)) return skip(`currency ${row.currency} not eligible`);
  if (row.amount_paid < cfg.min_amount_cents) return skip(`amount ${row.amount_paid}¢ below minimum ${cfg.min_amount_cents}¢`);

  // ── Credit amount ──────────────────────────────────────────────────────────
  let creditCents = Math.floor(row.amount_paid * cfg.allocation_percentage / 100);
  if (cfg.max_amount_cents != null) creditCents = Math.min(creditCents, cfg.max_amount_cents);
  if (creditCents <= 0) return skip('computed credit is 0');

  if (!row.customer_email) {
    log('failed: no email on invoice');
    await terminal('failed', { allocation_error: 'no customer email on invoice' });
    await auditLog({ invoice_id: rowId, transaction_type: 'credit', customer_email: null, amount_cents: creditCents, currency: row.currency, success: false, error_message: 'no customer email on invoice', request_id: requestId });
    return { id: row.stripe_invoice_id, status: 'failed', detail: 'no email' };
  }

  // ── Credit + member-active tag (tag is inside allocateStoreCredit) ─────────
  const outcome = await allocateStoreCredit({ email: row.customer_email, amountCents: creditCents, currency: row.currency });

  if (outcome.ok) {
    log(`credited ${creditCents}¢ → ${outcome.shopifyCustomerId} (tagged=${outcome.tagged})`);
    await terminal('success', {
      credit_amount_cents: creditCents,
      shopify_customer_id: outcome.shopifyCustomerId,
      credit_reference: outcome.creditReference,
      allocation_error: null,
    });
    await auditLog({ invoice_id: rowId, transaction_type: 'credit', shopify_customer_id: outcome.shopifyCustomerId, customer_email: outcome.email, amount_cents: creditCents, currency: row.currency, success: true, shopify_response: { credit_reference: outcome.creditReference, tagged: outcome.tagged }, request_id: requestId });
    return { id: row.stripe_invoice_id, status: 'success' };
  }

  log(`failed: ${outcome.reason}: ${outcome.detail}`);
  await terminal('failed', { allocation_error: `${outcome.reason}: ${outcome.detail}` });
  await auditLog({ invoice_id: rowId, transaction_type: 'credit', customer_email: outcome.email, amount_cents: creditCents, currency: row.currency, success: false, error_message: `${outcome.reason}: ${outcome.detail}`, request_id: requestId });
  return { id: row.stripe_invoice_id, status: 'failed', detail: `${outcome.reason}: ${outcome.detail}` };
}

// ── charge.refunded ──────────────────────────────────────────────────────────

export async function processChargeRefunded(charge: Stripe.Charge, requestId: string): Promise<ProcessResult[]> {
  const ch = charge as unknown as Record<string, any>;
  const results: ProcessResult[] = [];
  const refunds: Record<string, any>[] = ch.refunds?.data ?? [];
  const stripeInvoiceId: string | null = typeof ch.invoice === 'string' ? ch.invoice : ch.invoice?.id ?? null;
  const chargeEmail: string | null =
    (ch.billing_details?.email ?? ch.receipt_email ?? null)?.toLowerCase() ?? null;

  for (const r of refunds) {
    const log = (msg: string) => console.log(`[stripe-credit][${requestId}] refund ${r.id}: ${msg}`);

    // Idempotency per refund id.
    const { data: existing } = await db
      .from('stripe_credit_refunds')
      .select('id, debit_status')
      .eq('stripe_refund_id', r.id)
      .maybeSingle();
    if (existing && existing.debit_status !== 'pending') {
      log(`already processed (${existing.debit_status})`);
      results.push({ id: r.id, status: 'already_processed', detail: existing.debit_status });
      continue;
    }

    const { data: upserted, error: upErr } = await db
      .from('stripe_credit_refunds')
      .upsert({
        stripe_refund_id: r.id,
        stripe_charge_id: ch.id ?? null,
        stripe_invoice_id: stripeInvoiceId,
        customer_email: chargeEmail,
        amount_refunded: r.amount ?? 0,
        currency: String(r.currency ?? ch.currency ?? 'usd').toUpperCase(),
        refund_reason: r.reason ?? null,
        refund_data: r,
      }, { onConflict: 'stripe_refund_id' })
      .select('id')
      .single();
    if (upErr || !upserted) throw new Error(`refund upsert: ${upErr?.message}`);
    const rowId: string = upserted.id;

    // Atomic claim pending → processing.
    const { data: claimed } = await db
      .from('stripe_credit_refunds')
      .update({ debit_status: 'processing', debit_error: null })
      .eq('id', rowId)
      .eq('debit_status', 'pending')
      .select('id, amount_refunded, currency');
    const row = (claimed ?? [])[0];
    if (!row) { results.push({ id: r.id, status: 'already_processed', detail: 'not claimable' }); continue; }

    const terminal = async (status: string, patch: Record<string, unknown>) => {
      await db.from('stripe_credit_refunds')
        .update({ debit_status: status, processed_at: new Date().toISOString(), ...patch })
        .eq('id', rowId).eq('debit_status', 'processing');
    };
    const skip = async (reason: string) => {
      log(`skipped: ${reason}`);
      await terminal('skipped', { debit_error: reason });
      results.push({ id: r.id, status: 'skipped', detail: reason });
    };

    if (!stripeInvoiceId) { await skip('refund has no linked invoice'); continue; }

    // Only claw back credit WE allocated for this invoice.
    const { data: inv } = await db
      .from('stripe_credit_invoices')
      .select('id, customer_email, amount_paid, credit_amount_cents, allocation_status, currency')
      .eq('stripe_invoice_id', stripeInvoiceId)
      .maybeSingle();
    if (!inv) { await skip('invoice not in our ledger'); continue; }
    if (inv.allocation_status !== 'success' || !inv.credit_amount_cents) { await skip(`no credit allocated for invoice (${inv.allocation_status})`); continue; }

    // Proportional debit.
    const debitCents = Math.round(inv.credit_amount_cents * (row.amount_refunded / Math.max(1, inv.amount_paid)));
    if (debitCents <= 0) { await skip('proportional debit is 0'); continue; }

    const email = chargeEmail ?? inv.customer_email;
    if (!email) { await skip('no email available'); continue; }

    const outcome = await debitStoreCredit({ email, amountCents: debitCents, currency: inv.currency });

    if (outcome.ok) {
      log(`debited ${debitCents}¢ from ${outcome.shopifyCustomerId}`);
      await terminal('success', {
        debit_amount_cents: debitCents,
        shopify_customer_id: outcome.shopifyCustomerId,
        debit_error: null,
      });
      await auditLog({ refund_id: rowId, invoice_id: inv.id, transaction_type: 'debit', shopify_customer_id: outcome.shopifyCustomerId, customer_email: outcome.email, amount_cents: debitCents, currency: inv.currency, success: true, shopify_response: { debit_reference: outcome.creditReference }, request_id: requestId });
      results.push({ id: r.id, status: 'success' });
    } else {
      log(`failed: ${outcome.reason}: ${outcome.detail}`);
      await terminal('failed', { debit_error: `${outcome.reason}: ${outcome.detail}` });
      await auditLog({ refund_id: rowId, invoice_id: inv.id, transaction_type: 'debit', customer_email: outcome.email, amount_cents: debitCents, currency: inv.currency, success: false, error_message: `${outcome.reason}: ${outcome.detail}`, request_id: requestId });
      results.push({ id: r.id, status: 'failed', detail: `${outcome.reason}: ${outcome.detail}` });
    }
  }

  return results;
}

// ── Polling sweep (primary ingestion — no webhook required) ──────────────────
// Every run lists paid invoices and refunds created in the lookback window
// straight from the Stripe API (same connection the daily snapshot cron uses),
// batch-filters out rows we've already terminally processed, and feeds the
// rest through the same idempotent engine the webhook uses. Overlapping
// windows are safe: already-processed ids are skipped before any Shopify call.
// While the kill switch is off, new invoices are ingested as terminal
// 'skipped' rows, so flipping it on later only affects invoices that arrive
// AFTER the flip — that is what makes the old-system cutover safe.

export interface SweepSummary {
  requestId: string;
  invoicesSeen: number;
  invoicesProcessed: number;
  creditResults: ProcessResult[];
  refundsSeen: number;
  chargesProcessed: number;
  refundResults: ProcessResult[];
}

export async function sweepStripe(lookbackHours = 24): Promise<SweepSummary> {
  const requestId = randomUUID();
  const gte = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

  // ── Paid invoices → credits ────────────────────────────────────────────────
  const invoices: Stripe.Invoice[] = [];
  for await (const inv of stripe.invoices.list({ status: 'paid', created: { gte }, limit: 100 })) {
    invoices.push(inv);
  }
  const invIds = invoices.map(i => (i as unknown as { id: string }).id);
  const { data: existingInv } = await db
    .from('stripe_credit_invoices')
    .select('stripe_invoice_id, allocation_status')
    .in('stripe_invoice_id', invIds.length ? invIds : ['__none__']);
  const invDone = new Set(
    ((existingInv ?? []) as { stripe_invoice_id: string; allocation_status: string }[])
      .filter(r => r.allocation_status !== 'pending')
      .map(r => r.stripe_invoice_id),
  );

  const creditResults: ProcessResult[] = [];
  let invoicesProcessed = 0;
  for (const inv of invoices) {
    if (invDone.has((inv as unknown as { id: string }).id)) continue;
    invoicesProcessed++;
    creditResults.push(await processInvoicePaid(inv, requestId));
    await sleep(400); // gentle on Shopify + Supabase
  }

  // ── Refunds → proportional debits ──────────────────────────────────────────
  const refunds: Record<string, any>[] = [];
  for await (const r of stripe.refunds.list({ created: { gte }, limit: 100 })) {
    refunds.push(r as unknown as Record<string, any>);
  }
  const refIds = refunds.map(r => r.id);
  const { data: existingRef } = await db
    .from('stripe_credit_refunds')
    .select('stripe_refund_id, debit_status')
    .in('stripe_refund_id', refIds.length ? refIds : ['__none__']);
  const refDone = new Set(
    ((existingRef ?? []) as { stripe_refund_id: string; debit_status: string }[])
      .filter(r => r.debit_status !== 'pending')
      .map(r => r.stripe_refund_id),
  );

  // One charge can carry several refunds — retrieve each charge once and let
  // processChargeRefunded handle all of its refunds idempotently.
  const chargeIds = new Set<string>();
  for (const r of refunds) {
    if (refDone.has(r.id)) continue;
    const cid = typeof r.charge === 'string' ? r.charge : r.charge?.id;
    if (cid) chargeIds.add(cid);
  }

  const refundResults: ProcessResult[] = [];
  for (const cid of Array.from(chargeIds)) {
    try {
      const charge = await stripe.charges.retrieve(cid, { expand: ['refunds'] });
      refundResults.push(...await processChargeRefunded(charge as unknown as Stripe.Charge, requestId));
    } catch (err) {
      console.error(`[stripe-credit][${requestId}] charge ${cid} retrieve/process failed: ${(err as Error).message}`);
      refundResults.push({ id: cid, status: 'error', detail: (err as Error).message });
    }
    await sleep(400);
  }

  const summary: SweepSummary = {
    requestId,
    invoicesSeen: invoices.length,
    invoicesProcessed,
    creditResults,
    refundsSeen: refunds.length,
    chargesProcessed: chargeIds.size,
    refundResults,
  };
  console.log(`[stripe-credit][${requestId}] sweep: invoices ${invoicesProcessed}/${invoices.length} processed, refunds seen ${refunds.length}, charges processed ${chargeIds.size}`);
  return summary;
}

// ── Retry loop (hourly cron + admin button) ──────────────────────────────────

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function retryFailedAllocations(options: {
  limit?: number;
  maxRetries?: number;
  includeStaleProcessing?: boolean;   // admin button: also rescue crashed-mid-flight rows
} = {}): Promise<{ retried: number; succeeded: number; failed: number; skipped: number; results: ProcessResult[] }> {
  const requestId = randomUUID();
  const limit = options.limit ?? 10;
  const maxRetries = options.maxRetries ?? 5;

  const cfg = await loadCreditConfig();
  if (!cfg.allocation_enabled) {
    return { retried: 0, succeeded: 0, failed: 0, skipped: 0, results: [{ id: 'all', status: 'skipped', detail: 'allocation disabled' }] };
  }

  const claimFrom = options.includeStaleProcessing ? ['failed', 'processing'] : ['failed'];
  const { data: rows, error } = await db
    .from('stripe_credit_invoices')
    .select('id, stripe_invoice_id, retry_count, allocation_status')
    .in('allocation_status', claimFrom)
    .lt('retry_count', maxRetries)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`retry select: ${error.message}`);

  const summary = { retried: 0, succeeded: 0, failed: 0, skipped: 0, results: [] as ProcessResult[] };
  for (const row of rows ?? []) {
    summary.retried++;
    await db.from('stripe_credit_invoices').update({ retry_count: row.retry_count + 1 }).eq('id', row.id);
    await sleep(1000); // throttle Shopify calls
    const res = await allocateInvoiceRow(row.id, requestId, claimFrom);
    summary.results.push(res);
    if (res.status === 'success') summary.succeeded++;
    else if (res.status === 'skipped') summary.skipped++;
    else summary.failed++;
  }
  console.log(`[stripe-credit][${requestId}] retry summary: ${JSON.stringify({ ...summary, results: undefined })}`);
  return summary;
}
