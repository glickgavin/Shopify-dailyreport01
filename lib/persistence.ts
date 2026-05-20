import { supabaseAdmin } from '@/lib/supabase';
import type { ProcessedDay } from '@/lib/business-rules';
import type { OrderRow, PaymentRow } from '@/lib/queries/orders';
import type { Json } from '@/lib/types/database';

export async function saveDay(
  processed: ProcessedDay,
  orderRows: OrderRow[],
  paymentRows: PaymentRow[],
): Promise<void> {
  const { date, total, physCash, physNonCash, membership, cashNew, cashReturning, nonCashNew, nonCashReturning, internalNew, internalReturning, products, memOrders } = processed;

  // 1. Upsert daily_summary
  const { error: summaryErr } = await supabaseAdmin.from('daily_summary').upsert({
    date,
    total_revenue:           total.revenue,
    total_net_sales:         total.netSales,
    total_shipping:          total.shipping,
    total_cogs:              total.cogs,
    total_profit:            total.profit,
    total_margin:            total.margin,
    total_orders:            total.orders,
    total_qty:               total.qty,
    total_aov:               total.aov,
    phys_cash_revenue:       physCash.revenue,
    phys_cash_net_sales:     physCash.netSales,
    phys_cash_shipping:      physCash.shipping,
    phys_cash_cogs:          physCash.cogs,
    phys_cash_profit:        physCash.profit,
    phys_cash_margin:        physCash.margin,
    phys_cash_orders:        physCash.orders,
    phys_cash_qty:           physCash.qty,
    phys_cash_aov:           physCash.aov,
    phys_non_cash_revenue:   physNonCash.revenue,
    phys_non_cash_net_sales: physNonCash.netSales,
    phys_non_cash_shipping:  physNonCash.shipping,
    phys_non_cash_cogs:      physNonCash.cogs,
    phys_non_cash_profit:    physNonCash.profit,
    phys_non_cash_margin:    physNonCash.margin,
    phys_non_cash_orders:    physNonCash.orders,
    phys_non_cash_qty:       physNonCash.qty,
    phys_non_cash_aov:       physNonCash.aov,
    mem_revenue:             membership.revenue,
    mem_net_sales:           membership.netSales,
    mem_shipping:            membership.shipping,
    mem_cogs:                membership.cogs,
    mem_profit:              membership.profit,
    mem_margin:              membership.margin,
    mem_orders:              membership.orders,
    mem_qty:                 membership.qty,
    mem_aov:                 membership.aov,
  }, { onConflict: 'date' });

  if (summaryErr) throw new Error(`daily_summary upsert: ${summaryErr.message}`);

  // 2. Delete-then-insert daily_products
  const { error: delProd } = await supabaseAdmin
    .from('daily_products')
    .delete()
    .eq('date', date);
  if (delProd) throw new Error(`daily_products delete: ${delProd.message}`);

  if (products.length > 0) {
    const { error: insProd } = await supabaseAdmin.from('daily_products').insert(
      products.map((p) => ({
        date,
        title:     p.title,
        variant:   p.variant,
        item_type: p.itemType,
        net_sales: p.netSales,
        shipping:  p.shipping,
        cogs:      p.cogs,
        revenue:   p.revenue,
        qty:       p.qty,
        orders:    p.orders,
      })),
    );
    if (insProd) throw new Error(`daily_products insert: ${insProd.message}`);
  }

  // 3. Delete-then-insert daily_membership_orders
  const { error: delMem } = await supabaseAdmin
    .from('daily_membership_orders')
    .delete()
    .eq('date', date);
  if (delMem) throw new Error(`daily_membership_orders delete: ${delMem.message}`);

  if (memOrders.length > 0) {
    const { error: insMem } = await supabaseAdmin.from('daily_membership_orders').insert(
      memOrders.map((m) => ({
        date,
        order_name:      m.orderName,
        membership_type: m.membershipType,
        net_sales:       m.netSales,
        shipping:        m.shipping,
        revenue:         m.revenue,
      })),
    );
    if (insMem) throw new Error(`daily_membership_orders insert: ${insMem.message}`);
  }

  // 4. Delete-then-insert daily_customer_segments
  const { error: delSeg } = await supabaseAdmin
    .from('daily_customer_segments')
    .delete()
    .eq('date', date);
  if (delSeg) throw new Error(`daily_customer_segments delete: ${delSeg.message}`);

  const segmentRows = [
    { payment_type: 'cash',     customer_type: 'new',       ...cashNew },
    { payment_type: 'cash',     customer_type: 'returning', ...cashReturning },
    { payment_type: 'non_cash', customer_type: 'new',       ...nonCashNew },
    { payment_type: 'non_cash', customer_type: 'returning', ...nonCashReturning },
    { payment_type: 'internal', customer_type: 'new',       ...internalNew },
    { payment_type: 'internal', customer_type: 'returning', ...internalReturning },
  ].map(({ payment_type, customer_type, revenue, netSales, shipping, cogs, profit, margin, orders, qty, aov }) => ({
    date,
    payment_type,
    customer_type,
    revenue,
    net_sales: netSales,
    shipping,
    cogs,
    profit,
    margin,
    orders,
    qty,
    aov,
  }));

  const { error: insSeg } = await supabaseAdmin.from('daily_customer_segments').insert(segmentRows);
  if (insSeg) throw new Error(`daily_customer_segments insert: ${insSeg.message}`);

  // 5. Append to raw_data (audit log — never delete)
  const { error: rawErr } = await supabaseAdmin.from('raw_data').insert({
    date,
    order_rows:   orderRows as unknown as Json,
    payment_rows: paymentRows as unknown as Json,
  });
  if (rawErr) throw new Error(`raw_data insert: ${rawErr.message}`);
}
