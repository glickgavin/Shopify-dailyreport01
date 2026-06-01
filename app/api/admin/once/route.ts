import { NextRequest, NextResponse } from 'next/server';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { fetchAndStorePayPalSnapshot } from '@/lib/paypal-snapshot';

export const runtime = 'nodejs';
export const maxDuration = 300;

// One-shot backfill endpoint — self-destructs after use.
// Key is rotated on every deploy; remove this file when done.
const ONE_TIME_KEY = 'rerun-2026-05-31-g7k2p9x1';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== ONE_TIME_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dates = ['2026-05-29', '2026-05-30'];
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const results: Record<string, unknown> = {};

  for (const date of dates) {
    try {
      const { orderRows, paymentRows } = await fetchOrdersForDate(date); // membershipBillingRows handled by pipeline
      const processed = processDay(orderRows, paymentRows, date);
      await saveDay(processed, orderRows, paymentRows);
      results[date] = {
        orders: processed.total.orders,
        revenue: processed.total.revenue,
        amazon_orders: processed.amazon.orders,
      };
    } catch (e) {
      results[date] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // PayPal for May 30 only
  try {
    const pp = await fetchAndStorePayPalSnapshot('2026-05-30', tz);
    results['paypal_2026-05-30'] = {
      transactions: pp.summary.direct_success_count,
      total_usd: (pp.summary.direct_success_total_cents / 100).toFixed(2),
    };
  } catch (e) {
    results['paypal_2026-05-30'] = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ status: 'ok', results });
}
