import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';
import type { Json } from '@/lib/types/database';

export const runtime = 'nodejs';

const MAGIC_MUG_PRODUCT_IDS = ['8600824643780'];

const ORDER_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id name createdAt financialStatus displayFulfillmentStatus
      customer { firstName lastName }
      shippingAddress {
        firstName lastName address1 address2
        city provinceCode zip countryCode phone
      }
      lineItems(first: 50) {
        nodes {
          id title
          product { id }
          customAttributes { key value }
        }
      }
    }
  }
`;

interface GQLOrderResult {
  order: {
    id: string; name: string; createdAt: string;
    financialStatus: string; displayFulfillmentStatus: string;
    customer: { firstName: string; lastName: string } | null;
    shippingAddress: Record<string, string> | null;
    lineItems: { nodes: Array<{
      id: string; title: string;
      product: { id: string } | null;
      customAttributes: Array<{ key: string; value: string }>;
    }> };
  } | null;
}

export async function POST(req: NextRequest) {
  // Auth: must be logged-in admin
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/dashboard/admin/login', req.url));

  const redirect = (msg: string, ok: boolean) => {
    const url = new URL('/dashboard/admin/mug-fulfillment', req.url);
    url.searchParams.set('backfill_msg', msg);
    url.searchParams.set('backfill_ok', ok ? '1' : '0');
    return NextResponse.redirect(url, { status: 303 });
  };

  const formData = await req.formData();
  const raw = (formData.get('shopify_order_id') as string)?.trim() ?? '';
  const numeric = raw.replace(/\D/g, '');
  if (!numeric) return redirect('Could not parse a numeric order ID from input', false);

  const gid = `gid://shopify/Order/${numeric}`;

  let result: GQLOrderResult;
  try {
    result = await shopifyGraphQL<GQLOrderResult>(ORDER_QUERY, { id: gid });
  } catch (err) {
    return redirect(`Shopify fetch failed: ${err instanceof Error ? err.message : String(err)}`, false);
  }

  const order = result.order;
  if (!order) return redirect(`Order ${numeric} not found in Shopify`, false);

  const mugLineItems = order.lineItems.nodes.filter(li => {
    const pid = li.product?.id?.split('/').pop();
    return pid && MAGIC_MUG_PRODUCT_IDS.includes(pid);
  });

  if (mugLineItems.length === 0) {
    return redirect(`No Magic Mug line items found on ${order.name}`, false);
  }

  const addr = order.shippingAddress;
  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
    : addr ? `${addr.firstName ?? ''} ${addr.lastName ?? ''}`.trim() : '';

  let inserted = 0, skipped = 0;

  for (const li of mugLineItems) {
    const liNumeric = li.id.split('/').pop()!;
    const tileId    = li.customAttributes.find(a => a.key === '_mug_portrait_tile_id')?.value ?? null;
    const gelatoUid = li.customAttributes.find(a => a.key === '_gelato_product_uid')?.value ?? null;

    const { data: existing } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .select('id')
      .eq('shopify_line_item_id', liNumeric)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    await supabaseAdmin.from('mug_fulfillment_jobs').insert({
      shopify_order_id:     numeric,
      shopify_order_name:   order.name,
      shopify_line_item_id: liNumeric,
      customer_name:        customerName,
      shipping_address:     (addr ?? null) as Json | null,
      state:                'received',
      tile_id:              tileId,
      gelato_product_uid:   gelatoUid ?? 'mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0',
      attempts:             0,
      created_at:           order.createdAt,
    });
    inserted++;
  }

  if (inserted === 0 && skipped > 0) {
    return redirect(`${order.name} already in DB (${skipped} line item(s) skipped)`, true);
  }
  return redirect(`Backfilled ${inserted} line item(s) from ${order.name}${skipped ? `, ${skipped} already existed` : ''}`, true);
}
