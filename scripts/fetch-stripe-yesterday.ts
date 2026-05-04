import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { subDays } from 'date-fns';
import { toZonedTime, format, fromZonedTime } from 'date-fns-tz';
import { stripe } from '../lib/stripe';
import { supabaseAdmin } from '../lib/supabase';
import type { Json } from '../lib/types/database';
import type Stripe from 'stripe';

interface ChargeRow {
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

interface RefundRow {
  id: string;
  created: number;
  iso: string;
  amount: number;
  currency: string;
  reason: string | null;
  charge_id: string | null;
  status: string | null;
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
  // Shopify Payments charges typically appear with application='ca_...' for Shopify
  // and source_type 'card' but with metadata.shopify_order_id etc.
  return false;
}

function fmtUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(cents / 100);
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

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set in .env.local');
    process.exit(1);
  }

  const tz = process.env.STORE_TIMEZONE ?? 'Asia/Jerusalem';
  const dateArg = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1];

  // Compute yesterday in store timezone, then convert to UTC unix timestamps
  const yesterdayInTz = dateArg ?? format(
    toZonedTime(subDays(new Date(), 1), tz),
    'yyyy-MM-dd',
    { timeZone: tz },
  );

  const startInTz = fromZonedTime(`${yesterdayInTz}T00:00:00`, tz);
  const endInTz   = fromZonedTime(`${yesterdayInTz}T23:59:59`, tz);
  const startUnix = Math.floor(startInTz.getTime() / 1000);
  const endUnix   = Math.floor(endInTz.getTime() / 1000);

  console.log(`[stripe] Date (${tz}): ${yesterdayInTz}`);
  console.log(`[stripe] UTC window: ${startInTz.toISOString()} → ${endInTz.toISOString()}`);
  console.log(`[stripe] Fetching charges and refunds...`);

  const [allCharges, allRefunds] = await Promise.all([
    listAllCharges(startUnix, endUnix),
    listAllRefunds(startUnix, endUnix),
  ]);

  // Process charges
  const chargeRows: ChargeRow[] = allCharges.map((c) => {
    const customer = typeof c.customer === 'object' && c.customer && !('deleted' in c.customer)
      ? c.customer
      : null;
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

  // Direct (non-Shopify) charges
  const directCharges = chargeRows.filter((c) => !c.is_shopify);
  const successCharges = directCharges.filter((c) => c.status === 'succeeded');
  const failedCharges  = directCharges.filter((c) => c.status === 'failed');

  const successTotal  = successCharges.reduce((acc, c) => acc + c.amount, 0);
  const successCustomers = new Set(successCharges.map((c) => c.email).filter(Boolean));

  const refundsTotal  = refundRows.reduce((acc, r) => acc + r.amount, 0);

  const failedTotal   = failedCharges.reduce((acc, c) => acc + c.amount, 0);
  const failureReasons = new Map<string, number>();
  for (const f of failedCharges) {
    const reason = f.failure_message ?? f.failure_code ?? 'unknown';
    failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
  }
  const topFailures = Array.from(failureReasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Summary table
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  STRIPE SUMMARY — ${yesterdayInTz}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Successful direct charges (excl. Shopify):`);
  console.log(`    Count:           ${successCharges.length}`);
  console.log(`    Total:           ${fmtUSD(successTotal)}`);
  console.log(`    Unique customers: ${successCustomers.size}`);
  console.log('');
  console.log(`  Refunds (all sources):`);
  console.log(`    Count:           ${refundRows.length}`);
  console.log(`    Total:           ${fmtUSD(refundsTotal)}`);
  console.log('');
  console.log(`  Failed direct charges:`);
  console.log(`    Count:           ${failedCharges.length}`);
  console.log(`    Total attempted: ${fmtUSD(failedTotal)}`);
  if (topFailures.length > 0) {
    console.log(`    Top reasons:`);
    for (const [reason, count] of topFailures) {
      console.log(`      [${count}x] ${reason}`);
    }
  }
  console.log('');
  console.log(`  Shopify-originated charges (filtered out): ${chargeRows.length - directCharges.length}`);
  console.log('');

  // Per-charge listing for direct successes
  if (successCharges.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  SUCCESSFUL DIRECT CHARGES');
    console.log('───────────────────────────────────────────────────────────');
    for (const c of successCharges.sort((a, b) => a.created - b.created)) {
      const time = new Date(c.created * 1000).toLocaleString('en-US', { timeZone: tz });
      console.log(`  ${time}  ${fmtUSD(c.amount).padStart(10)}  ${(c.email ?? '—').padEnd(32)}  ${c.description ?? ''}`);
    }
    console.log('');
  }

  if (failedCharges.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  FAILED DIRECT CHARGES');
    console.log('───────────────────────────────────────────────────────────');
    for (const c of failedCharges.sort((a, b) => a.created - b.created)) {
      const time = new Date(c.created * 1000).toLocaleString('en-US', { timeZone: tz });
      const reason = c.failure_message ?? c.failure_code ?? 'unknown';
      console.log(`  ${time}  ${fmtUSD(c.amount).padStart(10)}  ${(c.email ?? '—').padEnd(32)}  ${reason}`);
    }
    console.log('');
  }

  if (refundRows.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  REFUNDS');
    console.log('───────────────────────────────────────────────────────────');
    for (const r of refundRows.sort((a, b) => a.created - b.created)) {
      const time = new Date(r.created * 1000).toLocaleString('en-US', { timeZone: tz });
      console.log(`  ${time}  ${fmtUSD(r.amount).padStart(10)}  ${r.reason ?? '—'}  charge=${r.charge_id ?? '—'}`);
    }
    console.log('');
  }

  // Persist snapshot
  const payload = {
    timezone: tz,
    window_utc: { start: startInTz.toISOString(), end: endInTz.toISOString() },
    summary: {
      direct_success_count:    successCharges.length,
      direct_success_total_cents: successTotal,
      direct_success_unique_customers: successCustomers.size,
      refunds_count:           refundRows.length,
      refunds_total_cents:     refundsTotal,
      failed_count:            failedCharges.length,
      failed_total_cents:      failedTotal,
      shopify_filtered_count:  chargeRows.length - directCharges.length,
      top_failure_reasons:     topFailures.map(([reason, count]) => ({ reason, count })),
    },
    direct_success_charges: successCharges,
    failed_charges: failedCharges,
    refunds: refundRows,
    shopify_charges_filtered: chargeRows.filter((c) => c.is_shopify),
  };

  console.log(`[stripe] Writing snapshot to Supabase (stripe_daily_snapshot)...`);
  const { error } = await supabaseAdmin
    .from('stripe_daily_snapshot')
    .upsert(
      { date: yesterdayInTz, payload: payload as unknown as Json, fetched_at: new Date().toISOString() },
      { onConflict: 'date' },
    );
  if (error) {
    console.error(`[stripe] Supabase upsert failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`[stripe] Snapshot saved for ${yesterdayInTz}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
