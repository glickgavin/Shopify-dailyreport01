import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';

async function main() {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const date = format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  console.log(`\nVerifying Supabase data for: ${date}\n`);

  // daily_summary
  const { data: summary, error: e1 } = await supabaseAdmin
    .from('daily_summary')
    .select('*')
    .eq('date', date)
    .single();

  if (e1 || !summary) {
    console.error('daily_summary: NOT FOUND', e1?.message);
  } else {
    console.log('── daily_summary ─────────────────────────────────────────');
    console.log(`  date:          ${summary.date}`);
    console.log(`  total_revenue: $${Number(summary.total_revenue).toFixed(2)}`);
    console.log(`  total_orders:  ${summary.total_orders}`);
    console.log(`  total_qty:     ${summary.total_qty}`);
    console.log(`  total_aov:     $${Number(summary.total_aov).toFixed(2)}`);
    console.log(`  phys_cash_orders:     ${summary.phys_cash_orders}`);
    console.log(`  phys_non_cash_orders: ${summary.phys_non_cash_orders}`);
    console.log(`  mem_orders:           ${summary.mem_orders}`);
    console.log(`  updated_at:    ${summary.updated_at}`);
  }

  // daily_products
  const { data: products, error: e2 } = await supabaseAdmin
    .from('daily_products')
    .select('title, variant, item_type, qty, orders, net_sales, revenue')
    .eq('date', date)
    .order('revenue', { ascending: false });

  if (e2) {
    console.error('\ndaily_products: ERROR', e2.message);
  } else {
    console.log(`\n── daily_products (${products?.length ?? 0} rows) ────────────────────────`);
    products?.forEach((p) => {
      const label = p.variant ? `${p.title} / ${p.variant}` : p.title;
      console.log(`  ${label.padEnd(40)} qty=${p.qty}  orders=${p.orders}  net=$${Number(p.net_sales).toFixed(2)}`);
    });
  }

  // daily_membership_orders
  const { data: memOrders, error: e3 } = await supabaseAdmin
    .from('daily_membership_orders')
    .select('order_name, membership_type, net_sales, revenue')
    .eq('date', date)
    .order('order_name');

  if (e3) {
    console.error('\ndaily_membership_orders: ERROR', e3.message);
  } else {
    console.log(`\n── daily_membership_orders (${memOrders?.length ?? 0} rows) ──────────────`);
    memOrders?.forEach((m) => {
      console.log(`  ${m.order_name}  ${m.membership_type.padEnd(10)}  net=$${Number(m.net_sales).toFixed(2)}`);
    });
  }

  // raw_data
  const { data: raw, error: e4 } = await supabaseAdmin
    .from('raw_data')
    .select('id, fetched_at')
    .eq('date', date)
    .order('fetched_at', { ascending: false })
    .limit(3);

  if (e4) {
    console.error('\nraw_data: ERROR', e4.message);
  } else {
    console.log(`\n── raw_data (latest entries for ${date}) ─────────────────`);
    raw?.forEach((r) => console.log(`  id=${r.id}  fetched_at=${r.fetched_at}`));
  }

  console.log('\n✓ Verification complete');
}

main().catch((err) => { console.error(err); process.exit(1); });
