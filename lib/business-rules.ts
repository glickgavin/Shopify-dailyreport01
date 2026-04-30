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

export function processDay(
  orderRows: OrderRow[],
  paymentRows: PaymentRow[],
  date: string,
): ProcessedDay {
  const total = emptyBlock();
  const physCash = emptyBlock();
  const physNonCash = emptyBlock();
  const membership = emptyBlock();

  const totalOrders = new Set<string>();
  const physCashOrders = new Set<string>();
  const physNonCashOrders = new Set<string>();
  const memOrders = new Set<string>();

  const productMap = new Map<string, ProductLine & { orderSet: Set<string> }>();
  const memOrderMap = new Map<string, MemberOrder>();

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
      if (group === 'Cash') {
        physCash.netSales += row.net_sales;
        physCash.shipping += row.shipping_charges;
        physCash.revenue += revenue;
        physCash.cogs += row.cost_of_goods_sold;
        physCash.qty += row.quantity_ordered;
        physCashOrders.add(row.order_name);
      } else {
        physNonCash.netSales += row.net_sales;
        physNonCash.shipping += row.shipping_charges;
        physNonCash.revenue += revenue;
        physNonCash.cogs += row.cost_of_goods_sold;
        physNonCash.qty += row.quantity_ordered;
        physNonCashOrders.add(row.order_name);
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

  return { date, total, physCash, physNonCash, membership, products, memOrders: memOrderList };
}
