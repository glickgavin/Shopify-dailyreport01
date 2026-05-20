import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchAndStorePayPalSnapshot } from '@/lib/paypal-snapshot';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const headerAuth = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const authorized = secret && (headerAuth === `Bearer ${secret}` || querySecret === secret);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return NextResponse.json({ error: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured' }, { status: 500 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'Asia/Jerusalem';
  const dateParam = req.nextUrl.searchParams.get('date');
  const targetDate = dateParam ?? format(
    toZonedTime(subDays(new Date(), 1), tz),
    'yyyy-MM-dd',
    { timeZone: tz },
  );

  try {
    const result = await fetchAndStorePayPalSnapshot(targetDate, tz);
    const s = result.summary;
    return NextResponse.json({
      status: 'ok',
      date: targetDate,
      timezone: tz,
      summary: {
        successful_transactions:  s.direct_success_count,
        successful_total_usd:     (s.direct_success_total_cents / 100).toFixed(2),
        unique_customers:          s.direct_success_unique_customers,
        refunds:                   s.refunds_count,
        refunds_total_usd:         (s.refunds_total_cents / 100).toFixed(2),
        denied:                    s.denied_count,
        shopify_filtered:          s.shopify_filtered_count,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, date: targetDate }, { status: 500 });
  }
}
