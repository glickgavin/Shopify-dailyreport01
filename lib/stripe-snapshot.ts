import { fromZonedTime } from 'date-fns-tz';
import { stripe } from './stripe';
import { supabaseAdmin } from './supabase';
import type { Json } from './types/database';
import type Stripe from 'stripe';

export interface ChargeRow {
  id: string;
  created: number;
  iso: string;
  amount: number;
  currency: string;
  status: string;
  email: string | null;
  description: string | null;
  failure_code: string | null;
  failure_message: string | null;
  is_shopify: boolean;
  payment_method_type: string | null;
}

export interface RefundRow {
  id: string;
  created: number;
  iso: string;
  amount: number;
  currency: string;
  reason: string | null;
  charge_id: string | null;
  status: string | null;
}

export interface StripeSnapshotSummary {
  date: string;
  timezone: string;
  window_utc: { start: string; end: string };
  summary: {
    direct_success_count: number;
    direct_success_total_cents: number;
    direct_success_unique_customers: number;
    refunds_count: number;
    refunds_total_cents: number;
    failed_count: number;
    failed_total_cents: number;
    shopify_filtered_count: number;
    top_failure_reasons: { reason: string; count: number }[];
  };
  direct_success_charges: ChargeRow[];
  failed_charges: ChargeRow[];
  refunds: RefundRow[];
  shopify_charges_filtered: ChargeRow[];
}

function isShopifyCharge(c: Stripe.Charge): boolean {
  if (c.application?.toString().toLowerCase().includes('shopify')) return true;
  const md = c.metadata ?? {};
  for (const k of Object.keys(md)) {
    if (k.toLowerCase().includes('shopify')) return true;
    const v = md[k];
    if (typeof v === 'string' && v.toLowerCase().includes('shopify')) return true;
  }
  if (c.statement_descriptor?.toLowerCase().includes('shopify')) return true;
  return false;
}

async function listAllCharges(start: number, end: number): Promise<Stripe.Charge[]> {
  const all: Stripe.Charge[] = [];
  for await (const charge of stripe.charges.list({
    created: { gte: start, lte: end },
    limit: 100,
    expand: ['data.customer', 'data.payment_intent'],
  })) {
    all.push(charge);
  }
  return all;
}

async function listAllRefunds(start: number, end: number): Promise<Stripe.Refund[]> {
  const all: Stripe.Refund[] = [];
  for await (const refund of stripe.refunds.list({
    created: { gte: start, lte: end },
    limit: 100,
  })) {
    all.push(refund);
  }
  return all;
}

export async function fetchAndStoreStripeSnapshot(
  dateStr: string,
  tz: string,
): Promise<StripeSnapshotSummary> {
  const startInTz = fromZonedTime(`${dateStr}T00:00:00`, tz);
  const endInTz   = fromZonedTime(`${dateStr}T23:59:59`, tz);
  const startUnix = Math.floor(startInTz.getTime() / 1000);
  const endUnix   = Math.floor(endInTz.getTime() / 1000);

  const [allCharges, allRefunds] = await Promise.all([
    listAllCharges(startUnix, endUnix),
    listAllRefunds(startUnix, endUnix),
  ]);

  const chargeRows: ChargeRow[] = allCharges.map((c) => {
    const customer = typeof c.customer === 'object' && c.customer && !('deleted' in c.customer)
      ? c.customer : null;
    const email = customer?.email ?? c.billing_details?.email ?? c.receipt_email ?? null;

    let failureCode: string | null = null;
    let failureMessage: string | null = null;
    if (c.status === 'failed') {
      failureCode = c.failure_code ?? null;
      failureMessage = c.failure_message ?? null;
    } else if (c.outcome?.type === 'issuer_declined' || c.outcome?.network_status === 'declined_by_network') {
      failureCode = c.outcome?.reason ?? null;
      failureMessage = c.outcome?.seller_message ?? null;
    }

    return {
      id: c.id,
      created: c.created,
      iso: new Date(c.created * 1000).toISOString(),
      amount: c.amount,
      currency: c.currency,
      status: c.status,
      email,
      description: c.description,
      failure_code: failureCode,
      failure_message: failureMessage,
      is_shopify: isShopifyCharge(c),
      payment_method_type: c.payment_method_details?.type ?? null,
    };
  });

  const refundRows: RefundRow[] = allRefunds.map((r) => ({
    id: r.id,
    created: r.created,
    iso: new Date(r.created * 1000).toISOString(),
    amount: r.amount,
    currency: r.currency ?? 'usd',
    reason: r.reason ?? null,
    charge_id: typeof r.charge === 'string' ? r.charge : r.charge?.id ?? null,
    status: r.status ?? null,
  }));

  const directCharges    = chargeRows.filter((c) => !c.is_shopify);
  const successCharges   = directCharges.filter((c) => c.status === 'succeeded');
  const failedCharges    = directCharges.filter((c) => c.status === 'failed');
  const successTotal     = successCharges.reduce((acc, c) => acc + c.amount, 0);
  const successCustomers = new Set(successCharges.map((c) => c.email).filter(Boolean));
  const refundsTotal     = refundRows.reduce((acc, r) => acc + r.amount, 0);
  const failedTotal      = failedCharges.reduce((acc, c) => acc + c.amount, 0);

  const failureReasons = new Map<string, number>();
  for (const f of failedCharges) {
    const reason = f.failure_message ?? f.failure_code ?? 'unknown';
    failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
  }
  const topFailures = Array.from(failureReasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  const payload: StripeSnapshotSummary = {
    date: dateStr,
    timezone: tz,
    window_utc: { start: startInTz.toISOString(), end: endInTz.toISOString() },
    summary: {
      direct_success_count: successCharges.length,
      direct_success_total_cents: successTotal,
      direct_success_unique_customers: successCustomers.size,
      refunds_count: refundRows.length,
      refunds_total_cents: refundsTotal,
      failed_count: failedCharges.length,
      failed_total_cents: failedTotal,
      shopify_filtered_count: chargeRows.length - directCharges.length,
      top_failure_reasons: topFailures,
    },
    direct_success_charges: successCharges,
    failed_charges: failedCharges,
    refunds: refundRows,
    shopify_charges_filtered: chargeRows.filter((c) => c.is_shopify),
  };

  const { error } = await supabaseAdmin
    .from('stripe_daily_snapshot')
    .upsert(
      { date: dateStr, payload: payload as unknown as Json, fetched_at: new Date().toISOString() },
      { onConflict: 'date' },
    );
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);

  return payload;
}
