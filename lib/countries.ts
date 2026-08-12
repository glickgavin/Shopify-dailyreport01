import { supabaseAdmin } from '@/lib/supabase';
import type { OrderRow } from '@/lib/queries/orders';
import { PRIMARY_PRODUCT_RE } from '@/lib/discounts';

// ── Daily country-of-purchase rollup ─────────────────────────────────────────
// Computes daily_countries rows from the same line-level OrderRows the rest of
// the pipeline uses (same PT days and net-sales rules, so figures tie out with
// the dashboard). One row per country plus a blended row:
//   country: 'ALL' (blended) | '' (no address on order) | ISO alpha-2 code
//
// Per row (exact, computed from distinct order sets — no double counting):
//   orders        = distinct orders shipped/billed to the country
//   units         = total line quantity on those orders
//   units_primary = Magic Portrait line quantity only (consistent with the
//                   Discounts section's Units column)
//   net_sales     = net sales of the country's lines
//   order_value   = full order value (net sales + shipping) summed over the
//                   distinct orders → AOV = order_value / orders

export interface DailyCountryRow {
  date: string;
  country: string;
  orders: number;
  units: number;
  units_primary: number;
  net_sales: number;
  order_value: number;
}

interface Cell {
  orderSet: Set<string>;
  units: number;
  unitsPrimary: number;
  netSales: number;
}

export function computeDailyCountryRows(orderRows: OrderRow[], date: string): DailyCountryRow[] {
  const orderValue = new Map<string, number>();
  for (const r of orderRows) {
    orderValue.set(r.order_name, (orderValue.get(r.order_name) ?? 0) + r.net_sales + r.shipping_charges);
  }

  const cells = new Map<string, Cell>();
  const bump = (country: string, r: OrderRow) => {
    let c = cells.get(country);
    if (!c) { c = { orderSet: new Set(), units: 0, unitsPrimary: 0, netSales: 0 }; cells.set(country, c); }
    c.orderSet.add(r.order_name);
    c.units += r.quantity_ordered;
    if (PRIMARY_PRODUCT_RE.test(r.product_title)) c.unitsPrimary += r.quantity_ordered;
    c.netSales += r.net_sales;
  };

  for (const r of orderRows) {
    bump('ALL', r);
    bump(r.country ?? '', r);
  }

  const rows: DailyCountryRow[] = [];
  cells.forEach((c, country) => {
    let value = 0;
    c.orderSet.forEach(o => { value += orderValue.get(o) ?? 0; });
    rows.push({
      date,
      country,
      orders: c.orderSet.size,
      units: c.units,
      units_primary: c.unitsPrimary,
      net_sales: Math.round(c.netSales * 100) / 100,
      order_value: Math.round(value * 100) / 100,
    });
  });
  return rows;
}

/** Delete-then-insert the day's rows (idempotent — safe on pipeline re-runs). */
export async function saveDailyCountries(date: string, rows: DailyCountryRow[]): Promise<void> {
  const admin = supabaseAdmin as any;
  const { error: delErr } = await admin.from('daily_countries').delete().eq('date', date);
  if (delErr) throw new Error(`daily_countries delete: ${delErr.message}`);
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('daily_countries').insert(rows.slice(i, i + 500));
    if (error) throw new Error(`daily_countries insert: ${error.message}`);
  }
}
