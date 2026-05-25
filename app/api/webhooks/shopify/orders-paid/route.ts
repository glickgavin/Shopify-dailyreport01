import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Shopify product ID for the Magic Mug — never changes regardless of title/SKU
const MAGIC_MUG_PRODUCT_ID = '8600824643780';

// ── HMAC verification ─────────────────────────────────────────────────────────

async function verifyShopifyHmac(req: NextRequest, rawBody: Buffer): Promise<boolean> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;

  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const digestBuf = Buffer.from(digest, 'base64');
  const headerBuf = Buffer.from(hmacHeader, 'base64');

  if (digestBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, headerBuf);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItemProperty {
  name: string;
  value: string;
}

interface ShopifyLineItem {
  id: number;
  product_id: number;
  title: string;
  quantity: number;
  properties: LineItemProperty[];
}

interface ShopifyAddress {
  first_name?:   string;
  last_name?:    string;
  name?:         string;
  address1?:     string;
  address2?:     string;
  city?:         string;
  zip?:          string;
  province?:     string;
  country?:      string;
  country_code?: string;
  phone?:        string;
  email?:        string;
}

interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
}

// ── Helper ────────────────────────────────────────────────────────────────────

function getProp(properties: LineItemProperty[], name: string): string | null {
  return properties.find((p) => p.name === name)?.value ?? null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Read raw body first — must happen before any other body parsing
  const rawBody = Buffer.from(await req.arrayBuffer());

  // 1. Verify HMAC signature
  const valid = await verifyShopifyHmac(req, rawBody);
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody.toString('utf8')) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 3. Find Magic Mug line items
  const mugLineItems = order.line_items.filter(
    (li) =>
      String(li.product_id) === MAGIC_MUG_PRODUCT_ID &&
      getProp(li.properties, '_gelato_product_uid') !== null,
  );

  if (mugLineItems.length === 0) {
    // Not an error — just an order with no mugs
    return NextResponse.json({ status: 'ok', mugs: 0 });
  }

  // 4. Insert one job per mug line item (idempotent — unique on shopify_line_item_id)
  const addr = order.shipping_address;
  const customerName = addr
    ? (addr.name ?? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim())
    : undefined;
  const shippingAddress = addr
    ? { ...addr, email: addr.email ?? order.email }
    : undefined;

  const rows = mugLineItems.map((li) => ({
    shopify_order_id:     String(order.id),
    shopify_order_name:   order.name,
    shopify_line_item_id: String(li.id),
    tile_id:              getProp(li.properties, '_mug_portrait_tile_id'),
    print_file_url:       getProp(li.properties, '_print_file_url'),
    gelato_product_uid:   getProp(li.properties, '_gelato_product_uid')!,
    quantity:             li.quantity,
    customer_name:        customerName ?? null,
    shipping_address:     shippingAddress ?? null,
    state:                'received',
  }));

  const { error } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .upsert(rows, { onConflict: 'shopify_line_item_id', ignoreDuplicates: true });

  if (error) {
    console.error('[shopify/orders-paid] supabase upsert error:', error.message);
    // Return 200 anyway — Shopify will retry on non-2xx, causing duplicates
    // The error is logged; the cron will not pick up a row that wasn't inserted
    return NextResponse.json({ status: 'error', detail: error.message }, { status: 200 });
  }

  console.log(
    `[shopify/orders-paid] order ${order.name}: inserted ${rows.length} mug job(s)`,
  );

  return NextResponse.json({ status: 'ok', mugs: rows.length });
}
