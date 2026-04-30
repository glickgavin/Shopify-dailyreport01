import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { runShopifyQL } from '../lib/shopify';
import { buildOrdersQuery, parseOrderRows } from '../lib/queries/orders';
import { buildPaymentsQuery, parsePaymentRows } from '../lib/queries/payments';
import { processDay } from '../lib/business-rules';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

async function main() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

  // Try yesterday first; if empty fall back up to 7 days
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const d = subDays(new Date(), daysBack);
    const date = format(toZonedTime(d, tz), 'yyyy-MM-dd', { timeZone: tz });

    console.log(`\nTrying date: ${date}`);

    const [rawOrders, rawPayments] = await Promise.all([
      runShopifyQL(buildOrdersQuery(date)),
      runShopifyQL(buildPaymentsQuery(date)),
    ]);

    console.log(`  Orders rows returned:   ${rawOrders.length}`);
    console.log(`  Payments rows returned: ${rawPayments.length}`);

    if (rawOrders.length === 0) {
      console.log('  No data — trying previous day…');
      continue;
    }

    const orders = parseOrderRows(rawOrders);
    const payments = parsePaymentRows(rawPayments);
    console.log(`  Parsed order lines:    ${orders.length}`);
    console.log(`  Parsed payment lines:  ${payments.length}`);

    const result = processDay(orders, payments, date);
    console.log('\n── ProcessedDay ─────────────────────────────────────────');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error('No data found in the last 7 days');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
