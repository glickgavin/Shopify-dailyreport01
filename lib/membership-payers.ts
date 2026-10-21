import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchPayPalMonthlyPayers } from '@/lib/paypal-snapshot';

// Monthly membership payment rollups: how many distinct customers actually
// paid in a given calendar month, per provider. Backfilled from the provider
// APIs (not from daily snapshots, which start too late and would double-count
// a customer whose retry lands on a different day).

export interface MonthlyPayers {
  month: string;        // yyyy-MM-01
  provider: 'stripe' | 'paypal';
  unique_payers: number;
  payments: number;
  amount_cents: number;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

// ── Stripe: paid invoices in the month, distinct Stripe customer ──────────────

export async function computeStripeMonthlyPayers(month: string): Promise<MonthlyPayers> {
  const { start, end } = monthRange(month);
  const customers = new Set<string>();
  let payments = 0;
  let amount = 0;

  for await (const inv of stripe.invoices.list({
    status: 'paid',
    created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
    limit: 100,
  })) {
    if (!inv.amount_paid || inv.amount_paid <= 0) continue;
    payments++;
    amount += inv.amount_paid;
    const cust = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (cust) customers.add(cust);
    else if (inv.customer_email) customers.add(inv.customer_email.toLowerCase());
  }

  return { month: `${month}-01`, provider: 'stripe', unique_payers: customers.size, payments, amount_cents: amount };
}

// ── PayPal: successful direct (non-Shopify) sales in the month ────────────────

export async function computePayPalMonthlyPayers(month: string): Promise<MonthlyPayers> {
  const { start, end } = monthRange(month);
  // PayPal reporting API caps a window at 31 days; a calendar month fits.
  const endIso = new Date(end.getTime() - 1000).toISOString();
  const r = await fetchPayPalMonthlyPayers(start.toISOString(), endIso);
  return { month: `${month}-01`, provider: 'paypal', unique_payers: r.uniquePayers, payments: r.payments, amount_cents: r.amountCents };
}

// ── upsert ────────────────────────────────────────────────────────────────────

export async function storeMonthlyPayers(rows: MonthlyPayers[]): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from('membership_monthly_payers')
    .upsert(rows.map(r => ({ ...r, computed_at: new Date().toISOString() })), { onConflict: 'month,provider' });
  if (error) throw new Error(`membership_monthly_payers upsert: ${error.message}`);
}

// Months from 2026-01 to the current month (UTC), as 'yyyy-MM'.
export function monthsSinceJan2026(): string[] {
  const out: string[] = [];
  const now = new Date();
  const endAbs = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (let abs = 2026 * 12; abs <= endAbs; abs++) {
    out.push(`${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}
