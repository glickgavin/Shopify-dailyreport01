import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchAndStoreStripeSnapshot } from '../lib/stripe-snapshot';

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set in .env.local');
    process.exit(1);
  }

  const tz = process.env.STORE_TIMEZONE ?? 'Asia/Jerusalem';
  const dateArg = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1];
  const targetDate = dateArg ?? format(
    toZonedTime(subDays(new Date(), 1), tz),
    'yyyy-MM-dd',
    { timeZone: tz },
  );

  console.log(`[stripe] Date (${tz}): ${targetDate}`);
  console.log(`[stripe] Fetching charges and refunds...`);

  const result = await fetchAndStoreStripeSnapshot(targetDate, tz);
  const s = result.summary;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  STRIPE SUMMARY — ${targetDate}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Successful direct charges (excl. Shopify):`);
  console.log(`    Count:            ${s.direct_success_count}`);
  console.log(`    Total:            $${(s.direct_success_total_cents / 100).toFixed(2)}`);
  console.log(`    Unique customers: ${s.direct_success_unique_customers}`);
  console.log('');
  console.log(`  Refunds (all sources):`);
  console.log(`    Count:            ${s.refunds_count}`);
  console.log(`    Total:            $${(s.refunds_total_cents / 100).toFixed(2)}`);
  console.log('');
  console.log(`  Failed direct charges:`);
  console.log(`    Count:            ${s.failed_count}`);
  console.log(`    Total attempted:  $${(s.failed_total_cents / 100).toFixed(2)}`);
  if (s.top_failure_reasons.length > 0) {
    console.log(`    Top reasons:`);
    for (const { reason, count } of s.top_failure_reasons) {
      console.log(`      [${count}x] ${reason}`);
    }
  }
  console.log('');
  console.log(`  Shopify-originated charges (filtered out): ${s.shopify_filtered_count}`);
  console.log('');

  const fmtUSD = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  if (result.direct_success_charges.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  SUCCESSFUL DIRECT CHARGES');
    console.log('───────────────────────────────────────────────────────────');
    for (const c of result.direct_success_charges.sort((a, b) => a.created - b.created)) {
      const time = new Date(c.created * 1000).toLocaleString('en-US', { timeZone: tz });
      console.log(`  ${time}  ${fmtUSD(c.amount).padStart(10)}  ${(c.email ?? '—').padEnd(32)}  ${c.description ?? ''}`);
    }
    console.log('');
  }

  if (result.failed_charges.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  FAILED DIRECT CHARGES');
    console.log('───────────────────────────────────────────────────────────');
    for (const c of result.failed_charges.sort((a, b) => a.created - b.created)) {
      const time = new Date(c.created * 1000).toLocaleString('en-US', { timeZone: tz });
      const reason = c.failure_message ?? c.failure_code ?? 'unknown';
      console.log(`  ${time}  ${fmtUSD(c.amount).padStart(10)}  ${(c.email ?? '—').padEnd(32)}  ${reason}`);
    }
    console.log('');
  }

  if (result.refunds.length > 0) {
    console.log('───────────────────────────────────────────────────────────');
    console.log('  REFUNDS');
    console.log('───────────────────────────────────────────────────────────');
    for (const r of result.refunds.sort((a, b) => a.created - b.created)) {
      const time = new Date(r.created * 1000).toLocaleString('en-US', { timeZone: tz });
      console.log(`  ${time}  ${fmtUSD(r.amount).padStart(10)}  ${r.reason ?? '—'}  charge=${r.charge_id ?? '—'}`);
    }
    console.log('');
  }

  console.log(`[stripe] Snapshot saved for ${targetDate}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
