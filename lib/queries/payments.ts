import { toZonedTime, format } from 'date-fns-tz';
import { subDays } from 'date-fns';

export interface PaymentRow {
  order_name: string;
  payment_gateway: string;
  transactions: number;
  gross_payments: number;
  refunded_payments: number;
  net_payments: number;
}

function yesterdayLabel(tz: string): string {
  const yesterday = subDays(new Date(), 1);
  const zoned = toZonedTime(yesterday, tz);
  return format(zoned, 'yyyy-MM-dd', { timeZone: tz });
}

export function buildPaymentsQuery(date?: string): string {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const d = date ?? yesterdayLabel(tz);
  return `
FROM payments
  SHOW transactions, gross_payments, refunded_payments, net_payments
  WHERE transaction_kind IN ('sale', 'change', 'capture', 'refund')
  GROUP BY order_name, payment_gateway WITH GROUP_TOTALS, TOTALS
  DURING ${d}
  ORDER BY net_payments__order_name_totals DESC, net_payments DESC,
    order_name ASC, payment_gateway ASC
  LIMIT 5000
`.trim();
}

export function parsePaymentRows(raw: Record<string, string>[]): PaymentRow[] {
  return raw
    .filter((r) => r['order_name'] && !r['order_name'].includes('Total') && r['payment_gateway'])
    .map((r) => ({
      order_name: r['order_name'],
      payment_gateway: r['payment_gateway'] ?? '',
      transactions: parseInt(r['transactions'] ?? '0', 10) || 0,
      gross_payments: parseFloat(r['gross_payments'] ?? '0') || 0,
      refunded_payments: parseFloat(r['refunded_payments'] ?? '0') || 0,
      net_payments: parseFloat(r['net_payments'] ?? '0') || 0,
    }));
}
