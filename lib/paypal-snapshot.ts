import { fromZonedTime } from 'date-fns-tz';
import { paypalGet } from './paypal';
import { supabaseAdmin } from './supabase';
import type { Json } from './types/database';

// ── types ─────────────────────────────────────────────────────────────────────

export interface PayPalTxnRow {
  id: string;
  initiated_iso: string;
  gross_cents: number;
  fee_cents: number;
  currency: string;
  status: string;
  email: string | null;
  name: string | null;
  invoice_id: string | null;
  custom_field: string | null;
  subject: string | null;
  is_shopify: boolean;
  instrument_type: string | null;
  instrument_sub_type: string | null;
  /**
   * PayPal's transaction event code (e.g. T0006 = sale received, T1107 =
   * refund of payment, T0400/T1500 = withdrawal). Captured for forensic /
   * audit use. The customer-attribution classifier (see hasCustomer below)
   * does the actual work; this field is a belt-and-suspenders signal.
   */
  transaction_event_code: string | null;
}

export interface PayPalSnapshotSummary {
  date: string;
  timezone: string;
  window_utc: { start: string; end: string };
  summary: {
    direct_success_count: number;
    direct_success_total_cents: number;
    direct_success_unique_customers: number;
    refunds_count: number;
    refunds_total_cents: number;
    denied_count: number;
    denied_total_cents: number;
    shopify_filtered_count: number;
    /**
     * Negative or zero-attribution rows excluded from success/refunds —
     * payouts to bank, balance transfers, currency conversions, reserve
     * releases. Surfaced for transparency, not part of revenue math.
     */
    excluded_internal_transfers_count: number;
    /** Signed net cents — positive in, negative out — of excluded rows. */
    excluded_internal_transfers_net_cents: number;
    top_denial_reasons: { reason: string; count: number }[];
  };
  direct_success_transactions: PayPalTxnRow[];
  denied_transactions: PayPalTxnRow[];
  refunds: PayPalTxnRow[];
  shopify_transactions_filtered: PayPalTxnRow[];
  excluded_internal_transfers: PayPalTxnRow[];
}

// ── Shopify detection ─────────────────────────────────────────────────────────

function isShopifyTxn(detail: Record<string, unknown>): boolean {
  const info  = (detail.transaction_info  as Record<string, unknown>) ?? {};
  const aux   = (detail.auxiliary_info    as Record<string, unknown>) ?? {};
  const cart  = (detail.cart_info         as Record<string, unknown>) ?? {};
  const store = (detail.store_info        as Record<string, unknown>) ?? {};

  const checkStr = (s: unknown) =>
    typeof s === 'string' && s.toLowerCase().includes('shopify');

  if (checkStr(aux.application_id))           return true;
  if (checkStr(aux.payment_method_type))       return true;
  if (checkStr(info.protection_eligibility_type)) return true;
  if (checkStr(info.transaction_subject))      return true;

  for (const section of [aux, store, cart]) {
    for (const v of Object.values(section)) {
      if (checkStr(v)) return true;
    }
  }

  // Heuristic: Shopify-routed PayPal invoice IDs are 20-32 chars mixed-case alphanumeric
  const invoice = info.invoice_id;
  if (
    typeof invoice === 'string' &&
    invoice.length >= 20 && invoice.length <= 32 &&
    /^[A-Za-z0-9]+$/.test(invoice) &&
    /[a-z]/.test(invoice) && /[A-Z]/.test(invoice)
  ) {
    return true;
  }

  return false;
}

// ── customer-attribution classifier ───────────────────────────────────────────

/**
 * True if the row has any customer attribution (name or email present and
 * non-empty). PayPal payouts, transfers, currency conversions, and reserve
 * releases have neither — that's how we tell them apart from real refunds
 * and sales, which always carry the buyer's name/email.
 *
 * Validated against May 29 2026 data: 11 real VIP Club sales (all had name
 * + email + subject + non-zero fee) vs 3 internal balance movements (all
 * null name + null email + null subject + zero fee, including a matched
 * +/- $8,448.37 pair at the exact same timestamp).
 */
function hasCustomer(row: PayPalTxnRow): boolean {
  return (row.name !== null && row.name.length > 0)
      || (row.email !== null && row.email.length > 0);
}

// ── pagination ────────────────────────────────────────────────────────────────

async function listAllTransactions(startIso: string, endIso: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const resp = await paypalGet('/v1/reporting/transactions', {
      start_date: startIso,
      end_date:   endIso,
      fields:     'all',
      page_size:  '100',
      page:       String(page),
    }) as { transaction_details?: Record<string, unknown>[]; total_pages?: number };

    const batch = resp.transaction_details ?? [];
    all.push(...batch);
    const totalPages = resp.total_pages ?? 1;
    if (page >= totalPages || batch.length === 0) break;
    page++;
  }
  return all;
}

// ── row mapper ────────────────────────────────────────────────────────────────

function toRow(detail: Record<string, unknown>): PayPalTxnRow {
  const info  = (detail.transaction_info as Record<string, unknown>) ?? {};
  const payer = (detail.payer_info       as Record<string, unknown>) ?? {};
  const amt   = (info.transaction_amount as Record<string, unknown>) ?? {};
  const fee   = (info.fee_amount         as Record<string, unknown>) ?? {};
  const name  = (payer.payer_name        as Record<string, unknown>) ?? {};

  const grossDecimal = parseFloat(String(amt.value ?? '0'));
  const feeDecimal   = parseFloat(String(fee.value ?? '0'));

  let txnName: string | null = null;
  if (typeof name.alternate_full_name === 'string' && name.alternate_full_name) {
    txnName = name.alternate_full_name;
  } else {
    const parts = [name.given_name, name.surname].filter((p) => typeof p === 'string' && p);
    txnName = parts.length > 0 ? parts.join(' ') : null;
  }

  return {
    id:                   String(info.transaction_id ?? ''),
    initiated_iso:        String(info.transaction_initiation_date ?? ''),
    gross_cents:          isNaN(grossDecimal) ? 0 : Math.round(grossDecimal * 100),
    fee_cents:            isNaN(feeDecimal)   ? 0 : Math.round(feeDecimal   * 100),
    currency:             String(amt.currency_code ?? 'USD'),
    status:               String(info.transaction_status ?? 'S'),
    email:                typeof payer.email_address === 'string' ? payer.email_address : null,
    name:                 txnName,
    invoice_id:           typeof info.invoice_id    === 'string' ? info.invoice_id    : null,
    custom_field:         typeof info.custom_field  === 'string' ? info.custom_field  : null,
    subject:              typeof info.transaction_subject === 'string' ? info.transaction_subject : null,
    is_shopify:           isShopifyTxn(detail),
    instrument_type:      typeof info.instrument_type     === 'string' ? info.instrument_type     : null,
    instrument_sub_type:  typeof info.instrument_sub_type === 'string' ? info.instrument_sub_type : null,
    transaction_event_code: typeof info.transaction_event_code === 'string' ? info.transaction_event_code : null,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

export async function fetchAndStorePayPalSnapshot(
  dateStr: string,
  tz: string,
): Promise<PayPalSnapshotSummary> {
  const startInTz = fromZonedTime(`${dateStr}T00:00:00`, tz);
  const endInTz   = fromZonedTime(`${dateStr}T23:59:59`, tz);

  const rawDetails = await listAllTransactions(
    startInTz.toISOString(),
    endInTz.toISOString(),
  );

  const allRows = rawDetails.map((d) => {
    try {
      return toRow(d);
    } catch (e) {
      console.warn('[paypal-snapshot] toRow error, skipping:', e);
      return null;
    }
  }).filter((r): r is PayPalTxnRow => r !== null);

  // Drop Shopify-routed PayPal transactions — those are counted in the
  // Shopify order pipeline already and would double-count here.
  const direct = allRows.filter((r) => !r.is_shopify);

  // Classification, in order:
  //   1. status='D' → denied (regardless of attribution)
  //   2. no customer attribution → excluded internal transfer
  //   3. status='S' && gross>0 → real success
  //   4. status='S' && gross<0 → real refund
  //   5. everything else (status='P'/'V'/etc with attribution) → denied bucket
  //
  // Rule order matters: a payout reported with status='D' (rare) should
  // still be classified as denied so admins see it — internal transfers
  // are only those with status='S' AND no attribution.
  const denied:   PayPalTxnRow[] = [];
  const success:  PayPalTxnRow[] = [];
  const refunds:  PayPalTxnRow[] = [];
  const excluded: PayPalTxnRow[] = [];

  for (const r of direct) {
    if (r.status === 'D') {
      denied.push(r);
    } else if (!hasCustomer(r)) {
      excluded.push(r);
    } else if (r.status === 'S' && r.gross_cents > 0) {
      success.push(r);
    } else if (r.status === 'S' && r.gross_cents < 0) {
      refunds.push(r);
    } else {
      // Unusual: attributed row with non-S/non-D status (pending, reversed,
      // etc.). Bucket with denied so it's visible but not silently dropped.
      denied.push(r);
    }
  }

  const summary = {
    direct_success_count:                  success.length,
    direct_success_total_cents:            success.reduce((a, r) => a + r.gross_cents, 0),
    direct_success_unique_customers:       new Set(success.map((r) => r.email).filter(Boolean)).size,
    refunds_count:                         refunds.length,
    refunds_total_cents:                   Math.abs(refunds.reduce((a, r) => a + r.gross_cents, 0)),
    denied_count:                          denied.length,
    denied_total_cents:                    denied.reduce((a, r) => a + r.gross_cents, 0),
    shopify_filtered_count:                allRows.length - direct.length,
    excluded_internal_transfers_count:     excluded.length,
    excluded_internal_transfers_net_cents: excluded.reduce((a, r) => a + r.gross_cents, 0),
    top_denial_reasons:                    [] as { reason: string; count: number }[],
  };

  const payload: PayPalSnapshotSummary = {
    date: dateStr,
    timezone: tz,
    window_utc: { start: startInTz.toISOString(), end: endInTz.toISOString() },
    summary,
    direct_success_transactions:   success,
    denied_transactions:           denied,
    refunds,
    shopify_transactions_filtered: allRows.filter((r) => r.is_shopify),
    excluded_internal_transfers:   excluded,
  };

  const { error } = await supabaseAdmin
    .from('paypal_daily_snapshot')
    .upsert(
      { date: dateStr, payload: payload as unknown as Json, fetched_at: new Date().toISOString() },
      { onConflict: 'date' },
    );
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

  return payload;
}
