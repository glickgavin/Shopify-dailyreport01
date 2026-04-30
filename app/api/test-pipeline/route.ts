import { NextRequest, NextResponse } from 'next/server';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const errors: string[] = [];

  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const d = subDays(new Date(), daysBack);
    const date = format(toZonedTime(d, tz), 'yyyy-MM-dd', { timeZone: tz });

    try {
      const { orderRows, paymentRows } = await fetchOrdersForDate(date);

      if (orderRows.length === 0) {
        errors.push(`${date}: no orders found`);
        continue;
      }

      const result = processDay(orderRows, paymentRows, date);
      await saveDay(result, orderRows, paymentRows);

      return NextResponse.json({
        ok: true,
        date,
        daysBack,
        saved: true,
        meta: {
          orderLineRows: orderRows.length,
          paymentRows: paymentRows.length,
          uniqueOrders: paymentRows.length,
        },
        result,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${date}: ${msg}`);
    }
  }

  return NextResponse.json({ ok: false, errors }, { status: 500 });
}
