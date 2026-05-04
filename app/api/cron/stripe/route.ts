import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchAndStoreStripeSnapshot } from '@/lib/stripe-snapshot';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'Asia/Jerusalem';
  const dateParam = req.nextUrl.searchParams.get('date');
  const targetDate = dateParam ?? format(
    toZonedTime(subDays(new Date(), 1), tz),
    'yyyy-MM-dd',
    { timeZone: tz },
  );

  try {
    const result = await fetchAndStoreStripeSnapshot(targetDate, tz);
    const s = result.summary;
    return NextResponse.json({
      status: 'ok',
      date: targetDate,
      timezone: tz,
      summary: {
        successful_charges: s.direct_success_count,
        successful_total_usd: (s.direct_success_total_cents / 100).toFixed(2),
        unique_customers: s.direct_success_unique_customers,
        refunds: s.refunds_count,
        refunds_total_usd: (s.refunds_total_cents / 100).toFixed(2),
        failed_charges: s.failed_count,
        failed_total_usd: (s.failed_total_cents / 100).toFixed(2),
        shopify_filtered: s.shopify_filtered_count,
        top_failure_reasons: s.top_failure_reasons,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, date: targetDate }, { status: 500 });
  }
}
