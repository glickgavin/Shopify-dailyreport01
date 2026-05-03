import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '../lib/queries/orders';
import { processDay } from '../lib/business-rules';
import { saveDay } from '../lib/persistence';
import { postDailySummary } from '../lib/slack';
import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

  const dateArg = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1];
  const date = dateArg ?? format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  console.log(`[run-daily] Date: ${date}`);

  console.log(`[run-daily] Fetching orders…`);
  const { orderRows, paymentRows } = await fetchOrdersForDate(date);
  console.log(`[run-daily] ${orderRows.length} order rows, ${paymentRows.length} payment rows`);

  if (orderRows.length === 0) {
    console.warn('[run-daily] No orders found — nothing to save');
    return;
  }

  const processed = processDay(orderRows, paymentRows, date);
  console.log(`[run-daily] Revenue: ${processed.total.revenue.toFixed(2)}, Orders: ${processed.total.orders}`);

  console.log(`[run-daily] Saving to Supabase…`);
  await saveDay(processed, orderRows, paymentRows);
  console.log(`[run-daily] Saved`);

  // Fetch previous day for delta comparison
  const prevDate = format(
    toZonedTime(subDays(new Date(`${date}T12:00:00Z`), 1), tz),
    'yyyy-MM-dd',
    { timeZone: tz },
  );
  const { data: prevSummary } = await supabaseAdmin
    .from('daily_summary')
    .select('total_revenue, total_orders, total_net_sales')
    .eq('date', prevDate)
    .single();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
  const dashboardUrl = `${appUrl}/dashboard/${date}`;

  console.log(`[run-daily] Posting Slack (DRY_RUN=${process.env.DRY_RUN ?? 'false'})…`);
  await postDailySummary(processed, dashboardUrl, prevSummary ?? null);
  console.log(`[run-daily] Done`);
}

main().catch((err) => { console.error(err); process.exit(1); });
