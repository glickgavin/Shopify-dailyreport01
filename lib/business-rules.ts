import type { OrderRow } from './queries/orders';
import type { PaymentRow } from './queries/payments';

export type ItemType = 'Membership' | 'Physical';
export type PayGroup = 'Cash' | 'Non-Cash';
export type MembershipType = 'new' | 'recurring';

export interface SummaryBlock {
  revenue: number;
  netSales: number;
  shipping: number;
  cogs: number;
  profit: number;
  margin: number;
  orders: number;
  qty: number;
  aov: number;
}

export interface ProductLine {
  title: string;
  variant: string;
  itemType: ItemType;
  netSales: number;
  shipping: number;
  cogs: number;
  revenue: number;
  qty: number;
  orders: number;
}

export interface MemberOrder {
  orderName: string;
  membershipType: MembershipType;
  netSales: number;
  shipping: number;
  revenue: number;
}

export interface ProcessedDay {
  date: string;
  total: SummaryBlock;
  physCash: SummaryBlock;
  physNonCash: SummaryBlock;
  membership: SummaryBlock;
  custNew: SummaryBlock;
  custReturning: SummaryBlock;
  cashNew: SummaryBlock;
  cashReturning: SummaryBlock;
  nonCashNew: SummaryBlock;
  nonCashReturning: SummaryBlock;
  internalNew: SummaryBlock;
  internalReturning: SummaryBlock;
  amazon: SummaryBlock;
  amazonNew: SummaryBlock;
  amazonReturning: SummaryBlock;
  products: ProductLine[];
  memOrders: MemberOrder[];
}

function itemType(title: string): ItemType {
  return /membership|vip/i.test(title) ? 'Membership' : 'Physical';
}

function payGroup(orderName: string, payments: PaymentRow[]): PayGroup {
  const orderPayments = payments.filter((p) => p.order_name === orderName);
  if (!orderPayments.length) return 'Cash';
  // pick gateway with highest net_payments
  const dominant = orderPayments.reduce((best, cur) =>
    cur.net_payments > best.net_payments ? cur : best
  );
  return dominant.payment_gateway === 'shopify_store_credit' ? 'Non-Cash' : 'Cash';
}

function emptyBlock(): SummaryBlock {
  return { revenue: 0, netSales: 0, shipping: 0, cogs: 0, profit: 0, margin: 0, orders: 0, qty: 0, aov: 0 };
}

function finalise(block: SummaryBlock, orderSet: Set<string>): SummaryBlock {
  block.orders = orderSet.size;
  block.profit = block.revenue - block.cogs;
  block.margin = block.revenue > 0 ? (block.profit / block.revenue) * 100 : 0;
  block.aov = block.orders > 0 ? block.revenue / block.orders : 0;
  return block;
}

export interface DerivedKPIs {
  cashIn: number;
  adCost: number;
  adPurchases: number;
  cpaAd: number | null;
  cpaBlended: number | null;
  dailyProfit: number;
}

export function computeDerivedKPIs(
  processed: ProcessedDay,
  adSpend: number | null,
  adPurchases: number | null,
  stripeDirectCents: number | null,
  stripeRefundCents: number | null,
  productOrders?: number,
): DerivedKPIs {
  const stripeRevenue = (stripeDirectCents ?? 0) / 100;
  const stripeRefunds = (stripeRefundCents ?? 0) / 100;

  let cashIn = processed.physCash.revenue + processed.membership.revenue + stripeRevenue - stripeRefunds;
  if (cashIn < 0) {
    console.warn(`[computeDerivedKPIs] cashIn is negative (${cashIn.toFixed(2)}), clamping to 0`);
    cashIn = 0;
  }

  const adCost  = adSpend     ?? 0;
  const adPurch = adPurchases ?? 0;
  const blendedDenom = productOrders ?? processed.total.orders;
  const cpaAd       = adCost > 0 && adPurch > 0        ? adCost / adPurch        : null;
  const cpaBlended  = adCost > 0 && blendedDenom > 0   ? adCost / blendedDenom   : null;
  const dailyProfit = processed.total.profit - adCost;

  return { cashIn, adCost, adPurchases: adPurch, cpaAd, cpaBlended, dailyProfit };
}

export function processDay(
  orderRows: OrderRow[],
  paymentRows: PaymentRow[],
  date: string,
): ProcessedDay {
  const total = emptyBlock();
  const physCash = emptyBlock();
  const physNonCash = emptyBlock();
  const membership = emptyBlock();
  const custNew = emptyBlock();
  const custReturning = emptyBlock();
  const cashNew = emptyBlock();
  const cashReturning = emptyBlock();
  const nonCashNew = emptyBlock();
  const nonCashReturning = emptyBlock();
  const internalNew = emptyBlock();
  const internalReturning = emptyBlock();
  const amazon = emptyBlock();
  const amazonNew = emptyBlock();
  const amazonReturning = emptyBlock();

  const totalOrders = new Set<string>();
  const physCashOrders = new Set<string>();
  const physNonCashOrders = new Set<string>();
  const memOrders = new Set<string>();
  const custNewOrders = new Set<string>();
  const custReturningOrders = new Set<string>();
  const cashNewOrders = new Set<string>();
  const cashReturningOrders = new Set<string>();
  const nonCashNewOrders = new Set<string>();
  const nonCashReturningOrders = new Set<string>();
  const internalNewOrders = new Set<string>();
  const internalReturningOrders = new Set<string>();
  const amazonOrders = new Set<string>();
  const amazonNewOrders = new Set<string>();
  const amazonReturningOrders = new Set<string>();

  const productMap = new Map<string, ProductLine & { orderSet: Set<string> }>();
  const memOrderMap = new Map<string, MemberOrder>();

  // Identify "internal" orders: order-level revenue = $0.
  // Typically comp/redo/internal orders. Still counted in day totals,
  // but surfaced as a separate segment so they don't pollute Cash/Non-Cash AOV and margin.
  const orderRevenue = new Map<string, number>();
  for (const row of orderRows) {
    orderRevenue.set(
      row.order_name,
      (orderRevenue.get(row.order_name) ?? 0) + row.net_sales + row.shipping_charges,
    );
  }
  const internalOrderNames = new Set<string>();
  orderRevenue.forEach((rev, name) => {
    if (rev === 0) internalOrderNames.add(name);
  });

  for (const row of orderRows) {
    const type = itemType(row.product_title_at_time_of_sale || row.product_title);
    const group = payGroup(row.order_name, paymentRows);
    const revenue = row.net_sales + row.shipping_charges;

    // total
    total.netSales += row.net_sales;
    total.shipping += row.shipping_charges;
    total.revenue += revenue;
    total.cogs += row.cost_of_goods_sold;
    total.qty += row.quantity_ordered;
    totalOrders.add(row.order_name);

    if (type === 'Physical') {
      const ct = row.customer_type;
      const isInternal = internalOrderNames.has(row.order_name);
      const isAmazon = row.channel === 'amazon';

      if (isAmazon) {
        // Amazon orders form their own segment, taking precedence over
        // internal/cash/non-cash routing. They still count in `total`
        // above, but are excluded from cust_new/cust_returning cross-totals
        // because Codisto creates synthetic customer records that don't
        // represent the same humans as direct Shopify customers — mixing
        // them would pollute new/returning rates for the direct business.
        amazon.netSales += row.net_sales;
        amazon.shipping += row.shipping_charges;
        amazon.revenue  += revenue;
        amazon.cogs     += row.cost_of_goods_sold;
        amazon.qty      += row.quantity_ordered;
        amazonOrders.add(row.order_name);

        const amzBlock  = ct === 'new' ? amazonNew : amazonReturning;
        const amzOrders = ct === 'new' ? amazonNewOrders : amazonReturningOrders;
        amzBlock.netSales += row.net_sales;
        amzBlock.shipping += row.shipping_charges;
        amzBlock.revenue  += revenue;
        amzBlock.cogs     += row.cost_of_goods_sold;
        amzBlock.qty      += row.quantity_ordered;
        amzOrders.add(row.order_name);
      } else if (isInternal) {
        const intBlock  = ct === 'new' ? internalNew : internalReturning;
        const intOrders = ct === 'new' ? internalNewOrders : internalReturningOrders;
        intBlock.netSales += row.net_sales;
        intBlock.shipping += row.shipping_charges;
        intBlock.revenue  += revenue;
        intBlock.cogs     += row.cost_of_goods_sold;
        intBlock.qty      += row.quantity_ordered;
        intOrders.add(row.order_name);
      } else if (group === 'Cash') {
        physCash.netSales += row.net_sales;
        physCash.shipping += row.shipping_charges;
        physCash.revenue += revenue;
        physCash.cogs += row.cost_of_goods_sold;
        physCash.qty += row.quantity_ordered;
        physCashOrders.add(row.order_name);

        const cnBlock = ct === 'new' ? cashNew : cashReturning;
        const cnOrders = ct === 'new' ? cashNewOrders : cashReturningOrders;
        cnBlock.netSales += row.net_sales;
        cnBlock.shipping += row.shipping_charges;
        cnBlock.revenue += revenue;
        cnBlock.cogs += row.cost_of_goods_sold;
        cnBlock.qty += row.quantity_ordered;
        cnOrders.add(row.order_name);
      } else {
        physNonCash.netSales += row.net_sales;
        physNonCash.shipping += row.shipping_charges;
        physNonCash.revenue += revenue;
        physNonCash.cogs += row.cost_of_goods_sold;
        physNonCash.qty += row.quantity_ordered;
        physNonCashOrders.add(row.order_name);

        const ncBlock = ct === 'new' ? nonCashNew : nonCashReturning;
        const ncOrders = ct === 'new' ? nonCashNewOrders : nonCashReturningOrders;
        ncBlock.netSales += row.net_sales;
        ncBlock.shipping += row.shipping_charges;
        ncBlock.revenue += revenue;
        ncBlock.cogs += row.cost_of_goods_sold;
        ncBlock.qty += row.quantity_ordered;
        ncOrders.add(row.order_name);
      }

      // cross-totals by customer type (physical only, excludes internal & amazon)
      if (!isInternal && !isAmazon) {
        const custBlock = ct === 'new' ? custNew : custReturning;
        const custOrderSet = ct === 'new' ? custNewOrders : custReturningOrders;
        custBlock.netSales += row.net_sales;
        custBlock.shipping += row.shipping_charges;
        custBlock.revenue += revenue;
        custBlock.cogs += row.cost_of_goods_sold;
        custBlock.qty += row.quantity_ordered;
        custOrderSet.add(row.order_name);
      }
    } else {
      membership.netSales += row.net_sales;
      membership.shipping += row.shipping_charges;
      membership.revenue += revenue;
      membership.cogs += row.cost_of_goods_sold;
      membership.qty += row.quantity_ordered;
      memOrders.add(row.order_name);
    }

    // product aggregation
    const key = `${row.product_title_at_time_of_sale}||${row.product_variant_title}`;
    if (!productMap.has(key)) {
      productMap.set(key, {
        title: row.product_title_at_time_of_sale || row.product_title,
        variant: row.product_variant_title,
        itemType: type,
        netSales: 0,
        shipping: 0,
        cogs: 0,
        revenue: 0,
        qty: 0,
        orders: 0,
        orderSet: new Set(),
      });
    }
    const p = productMap.get(key)!;
    p.netSales += row.net_sales;
    p.shipping += row.shipping_charges;
    p.cogs += row.cost_of_goods_sold;
    p.revenue += revenue;
    p.qty += row.quantity_ordered;
    p.orderSet.add(row.order_name);

    // membership order detail
    if (type === 'Membership') {
      if (!memOrderMap.has(row.order_name)) {
        memOrderMap.set(row.order_name, {
          orderName: row.order_name,
          membershipType: 'new',
          netSales: 0,
          shipping: 0,
          revenue: 0,
        });
      }
      const m = memOrderMap.get(row.order_name)!;
      m.netSales += row.net_sales;
      m.shipping += row.shipping_charges;
      m.revenue += revenue;
    }
  }

  // finalise blocks
  finalise(total, totalOrders);
  finalise(physCash, physCashOrders);
  finalise(physNonCash, physNonCashOrders);
  finalise(membership, memOrders);
  finalise(custNew, custNewOrders);
  finalise(custReturning, custReturningOrders);
  finalise(cashNew, cashNewOrders);
  finalise(cashReturning, cashReturningOrders);
  finalise(nonCashNew, nonCashNewOrders);
  finalise(nonCashReturning, nonCashReturningOrders);
  finalise(internalNew, internalNewOrders);
  finalise(internalReturning, internalReturningOrders);
  finalise(amazon, amazonOrders);
  finalise(amazonNew, amazonNewOrders);
  finalise(amazonReturning, amazonReturningOrders);

  // finalise products
  const products: ProductLine[] = [];
  productMap.forEach((p) => {
    p.orders = p.orderSet.size;
    products.push({ ...p });
  });

  // classify membership orders
  const memOrderList: MemberOrder[] = [];
  memOrderMap.forEach((m) => {
    m.membershipType = m.netSales < 35 ? 'new' : 'recurring';
    memOrderList.push(m);
  });

  return {
    date, total, physCash, physNonCash, membership,
    custNew, custReturning,
    cashNew, cashReturning, nonCashNew, nonCashReturning,
    internalNew, internalReturning,
    amazon, amazonNew, amazonReturning,
    products, memOrders: memOrderList,
  };
}
