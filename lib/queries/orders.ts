import { toZonedTime, format, getTimezoneOffset } from 'date-fns-tz';
import { subDays } from 'date-fns';
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
  customer_type: 'new' | 'returning';
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
        customer { id numberOfOrders }
        paymentGatewayNames
        totalPriceSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } }
        shippingLines(first: 10) {
          nodes {
            discountedPriceSet { shopMoney { amount } }
          }
        }
        lineItems(first: 100) {
          nodes {
            title
            variantTitle
            quantity
            originalTotalSet { shopMoney { amount } }
            discountAllocations {
              allocatedAmountSet { shopMoney { amount } }
            }
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
  customer: { id: string; numberOfOrders: number } | null;
  paymentGatewayNames: string[];
  totalPriceSet: { shopMoney: { amount: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  shippingLines: {
    nodes: {
      discountedPriceSet: { shopMoney: { amount: string } };
    }[];
  };
  lineItems: {
    nodes: {
      title: string;
      variantTitle: string | null;
      quantity: number;
      originalTotalSet: { shopMoney: { amount: string } };
      discountAllocations: { allocatedAmountSet: { shopMoney: { amount: string } } }[];
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

  // Compute customer_type per order_name
  const orderCustomerType = new Map<string, 'new' | 'returning'>();
  const customerOrdersMap = new Map<string, { orderName: string; createdAt: string; numberOfOrders: number }[]>();

  for (const order of allOrders) {
    if (!order.customer) {
      orderCustomerType.set(order.name, 'new');
      continue;
    }
    const cid = order.customer.id;
    if (!customerOrdersMap.has(cid)) customerOrdersMap.set(cid, []);
    customerOrdersMap.get(cid)!.push({
      orderName: order.name,
      createdAt: order.createdAt,
      numberOfOrders: order.customer.numberOfOrders,
    });
  }

  customerOrdersMap.forEach((customerOrders) => {
    customerOrders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const numberOfOrders = customerOrders[0].numberOfOrders;
    if (numberOfOrders === customerOrders.length) {
      // All lifetime orders happened today → first is 'new', rest 'returning'
      orderCustomerType.set(customerOrders[0].orderName, 'new');
      for (let i = 1; i < customerOrders.length; i++) {
        orderCustomerType.set(customerOrders[i].orderName, 'returning');
      }
    } else {
      for (const co of customerOrders) orderCustomerType.set(co.orderName, 'returning');
    }
  });

  for (const order of allOrders) {
    const orderDate = toZonedTime(new Date(order.createdAt), tz);
    const hour = format(orderDate, "yyyy-MM-dd'T'HH:00:00", { timeZone: tz });

    const totalNet = parseFloat(order.totalPriceSet.shopMoney.amount) || 0;
    const totalRefunded = parseFloat(order.totalRefundedSet.shopMoney.amount) || 0;
    const netPayment = totalNet - totalRefunded;

    // True net shipping after any shipping discounts
    const shipping = order.shippingLines.nodes.reduce(
      (sum, sl) => sum + (parseFloat(sl.discountedPriceSet.shopMoney.amount) || 0),
      0,
    );

    // Payment row — skip store credit when a real gateway is also present
    const gateways = order.paymentGatewayNames;
    const primaryGateway = gateways.includes('shopify_store_credit') && gateways.length > 1
      ? gateways.find((g) => g !== 'shopify_store_credit') ?? gateways[0]
      : gateways[0] ?? 'unknown';

    paymentRows.push({
      order_name: order.name,
      payment_gateway: primaryGateway,
      net_payments: netPayment,
    });

    // True net per line = gross - all discount allocations (line-level + order-level)
    const lineItems = order.lineItems.nodes;
    const lineRevenues = lineItems.map((li) => {
      const gross = parseFloat(li.originalTotalSet.shopMoney.amount) || 0;
      const totalDiscount = li.discountAllocations.reduce(
        (sum, da) => sum + (parseFloat(da.allocatedAmountSet.shopMoney.amount) || 0),
        0,
      );
      return Math.max(0, gross - totalDiscount);
    });

    const totalLineRevenue = lineRevenues.reduce((s, v) => s + v, 0);

    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      const lineRevenue = lineRevenues[i];
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
        customer_type: orderCustomerType.get(order.name) ?? 'new',
      });
    }
  }

  return { orderRows, paymentRows };
}
