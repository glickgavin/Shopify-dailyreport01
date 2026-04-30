import { toZonedTime, format } from 'date-fns-tz';
import { subDays } from 'date-fns';

export interface OrderRow {
  hour: string;
  product_title_at_time_of_sale: string;
  product_title: string;
  product_variant_title: string;
  order_name: string;
  net_sales: number;
  shipping_charges: number;
  cost_of_goods_sold: number;
  quantity_ordered: number;
}

function yesterdayLabel(tz: string): string {
  const yesterday = subDays(new Date(), 1);
  const zoned = toZonedTime(yesterday, tz);
  return format(zoned, 'yyyy-MM-dd', { timeZone: tz });
}

export function buildOrdersQuery(date?: string): string {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const d = date ?? yesterdayLabel(tz);
  return `
FROM sales
  SHOW net_sales, shipping_charges, cost_of_goods_sold, quantity_ordered
  GROUP BY hour, product_title_at_time_of_sale, product_title,
    product_variant_title, order_name WITH TOTALS
  TIMESERIES hour
  DURING ${d}
  ORDER BY hour ASC
  LIMIT 5000
`.trim();
}

export function parseOrderRows(raw: Record<string, string>[]): OrderRow[] {
  return raw
    .filter((r) => r['order_name'] && r['order_name'] !== 'Total')
    .map((r) => ({
      hour: r['hour'] ?? '',
      product_title_at_time_of_sale: r['product_title_at_time_of_sale'] ?? '',
      product_title: r['product_title'] ?? '',
      product_variant_title: r['product_variant_title'] ?? '',
      order_name: r['order_name'],
      net_sales: parseFloat(r['net_sales'] ?? '0') || 0,
      shipping_charges: parseFloat(r['shipping_charges'] ?? '0') || 0,
      cost_of_goods_sold: parseFloat(r['cost_of_goods_sold'] ?? '0') || 0,
      quantity_ordered: parseInt(r['quantity_ordered'] ?? '0', 10) || 0,
    }));
}
