import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { parseISO, eachDayOfInterval, isValid } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '../lib/queries/orders';
import { processDay } from '../lib/business-rules';
import { saveDay } from '../lib/persistence';

type Result = { date: string; status: 'ok' | 'empty' | 'error'; message?: string };

async function main() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

  const startArg = process.argv.find((a) => a.startsWith('--start='))?.split('=')[1];
  const endArg = process.argv.find((a) => a.startsWith('--end='))?.split('=')[1];

  if (!startArg || !endArg) {
    console.error('Usage: npx ts-node scripts/backfill.ts --start=YYYY-MM-DD --end=YYYY-MM-DD');
    process.exit(1);
  }

  const start = parseISO(startArg);
  const end = parseISO(endArg);

  if (!isValid(start) || !isValid(end)) {
    console.error('Invalid date(s). Use YYYY-MM-DD format.');
    process.exit(1);
  }

  const days = eachDayOfInterval({ start, end });
  console.log(`Backfilling ${days.length} day(s): ${startArg} → ${endArg}\n`);

  const results: Result[] = [];

  for (const day of days) {
    const date = format(toZonedTime(day, tz), 'yyyy-MM-dd', { timeZone: tz });
    process.stdout.write(`  ${date} … `);

    try {
      const { orderRows, paymentRows } = await fetchOrdersForDate(date);

      if (orderRows.length === 0) {
        console.log('empty (no orders)');
        results.push({ date, status: 'empty' });
        continue;
      }

      const processed = processDay(orderRows, paymentRows, date);
      await saveDay(processed, orderRows, paymentRows);
      console.log(`ok  (${orderRows.length} rows · ${fmt(processed.total.revenue)} revenue · ${processed.total.orders} orders)`);
      results.push({ date, status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${message}`);
      results.push({ date, status: 'error', message });
    }

    // Avoid Shopify rate limits
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('\n── Summary ──────────────────────────────────────────────');
  const ok = results.filter((r) => r.status === 'ok').length;
  const empty = results.filter((r) => r.status === 'empty').length;
  const errors = results.filter((r) => r.status === 'error');
  console.log(`  OK:    ${ok}`);
  console.log(`  Empty: ${empty}`);
  console.log(`  Error: ${errors.length}`);
  if (errors.length) {
    errors.forEach((e) => console.log(`    ✗ ${e.date}: ${e.message}`));
    process.exit(1);
  }
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

main().catch((err) => { console.error(err); process.exit(1); });
