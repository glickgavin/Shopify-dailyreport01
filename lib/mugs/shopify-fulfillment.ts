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
//
//   If no open FO is found, also checks existing fulfillments on the order. If
//   the line item was already fulfilled (e.g. via Gelato's own Shopify integration
//   or manually), stores that fulfillment ID to stop retrying.

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

// ── Fulfillment order + existing fulfillment lookup ───────────────────────────

interface OrderFulfillmentData {
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
  fulfillments: Array<{
    id: string;
    status: string;
    fulfillmentLineItems: {
      nodes: Array<{
        lineItem: { id: string };
      }>;
    };
  }>;
}

interface OrderFulfillmentResponse {
  order: OrderFulfillmentData | null;
}

async function getOrderFulfillmentData(
  shopifyOrderId: string,
  shopifyLineItemId: string,
): Promise<
  | { type: 'open';     fulfillmentOrderId: string; foLineItemId: string }
  | { type: 'existing'; fulfillmentId: string }
  | { type: 'not_found' }
> {
  const orderId    = `gid://shopify/Order/${shopifyOrderId}`;
  const lineItemId = `gid://shopify/LineItem/${shopifyLineItemId}`;

  const data = await shopifyGraphQL<OrderFulfillmentResponse>(
    `query GetOrderFulfillments($orderId: ID!) {
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
         fulfillments {
           id
           status
           fulfillmentLineItems(first: 50) {
             nodes {
               lineItem { id }
             }
           }
         }
       }
     }`,
    { orderId },
  );

  const order = data.order;
  if (!order) return { type: 'not_found' };

  // Check for an open fulfillment order line item first
  for (const fo of order.fulfillmentOrders?.nodes ?? []) {
    if (fo.status === 'CLOSED' || fo.status === 'CANCELLED') continue;
    for (const li of fo.lineItems?.nodes ?? []) {
      if (li.lineItem.id === lineItemId && li.remainingQuantity > 0) {
        return { type: 'open', fulfillmentOrderId: fo.id, foLineItemId: li.id };
      }
    }
  }

  // No open FO — check if already fulfilled via an existing fulfillment
  for (const f of order.fulfillments ?? []) {
    if (f.status === 'CANCELLED') continue;
    for (const li of f.fulfillmentLineItems?.nodes ?? []) {
      if (li.lineItem.id === lineItemId) {
        const numericId = f.id.split('/').pop() ?? f.id;
        return { type: 'existing', fulfillmentId: numericId };
      }
    }
  }

  return { type: 'not_found' };
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

export type PushTrackingResult =
  | { status: 'already_fulfilled' }
  | { status: 'no_tracking' }
  | { status: 'line_item_not_found' }
  | { status: 'existing'; fulfillmentId: string }
  | { status: 'created';  fulfillmentId: string }
  | { status: 'error';    message: string };

export async function pushTrackingToShopify(job: MugJobForFulfillment): Promise<PushTrackingResult> {
  // Idempotency — if we already created (or found) a real fulfillment, skip.
  // The legacy 'not_found' sentinel is treated as retryable, not final.
  if (job.shopify_fulfillment_id && job.shopify_fulfillment_id !== 'not_found') {
    return { status: 'already_fulfilled' };
  }

  // Require a real tracking number before fulfilling — a carrier-only fulfillment
  // would notify the customer with no way to track. Wait for Gelato to supply it.
  if (!job.tracking_number) {
    await logEvent(job.id, 'shopify_fulfillment_waiting_tracking', {
      payload: {
        shopify_order_id:     job.shopify_order_id,
        shopify_line_item_id: job.shopify_line_item_id,
      },
    });
    return { status: 'no_tracking' };
  }

  try {
    const result = await getOrderFulfillmentData(
      job.shopify_order_id,
      job.shopify_line_item_id,
    );

    if (result.type === 'existing') {
      // Already fulfilled in Shopify (Gelato auto-integration or manual). Store the
      // existing fulfillment ID so we stop retrying this job.
      await (supabaseAdmin as any)
        .from('mug_fulfillment_jobs')
        .update({ shopify_fulfillment_id: result.fulfillmentId, updated_at: new Date().toISOString() })
        .eq('id', job.id);

      await logEvent(job.id, 'shopify_fulfillment_already_done', {
        payload: {
          shopify_fulfillment_id: result.fulfillmentId,
          shopify_order_id:       job.shopify_order_id,
          shopify_line_item_id:   job.shopify_line_item_id,
        },
      });
      return { status: 'existing', fulfillmentId: result.fulfillmentId };
    }

    if (result.type === 'not_found') {
      // No open FO line item and no existing fulfillment yet. This is often a
      // timing issue (the fulfillment order isn't routed the instant Gelato
      // ships), so we do NOT write a permanent sentinel — leave the job
      // unfulfilled so the next reconcile run retries it.
      await logEvent(job.id, 'shopify_fulfillment_skipped', {
        payload: {
          reason:               'fulfillment_order_line_item_not_found',
          retryable:            true,
          shopify_order_id:     job.shopify_order_id,
          shopify_line_item_id: job.shopify_line_item_id,
        },
      });
      return { status: 'line_item_not_found' };
    }

    // result.type === 'open' — create the fulfillment
    interface FulfillmentCreateResponse {
      fulfillmentCreateV2: {
        fulfillment: { id: string; status: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }

    const createResult = await shopifyGraphQL<FulfillmentCreateResponse>(
      `mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
         fulfillmentCreateV2(fulfillment: $fulfillment) {
           fulfillment { id status }
           userErrors   { field message }
         }
       }`,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{
            fulfillmentOrderId:        result.fulfillmentOrderId,
            fulfillmentOrderLineItems: [{
              id:       result.foLineItemId,
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

    const userErrors = createResult.fulfillmentCreateV2?.userErrors ?? [];
    if (userErrors.length > 0) {
      const msg = userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ');
      throw new Error(`Shopify userErrors: ${msg}`);
    }

    const gid = createResult.fulfillmentCreateV2?.fulfillment?.id;
    if (!gid) throw new Error('fulfillmentCreateV2 returned no fulfillment id');

    const numericId = gid.split('/').pop() ?? gid;

    await (supabaseAdmin as any)
      .from('mug_fulfillment_jobs')
      .update({ shopify_fulfillment_id: numericId, updated_at: new Date().toISOString() })
      .eq('id', job.id);

    await logEvent(job.id, 'shopify_fulfillment_created', {
      payload: {
        shopify_fulfillment_id: numericId,
        tracking_number:        job.tracking_number,
        tracking_url:           job.tracking_url,
        tracking_company:       job.tracking_company,
      },
    });
    return { status: 'created', fulfillmentId: numericId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent(job.id, 'shopify_fulfillment_failed', {
      error: msg,
      payload: {
        shopify_order_id:     job.shopify_order_id,
        shopify_line_item_id: job.shopify_line_item_id,
      },
    });
    console.error(`[shopify-fulfillment] job ${job.id} push failed: ${msg}`);
    return { status: 'error', message: msg };
  }
}
