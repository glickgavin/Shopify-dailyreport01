import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';
import type { Json } from '@/lib/types/database';

// Pushes a line-item-level fulfillment to Shopify when Gelato ships a mug order.
// Uses the shared shopifyGraphQL client from lib/shopify.ts (OAuth token flow).
//
// Flow:
//   1. Fetch fulfillment orders for the Shopify order
//   2. Find the open fulfillment order line item matching our Shopify line item
//   3. Call fulfillmentCreateV2 with just that line item + tracking info
//   4. Store the returned shopify_fulfillment_id (idempotency guard for retries)

// ── Event logging ─────────────────────────────────────────────────────────────

async function logEvent(
  jobId: string,
  eventType: string,
  fields: { payload?: Record<string, unknown>; error?: string },
) {
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id:     jobId,
    event_type: eventType,
    from_state: null,
    to_state:   null,
    payload:    (fields.payload ?? null) as Json | null,
    error:      fields.error ?? null,
  });
}

// ── Fulfillment order lookup ──────────────────────────────────────────────────

interface FulfillmentOrdersResponse {
  order: {
    fulfillmentOrders: {
      nodes: Array<{
        id: string;
        status: string;
        lineItems: {
          nodes: Array<{
            id: string;
            lineItem: { id: string };
            remainingQuantity: number;
          }>;
        };
      }>;
    };
  } | null;
}

async function findFulfillmentOrderLineItem(
  shopifyOrderId: string,
  shopifyLineItemId: string,
): Promise<{ fulfillmentOrderId: string; foLineItemId: string } | null> {
  const orderId    = `gid://shopify/Order/${shopifyOrderId}`;
  const lineItemId = `gid://shopify/LineItem/${shopifyLineItemId}`;

  const data = await shopifyGraphQL<FulfillmentOrdersResponse>(
    `query GetFulfillmentOrders($orderId: ID!) {
       order(id: $orderId) {
         fulfillmentOrders(first: 20) {
           nodes {
             id
             status
             lineItems(first: 50) {
               nodes {
                 id
                 lineItem { id }
                 remainingQuantity
               }
             }
           }
         }
       }
     }`,
    { orderId },
  );

  for (const fo of data.order?.fulfillmentOrders?.nodes ?? []) {
    // Only look in open fulfillment orders
    if (fo.status === 'CLOSED' || fo.status === 'CANCELLED') continue;

    for (const li of fo.lineItems?.nodes ?? []) {
      if (li.lineItem.id === lineItemId && li.remainingQuantity > 0) {
        return { fulfillmentOrderId: fo.id, foLineItemId: li.id };
      }
    }
  }

  return null;
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface MugJobForFulfillment {
  id:                    string;
  shopify_order_id:      string;
  shopify_line_item_id:  string;
  shopify_fulfillment_id?: string | null;
  tracking_number?:      string | null;
  tracking_url?:         string | null;
  tracking_company?:     string | null;
  quantity?:             number | null;
}

export async function pushTrackingToShopify(job: MugJobForFulfillment): Promise<void> {
  // Idempotency — if we already created a fulfillment for this job, skip.
  if (job.shopify_fulfillment_id) {
    return;
  }

  try {
    const foItem = await findFulfillmentOrderLineItem(
      job.shopify_order_id,
      job.shopify_line_item_id,
    );

    if (!foItem) {
      // Fulfillment order line item not found — could be already fulfilled or
      // the order is on a different fulfillment service. Log and move on.
      await logEvent(job.id, 'shopify_fulfillment_skipped', {
        payload: {
          reason:               'fulfillment_order_line_item_not_found',
          shopify_order_id:     job.shopify_order_id,
          shopify_line_item_id: job.shopify_line_item_id,
        },
      });
      return;
    }

    interface FulfillmentCreateResponse {
      fulfillmentCreateV2: {
        fulfillment: { id: string; status: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }

    const result = await shopifyGraphQL<FulfillmentCreateResponse>(
      `mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
         fulfillmentCreateV2(fulfillment: $fulfillment) {
           fulfillment { id status }
           userErrors   { field message }
         }
       }`,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{
            fulfillmentOrderId:           foItem.fulfillmentOrderId,
            fulfillmentOrderLineItems:    [{
              id:       foItem.foLineItemId,
              quantity: job.quantity ?? 1,
            }],
          }],
          trackingInfo: {
            number:  job.tracking_number  ?? undefined,
            url:     job.tracking_url     ?? undefined,
            company: job.tracking_company ?? 'Gelato',
          },
          notifyCustomer: true,
        },
      },
    );

    const userErrors = result.fulfillmentCreateV2?.userErrors ?? [];
    if (userErrors.length > 0) {
      const msg = userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Shopify userErrors: ${msg}`);
    }

    const gid = result.fulfillmentCreateV2?.fulfillment?.id;
    if (!gid) throw new Error('fulfillmentCreateV2 returned no fulfillment id');

    // Strip GID prefix: "gid://shopify/Fulfillment/123456" → "123456"
    const numericId = gid.split('/').pop() ?? gid;

    // Store fulfillment ID — only write if still null (race-safe)
    await (supabaseAdmin as any)
      .from('mug_fulfillment_jobs')
      .update({ shopify_fulfillment_id: numericId, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .is('shopify_fulfillment_id', null);

    await logEvent(job.id, 'shopify_fulfillment_created', {
      payload: {
        shopify_fulfillment_id: numericId,
        tracking_number:        job.tracking_number,
        tracking_url:           job.tracking_url,
        tracking_company:       job.tracking_company,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log failure visibly in events table — don't throw so state transitions
    // are not blocked by a Shopify push failure.
    await logEvent(job.id, 'shopify_fulfillment_failed', {
      error: msg,
      payload: {
        shopify_order_id:     job.shopify_order_id,
        shopify_line_item_id: job.shopify_line_item_id,
      },
    });
    console.error(`[shopify-fulfillment] job ${job.id} push failed: ${msg}`);
  }
}
