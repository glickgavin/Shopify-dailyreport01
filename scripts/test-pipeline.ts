import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { fetchOrdersForDate } from '../lib/queries/orders';
import { processDay } from '../lib/business-rules';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

async function main() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const d = subDays(new Date(), daysBack);
    const date = format(toZonedTime(d, tz), 'yyyy-MM-dd', { timeZone: tz });

    console.log(`\nTrying date: ${date}`);

    const { orderRows, paymentRows } = await fetchOrdersForDate(date);

    console.log(`  Order line rows:   ${orderRows.length}`);
    console.log(`  Payment rows:      ${paymentRows.length}`);

    if (orderRows.length === 0) {
      console.log('  No data — trying previous day…');
      continue;
    }

    const result = processDay(orderRows, paymentRows, date);
    console.log('\n── ProcessedDay ─────────────────────────────────────────');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error('No data found in the last 7 days');
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
