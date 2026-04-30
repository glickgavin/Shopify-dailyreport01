import { toZonedTime, format, getTimezoneOffset } from 'date-fns-tz';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { shopifyGraphQL } from '@/lib/shopify';

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

export interface PaymentRow {
  order_name: string;
  payment_gateway: string;
  net_payments: number;
}

const ORDERS_QUERY = `
  query GetOrders($filter: String!, $cursor: String) {
    orders(first: 250, query: $filter, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        createdAt
        paymentGatewayNames
        totalPriceSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        lineItems(first: 100) {
          nodes {
            title
            variantTitle
            quantity
            discountedUnitPriceSet { shopMoney { amount } }
            variant {
              inventoryItem {
                unitCost { amount }
              }
            }
          }
        }
      }
    }
  }
`;

interface GQLOrder {
  name: string;
  createdAt: string;
  paymentGatewayNames: string[];
  totalPriceSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  totalShippingPriceSet: { shopMoney: { amount: string } };
  lineItems: {
    nodes: {
      title: string;
      variantTitle: string | null;
      quantity: number;
      discountedUnitPriceSet: { shopMoney: { amount: string } };
      variant: { inventoryItem: { unitCost: { amount: string } | null } } | null;
    }[];
  };
}

interface GQLResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GQLOrder[];
  };
}

function isoRange(date: string, tz: string): { start: string; end: string } {
  // getTimezoneOffset returns ms to ADD to UTC to get local (e.g. -25200000 for UTC-7)
  // so negative = west of UTC → '-07:00', positive = east → '+05:30'
  const offsetMs = getTimezoneOffset(tz, new Date(`${date}T12:00:00Z`));
  const sign = offsetMs >= 0 ? '+' : '-';
  const absHrs = Math.abs(offsetMs) / 3600000;
  const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
  const tzStr = `${sign}${pad(absHrs)}:${pad((absHrs % 1) * 60)}`;
  return {
    start: `${date}T00:00:00${tzStr}`,
    end: `${date}T23:59:59${tzStr}`,
  };
}

export async function fetchOrdersForDate(date?: string): Promise<{ orderRows: OrderRow[]; paymentRows: PaymentRow[] }> {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const d = date ?? format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
  const { start, end } = isoRange(d, tz);
  const filter = `created_at:>='${start}' created_at:<='${end}' financial_status:paid`;

  const allOrders: GQLOrder[] = [];
  let cursor: string | null = null;

  while (true) {
    const data: GQLResponse = await shopifyGraphQL<GQLResponse>(ORDERS_QUERY, { filter, cursor });
    allOrders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  const orderRows: OrderRow[] = [];
  const paymentRows: PaymentRow[] = [];

  for (const order of allOrders) {
    const orderDate = toZonedTime(new Date(order.createdAt), tz);
    const hour = format(orderDate, "yyyy-MM-dd'T'HH:00:00", { timeZone: tz });

    const totalNet = parseFloat(order.totalPriceSet.shopMoney.amount) || 0;
    const totalRefunded = parseFloat(order.totalRefundedSet.shopMoney.amount) || 0;
    const netPayment = totalNet - totalRefunded;
    const shipping = parseFloat(order.totalShippingPriceSet.shopMoney.amount) || 0;

    // Payment row — primary gateway is the one with highest value (use first non-store-credit if multiple)
    const gateways = order.paymentGatewayNames;
    const primaryGateway = gateways.includes('shopify_store_credit') && gateways.length > 1
      ? gateways.find((g) => g !== 'shopify_store_credit') ?? gateways[0]
      : gateways[0] ?? 'unknown';

    paymentRows.push({
      order_name: order.name,
      payment_gateway: primaryGateway,
      net_payments: netPayment,
    });

    // Prorate shipping across line items by revenue share
    const lineItems = order.lineItems.nodes;
    const totalLineRevenue = lineItems.reduce(
      (sum, li) => sum + (parseFloat(li.discountedUnitPriceSet.shopMoney.amount) || 0) * li.quantity,
      0,
    );

    for (const li of lineItems) {
      const lineRevenue = (parseFloat(li.discountedUnitPriceSet.shopMoney.amount) || 0) * li.quantity;
      const revenueShare = totalLineRevenue > 0 ? lineRevenue / totalLineRevenue : 1 / lineItems.length;
      const lineShipping = shipping * revenueShare;
      const unitCost = parseFloat(li.variant?.inventoryItem?.unitCost?.amount ?? '0') || 0;
      const cogs = unitCost * li.quantity;

      orderRows.push({
        hour,
        product_title_at_time_of_sale: li.title,
        product_title: li.title,
        product_variant_title: li.variantTitle ?? '',
        order_name: order.name,
        net_sales: lineRevenue,
        shipping_charges: lineShipping,
        cost_of_goods_sold: cogs,
        quantity_ordered: li.quantity,
      });
    }
  }

  return { orderRows, paymentRows };
}
