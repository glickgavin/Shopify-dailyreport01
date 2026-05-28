import { NextRequest, NextResponse } from 'next/server';
import { shopifyGraphQL } from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ── constants ─────────────────────────────────────────────────────────────────

const SCOPE_SINCE = '2026-05-24T00:00:00Z';
const SHOPIFY_CDN_BASE = 'https://cdn.shopify.com/s/files/1/0042/8336/7495/files';
const CDN_CONCURRENCY = 50;

// ── Shopify GraphQL types ─────────────────────────────────────────────────────

interface GQLProductNode {
  id: string;
  title: string;
  status: string;
}

interface GQLCustomAttribute {
  key: string;
  value: string;
}

interface GQLLineItem {
  id: string;
  title: string;
  product: { id: string } | null;
  customAttributes: GQLCustomAttribute[];
}

interface GQLOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  displayFulfillmentStatus: string;
  customer: { firstName: string; lastName: string } | null;
  shippingAddress: Record<string, string> | null;
  lineItems: { nodes: GQLLineItem[]; pageInfo: { hasNextPage: boolean } };
}

type ProductsResult = {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GQLProductNode[] };
};
type OrdersResult = {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GQLOrder[] };
};

// ── helpers ───────────────────────────────────────────────────────────────────

function gidToNumeric(gid: string): string {
  return gid.split('/').pop() ?? gid;
}

function getLineItemProp(attrs: GQLCustomAttribute[], key: string): string | null {
  return attrs.find(a => a.key === key)?.value ?? null;
}

// Semaphore for bounding HEAD request concurrency
async function withConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function getImagegenClient() {
  const url = process.env.IMAGEGEN_SUPABASE_URL;
  const key = process.env.IMAGEGEN_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Shopify queries ───────────────────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query FindMagicMugProducts($cursor: String) {
    products(first: 50, after: $cursor, query: "Magic Mug") {
      pageInfo { hasNextPage endCursor }
      nodes { id title status }
    }
  }
`;

const ORDERS_QUERY = `
  query GetOrders($filter: String!, $cursor: String) {
    orders(first: 250, query: $filter, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        financialStatus
        displayFulfillmentStatus
        customer { firstName lastName }
        shippingAddress {
          firstName lastName address1 address2
          city provinceCode zip countryCode phone
        }
        lineItems(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            id
            title
            product { id }
            customAttributes { key value }
          }
        }
      }
    }
  }
`;

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth   = req.headers.get('authorization');
  const qs     = req.nextUrl.searchParams.get('secret');
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 1. Spot-check Shopify catalog for Magic Mug product IDs ──────────────

  const allProducts: GQLProductNode[] = [];
  let productCursor: string | null = null;
  for (;;) {
    const pd: ProductsResult = await shopifyGraphQL<ProductsResult>(PRODUCTS_QUERY, { cursor: productCursor });
    allProducts.push(...pd.products.nodes);
    if (!pd.products.pageInfo.hasNextPage) break;
    productCursor = pd.products.pageInfo.endCursor;
  }

  const mugProducts = allProducts.filter(p =>
    p.title.toLowerCase().includes('magic mug'),
  );
  const mugProductNumericIds = mugProducts.map(p => gidToNumeric(p.id));

  // Fall back to known ID if catalog query returns nothing (shouldn't happen)
  if (mugProductNumericIds.length === 0) mugProductNumericIds.push('8600824643780');

  const productIdsMatched = mugProductNumericIds;

  // ── 2. Paginate orders since scope date ───────────────────────────────────

  const filter = `financial_status:paid created_at:>='${SCOPE_SINCE}'`;

  interface RawLineItem {
    shopify_order_id: string;
    shopify_order_name: string;
    shopify_line_item_id: string;
    customer_name: string;
    shipping_address: Record<string, string> | null;
    created_at: string;
    financial_status: string;
    fulfillment_status: string;
    tile_id: string | null;
    print_file_url: string | null;
    gelato_product_uid: string | null;
    raw_property_keys: string[];
  }

  const allLineItems: RawLineItem[] = [];
  const propertyVariantsFound = new Set<string>();
  let cursor: string | null = null;
  let totalOrdersScanned = 0;
  let oldestOrder: { name: string; created_at: string } | null = null;
  let newestOrder: { name: string; created_at: string } | null = null;

  for (;;) {
    const data: OrdersResult = await shopifyGraphQL<OrdersResult>(ORDERS_QUERY, { filter, cursor });

    for (const order of data.orders.nodes) {
      totalOrdersScanned++;
      const orderNumericId = gidToNumeric(order.id);

      if (!oldestOrder || order.createdAt < oldestOrder.created_at) {
        oldestOrder = { name: order.name, created_at: order.createdAt };
      }
      if (!newestOrder || order.createdAt > newestOrder.created_at) {
        newestOrder = { name: order.name, created_at: order.createdAt };
      }

      for (const li of order.lineItems.nodes) {
        const productNumericId = li.product ? gidToNumeric(li.product.id) : null;
        if (!productNumericId || !mugProductNumericIds.includes(productNumericId)) continue;

        const liNumericId = gidToNumeric(li.id);

        // Track all property key names seen
        for (const attr of li.customAttributes) {
          propertyVariantsFound.add(attr.key);
        }

        const addr = order.shippingAddress;
        const customerName = order.customer
          ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
          : addr?.firstName
          ? `${addr.firstName} ${addr.lastName ?? ''}`.trim()
          : '';

        allLineItems.push({
          shopify_order_id:      orderNumericId,
          shopify_order_name:    order.name,
          shopify_line_item_id:  liNumericId,
          customer_name:         customerName,
          shipping_address:      addr,
          created_at:            order.createdAt,
          financial_status:      order.financialStatus,
          fulfillment_status:    order.displayFulfillmentStatus,
          tile_id:               getLineItemProp(li.customAttributes, '_mug_portrait_tile_id'),
          print_file_url:        getLineItemProp(li.customAttributes, '_print_file_url'),
          gelato_product_uid:    getLineItemProp(li.customAttributes, '_gelato_product_uid'),
          raw_property_keys:     li.customAttributes.map(a => a.key),
        });
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  // ── 3. Check which line items are already in DB ───────────────────────────

  const lineItemIds = allLineItems.map(li => li.shopify_line_item_id);
  const { data: existingRows } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('shopify_line_item_id')
    .in('shopify_line_item_id', lineItemIds.length > 0 ? lineItemIds : ['__none__']);

  const existingSet = new Set((existingRows ?? []).map(r => String(r.shopify_line_item_id)));

  // ── 4. Classify line items ────────────────────────────────────────────────

  const alreadyInDb: RawLineItem[] = [];
  const ready: RawLineItem[] = [];
  const unrecoverable: RawLineItem[] = [];

  for (const li of allLineItems) {
    if (existingSet.has(li.shopify_line_item_id)) {
      alreadyInDb.push(li);
    } else if (li.tile_id) {
      ready.push(li);
    } else {
      unrecoverable.push(li);
    }
  }

  // ── 5. Classify ready items by tile source ────────────────────────────────

  // Batch imagegen lookup
  const imagegen = getImagegenClient();
  const imagegenSet = new Set<string>();

  if (imagegen && ready.length > 0) {
    const tileIds = Array.from(new Set(ready.map(li => li.tile_id as string)));
    // Query in batches of 500 to avoid URL length limits
    for (let i = 0; i < tileIds.length; i += 500) {
      const batch = tileIds.slice(i, i + 500);
      const { data: rows } = await imagegen
        .from('images')
        .select('id')
        .in('id', batch);
      for (const row of (rows ?? [])) imagegenSet.add(row.id as string);
    }
  }

  interface ClassifiedItem extends RawLineItem {
    tile_source?: 'tile_in_imagegen' | 'legacy_cdn' | 'no_known_source';
  }

  const readyClassified: ClassifiedItem[] = ready.map(li => ({
    ...li,
    tile_source: imagegenSet.has(li.tile_id as string)
      ? 'tile_in_imagegen'
      : undefined, // CDN check pending
  }));

  // HEAD check CDN for items not in imagegen
  const needsCdnCheck = readyClassified.filter(li => !li.tile_source);

  await withConcurrencyLimit(needsCdnCheck, CDN_CONCURRENCY, async (li) => {
    const url = `${SHOPIFY_CDN_BASE}/${li.tile_id}.jpg`;
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      li.tile_source = res.ok ? 'legacy_cdn' : 'no_known_source';
    } catch {
      li.tile_source = 'no_known_source';
    }
  });

  const tileInImagegen = readyClassified.filter(li => li.tile_source === 'tile_in_imagegen');
  const legacyCdn      = readyClassified.filter(li => li.tile_source === 'legacy_cdn');
  const noKnownSource  = readyClassified.filter(li => li.tile_source === 'no_known_source');

  // ── 6. Fulfillment status breakdown ──────────────────────────────────────

  const byFulfillmentStatus: Record<string, number> = {};
  for (const li of allLineItems) {
    const s = (li.fulfillment_status ?? 'unknown').toLowerCase();
    byFulfillmentStatus[s] = (byFulfillmentStatus[s] ?? 0) + 1;
  }

  // ── 7. Sample 3 oldest for property name spot-check ──────────────────────

  const oldestThree = [...allLineItems]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 3)
    .map(li => ({ order: li.shopify_order_name, created_at: li.created_at, property_keys: li.raw_property_keys }));

  // ── 8. Build response ─────────────────────────────────────────────────────

  const summarise = (li: ClassifiedItem) => ({
    order:          li.shopify_order_name,
    line_item_id:   li.shopify_line_item_id,
    customer:       li.customer_name,
    created_at:     li.created_at,
    fulfillment:    li.fulfillment_status,
    tile_id:        li.tile_id,
    tile_source:    li.tile_source,
    print_file_url: li.print_file_url,
  });

  const summariseUnrecoverable = (li: RawLineItem) => ({
    order:           li.shopify_order_name,
    line_item_id:    li.shopify_line_item_id,
    customer:        li.customer_name,
    created_at:      li.created_at,
    fulfillment:     li.fulfillment_status,
    property_keys:   li.raw_property_keys,
    print_file_url:  li.print_file_url,
  });

  return NextResponse.json({
    product_ids_matched:     productIdsMatched,
    mug_products_found:      mugProducts.map(p => ({ id: gidToNumeric(p.id), title: p.title, status: p.status })),
    property_variants_found: Array.from(propertyVariantsFound).sort(),
    oldest_three_property_spot_check: oldestThree,
    total_orders_scanned:    totalOrdersScanned,
    total_mug_line_items:    allLineItems.length,
    already_in_db:           alreadyInDb.length,
    ready: {
      total:             readyClassified.length,
      tile_in_imagegen:  tileInImagegen.length,
      legacy_cdn:        legacyCdn.length,
      no_known_source:   noKnownSource.length,
    },
    unrecoverable:           unrecoverable.length,
    by_fulfillment_status:   byFulfillmentStatus,
    oldest_order:            oldestOrder,
    newest_order:            newestOrder,
    sample_ready_imagegen:   tileInImagegen.slice(0, 5).map(summarise),
    sample_ready_legacy_cdn: legacyCdn.slice(0, 5).map(summarise),
    sample_no_known_source:  noKnownSource.slice(0, 10).map(summarise),
    sample_unrecoverable:    unrecoverable.slice(0, 10).map(summariseUnrecoverable),
  });
}
