import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Temporary debug route — fetch a Shopify order and show mug line item structure.
// Protected by CRON_SECRET. Delete this route before going to production.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get('order_id');
  if (!orderId) {
    return NextResponse.json({ error: 'Missing order_id param' }, { status: 400 });
  }

  const domain  = process.env.SHOPIFY_STORE_DOMAIN;
  const token   = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION ?? '2024-04';

  if (!domain || !token) {
    return NextResponse.json({ error: 'SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN not set' }, { status: 500 });
  }

  const url = `https://${domain}/admin/api/${version}/orders/${orderId}.json?fields=id,name,line_items`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Shopify ${res.status}`, detail: text }, { status: 502 });
  }

  const data = await res.json() as { order: { id: number; name: string; line_items: unknown[] } };
  const order = data.order;

  // Pull out just the fields we care about for mug matching
  const lineItems = (order.line_items as Array<{
    id: number;
    product_id: number;
    title: string;
    quantity: number;
    sku: string;
    properties: Array<{ name: string; value: string }>;
  }>).map((li) => ({
    id:            li.id,
    product_id:    li.product_id,
    title:         li.title,
    quantity:      li.quantity,
    sku:           li.sku,
    properties:    li.properties,
    is_magic_mug:  String(li.product_id) === '8600824643780',
    has_gelato_uid: li.properties?.some((p) => p.name === '_gelato_product_uid') ?? false,
  }));

  return NextResponse.json({
    order_id:   order.id,
    order_name: order.name,
    line_items: lineItems,
  });
}
