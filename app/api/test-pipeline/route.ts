import { NextRequest, NextResponse } from 'next/server';
import { runShopifyQL } from '@/lib/shopify';
import { buildOrdersQuery, parseOrderRows } from '@/lib/queries/orders';
import { buildPaymentsQuery, parsePaymentRows } from '@/lib/queries/payments';
import { processDay } from '@/lib/business-rules';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Simple secret check — pass ?secret=YOUR_CRON_SECRET in the URL
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const errors: string[] = [];

  // Try yesterday first, fall back up to 7 days
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const d = subDays(new Date(), daysBack);
    const date = format(toZonedTime(d, tz), 'yyyy-MM-dd', { timeZone: tz });

    try {
      const [rawOrders, rawPayments] = await Promise.all([
        runShopifyQL(buildOrdersQuery(date)),
        runShopifyQL(buildPaymentsQuery(date)),
      ]);

      if (rawOrders.length === 0) {
        errors.push(`${date}: no order rows`);
        continue;
      }

      const orders = parseOrderRows(rawOrders);
      const payments = parsePaymentRows(rawPayments);
      const result = processDay(orders, payments, date);

      return NextResponse.json({
        ok: true,
        date,
        daysBack,
        meta: {
          rawOrderRows: rawOrders.length,
          rawPaymentRows: rawPayments.length,
          parsedOrders: orders.length,
          parsedPayments: payments.length,
        },
        result,
      }, { status: 200 });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${date}: ${msg}`);
    }
  }

  return NextResponse.json({ ok: false, errors }, { status: 500 });
}
