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
  /**
   * Sales channel for the order, derived from Shopify's `sourceName`.
   * `null` = direct Shopify (web). `'amazon'` = Codisto Amazon (or any
   * other connector that reports sourceName="amazon"). When adding more
   * channels (walmart, ebay, tiktok, etc.) extend this union and update
   * the classifier in business-rules.ts.
   */
  channel: 'amazon' | null;
  /**
   * Discount attribution for the order (order-level, duplicated onto each
   * line row). Derived from discountApplications, ignoring shipping-only
   * discounts (targetType SHIPPING_LINE): discount codes when present, else
   * automatic/manual/script discount titles (e.g. "VIP-OFF").
   * Empty array = no product-level discount on the order.
   */
  discount_codes: string[];
}

export interface PaymentRow {
  order_name: string;
  payment_gateway: string;
  net_payments: number;
}

/**
 * One row per qualifying VIP Membership line item extracted from a paid order.
 * A line qualifies when title matches /VIP Membership/i AND net_amount > 0.
 * is_intro = true when net_amount < $20 (intro price is $9.99; recurring is $39.99).
 */
export interface MembershipBillingRow {
  shopify_order_id: string;
  line_index:       number;
  customer_id:      string;
  charged_at:       string;
  net_amount:       number;
  currency:         string;
  is_intro:         boolean;
  raw:              Record<string, unknown>;
}

const ORDERS_QUERY = `
  query GetOrders($filter: String!, $cursor: String) {
    orders(first: 250, query: $filter, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        createdAt
        sourceName
        discountCodes
        discountApplications(first: 10) {
          nodes {
            __typename
            targetType
            ... on DiscountCodeApplication { code }
            ... on AutomaticDiscountApplication { title }
            ... on ManualDiscountApplication { title }
            ... on ScriptDiscountApplication { title }
          }
        }
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
  sourceName: string | null;
  discountCodes: string[];
  discountApplications: {
    nodes: {
      __typename: string;
      targetType: string | null;
      code?: string;
      title?: string;
    }[];
  };
  customer: { id: string; numberOfOrders: string | number } | null;
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

export async function fetchOrdersForDate(date?: string): Promise<{ orderRows: OrderRow[]; paymentRows: PaymentRow[]; membershipBillingRows: MembershipBillingRow[] }> {
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
  const membershipBillingRows: MembershipBillingRow[] = [];

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
      numberOfOrders: Number(order.customer.numberOfOrders),
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

    // Derive channel from Shopify's sourceName. Only 'amazon' is mapped today
    // (matches Codisto Marketplace Connect orders). Direct Shopify orders have
    // sourceName 'web' / 'shopify_draft_order' / etc. → channel stays null.
    const channel: OrderRow['channel'] = order.sourceName === 'amazon' ? 'amazon' : null;

    // Discount attribution: ignore shipping-only discounts; prefer codes,
    // else automatic/manual/script discount titles.
    const apps = (order.discountApplications?.nodes ?? []).filter(a => a.targetType !== 'SHIPPING_LINE');
    const codeApps  = apps.filter(a => a.__typename === 'DiscountCodeApplication' && a.code);
    const titleApps = apps.filter(a => a.__typename !== 'DiscountCodeApplication' && a.title);
    const attribution = codeApps.length > 0
      ? Array.from(new Set(codeApps.map(a => a.code!)))
      : Array.from(new Set(titleApps.map(a => a.title!)));

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
        channel,
        discount_codes: attribution,
      });

      // Membership billing event — title must match /VIP Membership/i, net > 0,
      // and order must have a customer (Simplee always creates a customer record).
      if (/vip membership/i.test(li.title) && lineRevenue > 0 && order.customer) {
        const grossAmount = parseFloat(li.originalTotalSet.shopMoney.amount) || 0;
        membershipBillingRows.push({
          shopify_order_id: order.name,
          line_index:       i,
          customer_id:      order.customer.id,
          charged_at:       order.createdAt,
          net_amount:       lineRevenue,
          currency:         'USD',
          // intro price is $9.99; recurring is $39.99 — threshold of $20 handles both
          is_intro:         lineRevenue < 20.00,
          raw: {
            order_name:       order.name,
            line_title:       li.title,
            line_variant:     li.variantTitle ?? null,
            gross_amount:     grossAmount,
            discount:         Math.round((grossAmount - lineRevenue) * 100) / 100,
            customer_orders:  Number(order.customer.numberOfOrders),
          },
        });
      }
    }
  }

  return { orderRows, paymentRows, membershipBillingRows };
}
