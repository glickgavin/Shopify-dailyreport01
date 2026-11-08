import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Actual cash received (bank payouts), by provider:
//   stripe  — Payouts API, arrival-dated, net of fees.
//   paypal  — T04xx bank-withdrawal transactions already stored inside the
//             paypal_daily_snapshot payloads (no extra API calls).
//   shopify — Shopify Payments payouts via GraphQL; needs the
//             read_shopify_payments scope — skipped gracefully if absent.
// Idempotent: every row upserts on the provider's payout/transaction id.
// ?since=yyyy-MM-dd widens the window (default 35 days; first run should be
// called once with since=2026-01-01 to backfill).

const DEFAULT_LOOKBACK_DAYS = 35;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

type PayoutRow = { provider: string; payout_id: string; payout_date: string; amount_cents: number; status: string | null };

async function upsertRows(rows: PayoutRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabaseAdmin as any)
      .from('payouts_daily')
      .upsert(rows.slice(i, i + 500), { onConflict: 'payout_id' });
    if (error) throw new Error(`payouts upsert: ${error.message}`);
  }
}

// ── stripe ────────────────────────────────────────────────────────────────────

async function syncStripe(sinceEpoch: number): Promise<number> {
  const rows: PayoutRow[] = [];
  for await (const p of stripe.payouts.list({ arrival_date: { gte: sinceEpoch }, limit: 100 }) as Stripe.ApiListPromise<Stripe.Payout>) {
    rows.push({
      provider: 'stripe',
      payout_id: p.id,
      payout_date: new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
      amount_cents: p.amount, // already net of Stripe fees
      status: p.status,
    });
  }
  await upsertRows(rows);
  return rows.length;
}

// ── paypal (from stored snapshots) ────────────────────────────────────────────

async function syncPayPal(sinceDate: string): Promise<number> {
  const rows: PayoutRow[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await (supabaseAdmin as any)
      .from('paypal_daily_snapshot')
      .select('date,payload')
      .gte('date', sinceDate)
      .order('date', { ascending: true })
      .range(from, from + 199);
    if (error) throw new Error(`paypal snapshots: ${error.message}`);
    const snaps = (data ?? []) as { date: string; payload: unknown }[];
    for (const snap of snaps) {
      const transfers = (snap.payload as { excluded_internal_transfers?: Array<Record<string, unknown>> })?.excluded_internal_transfers ?? [];
      for (const t of transfers) {
        const code = String(t.transaction_event_code ?? '');
        // T04xx = withdrawals to bank. Stored as negative gross; record the
        // outgoing amount as positive cash received at the bank.
        if (!code.startsWith('T04')) continue;
        const gross = Number(t.gross_cents ?? 0);
        if (gross >= 0) continue; // reversals/returns of withdrawals excluded
        rows.push({
          provider: 'paypal',
          payout_id: `pp_${String(t.id ?? `${snap.date}|${gross}`)}`,
          payout_date: snap.date,
          amount_cents: Math.abs(gross),
          status: 'paid',
        });
      }
    }
    if (snaps.length < 200) break;
  }
  await upsertRows(rows);
  return rows.length;
}

// ── shopify ───────────────────────────────────────────────────────────────────

interface ShopifyPayoutsResp {
  shopifyPaymentsAccount: {
    payouts: {
      edges: { node: { id: string; issuedAt: string; status: string; net: { amount: string } } }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

async function syncShopify(sinceDate: string): Promise<{ count: number; skipped?: string }> {
  const rows: PayoutRow[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 20; page++) {
      const res: ShopifyPayoutsResp = await shopifyGraphQL<ShopifyPayoutsResp>(
        `query Payouts($after: String) {
          shopifyPaymentsAccount {
            payouts(first: 100, after: $after, reverse: true) {
              edges { node { id issuedAt status net { amount } } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { after: cursor },
      );
      const acct = res.shopifyPaymentsAccount;
      if (!acct) return { count: 0, skipped: 'shopifyPaymentsAccount unavailable' };
      let reachedOld = false;
      for (const e of acct.payouts.edges) {
        const date = e.node.issuedAt.slice(0, 10);
        if (date < sinceDate) { reachedOld = true; continue; }
        rows.push({
          provider: 'shopify',
          payout_id: e.node.id,
          payout_date: date,
          amount_cents: Math.round(parseFloat(e.node.net.amount) * 100) || 0,
          status: e.node.status?.toLowerCase() ?? null,
        });
      }
      if (reachedOld || !acct.payouts.pageInfo.hasNextPage) break;
      cursor = acct.payouts.pageInfo.endCursor;
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (/access denied|access scope/i.test(msg)) {
      // Surface Shopify's own message — it names the exact scopes required.
      return { count: 0, skipped: msg.slice(0, 300) };
    }
    throw err;
  }
  await upsertRows(rows);
  return { count: rows.length };
}

// ── route ─────────────────────────────────────────────────────────────────────

async function run(req: NextRequest): Promise<NextResponse> {
  const sinceParam = req.nextUrl.searchParams.get('since');
  // First run (empty table) backfills from Jan 2026 automatically.
  const { count: existing } = await (supabaseAdmin as any)
    .from('payouts_daily')
    .select('id', { count: 'exact', head: true });
  const since = sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : (existing ?? 0) === 0
      ? '2026-01-01'
      : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const sinceEpoch = Math.floor(new Date(`${since}T00:00:00Z`).getTime() / 1000);

  const results: Record<string, unknown> = { since };
  try { results.stripe = await syncStripe(sinceEpoch); } catch (e) { results.stripe_error = (e as Error).message; }
  try { results.paypal = await syncPayPal(since); } catch (e) { results.paypal_error = (e as Error).message; }
  try {
    // Shopify backfills from Jan the first time it has access (scope added later).
    const { count: shopifyExisting } = await (supabaseAdmin as any)
      .from('payouts_daily')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'shopify');
    const shopifySince = (shopifyExisting ?? 0) === 0 ? '2026-01-01' : since;
    const sh = await syncShopify(shopifySince);
    results.shopify = sh.count;
    if (sh.skipped) results.shopify_skipped = sh.skipped;
  } catch (e) { results.shopify_error = (e as Error).message; }

  console.log('[payouts-sync]', JSON.stringify(results));
  return NextResponse.json({ status: 'ok', ...results });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
