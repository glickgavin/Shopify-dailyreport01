/**
 * One-shot backfill: push stuck mug fulfillments to Shopify.
 *
 * Context: A batch of ~160 mug_fulfillment_jobs are in state='shipped' but
 * shopify_fulfillment_id is NULL (or the legacy 'not_found' sentinel). The
 * production reconcile cron logs 'fulfillment_order_line_item_not_found' every
 * 10 min and never recovers. Data is fine — the code path just isn't finding
 * the mug FO for some reason yet to be diagnosed.
 *
 * This script bypasses the cron and directly performs the same work using the
 * existing r_order Shopify OAuth app (via lib/shopify.ts's shopifyGraphQL
 * helper) and Supabase admin client.
 *
 * Usage:
 *     pnpm tsx scripts/fix-mug-fulfillment-backlog.ts           # process all
 *     pnpm tsx scripts/fix-mug-fulfillment-backlog.ts --dry     # dry run
 *     pnpm tsx scripts/fix-mug-fulfillment-backlog.ts --one 4971f7b4-...  # single job
 *
 * The script is idempotent: if a job's shopify_fulfillment_id gets set between
 * iterations (by the concurrent cron), we skip it. If fulfillmentCreateV2
 * reports the FO line item already fulfilled, we treat that as success.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local BEFORE importing anything that touches env
config({ path: resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';
import { shopifyGraphQL } from '../lib/shopify';

/* ------------------------------------------------------------------ */
/*  CLI                                                               */
/* ------------------------------------------------------------------ */

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const oneIdx  = args.indexOf('--one');
const ONE_ID  = oneIdx >= 0 ? args[oneIdx + 1] : null;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface StuckJob {
  id:                     string;
  shopify_order_name:     string | null;
  shopify_order_id:       string;
  shopify_line_item_id:   string;
  tracking_number:        string;
  tracking_url:           string | null;
  tracking_company:       string | null;
  quantity:               number | null;
  shopify_fulfillment_id: string | null;
}

interface OrderFulfillmentsResp {
  order: {
    fulfillmentOrders: {
      nodes: Array<{
        id:     string;
        status: string;
        lineItems: {
          nodes: Array<{
            id:                string;
            lineItem:          { id: string };
            remainingQuantity: number;
          }>;
        };
      }>;
    };
    fulfillments: Array<{
      id:     string;
      status: string;
      fulfillmentLineItems: { nodes: Array<{ lineItem: { id: string } }> };
    }>;
  } | null;
}

interface FulfillmentCreateResp {
  fulfillmentCreateV2: {
    fulfillment: { id: string; status: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

type OutcomeStatus =
  | 'created'
  | 'already_fulfilled'
  | 'no_open_fo'
  | 'no_order'
  | 'mutation_error'
  | 'skipped_already_set'
  | 'db_error';

interface Outcome {
  jobId:                string;
  orderName:            string | null;
  status:               OutcomeStatus;
  detail?:              string;
  shopifyFulfillmentId?: string;
}

/* ------------------------------------------------------------------ */
/*  Shopify queries                                                   */
/* ------------------------------------------------------------------ */

const GET_ORDER_FULFILLMENTS = `
  query GetOrderFulfillments($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 20) {
        nodes {
          id status
          lineItems(first: 50) {
            nodes { id lineItem { id } remainingQuantity }
          }
        }
      }
      fulfillments {
        id status
        fulfillmentLineItems(first: 50) { nodes { lineItem { id } } }
      }
    }
  }
`;

const FULFILLMENT_CREATE = `
  mutation FulfillMug($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors  { field message }
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const NUMERIC_ID = /gid:\/\/shopify\/Fulfillment\/(\d+)/;
const numericFulfillmentId = (gid: string) => {
  const m = gid.match(NUMERIC_ID);
  return m ? m[1] : gid;
};

async function logEvent(jobId: string, eventType: string, payload: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin as any).from('mug_fulfillment_events').insert({
    job_id:     jobId,
    event_type: eventType,
    payload,
  });
}

/* ------------------------------------------------------------------ */
/*  Per-job worker                                                    */
/* ------------------------------------------------------------------ */

async function processJob(job: StuckJob): Promise<Outcome> {
  const orderGid    = `gid://shopify/Order/${job.shopify_order_id}`;
  const lineItemGid = `gid://shopify/LineItem/${job.shopify_line_item_id}`;

  let fetched: OrderFulfillmentsResp;
  try {
    fetched = await shopifyGraphQL<OrderFulfillmentsResp>(GET_ORDER_FULFILLMENTS, { orderId: orderGid });
  } catch (err) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'mutation_error', detail: `order fetch: ${(err as Error).message}` };
  }

  const order = fetched.order;
  if (!order) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'no_order' };
  }

  for (const f of order.fulfillments ?? []) {
    if (f.status === 'CANCELLED') continue;
    const covered = f.fulfillmentLineItems.nodes.some(li => li.lineItem.id === lineItemGid);
    if (covered) {
      const numeric = numericFulfillmentId(f.id);
      if (!DRY_RUN) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabaseAdmin as any)
          .from('mug_fulfillment_jobs')
          .update({ shopify_fulfillment_id: numeric, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        if (error) return { jobId: job.id, orderName: job.shopify_order_name, status: 'db_error', detail: error.message };
        await logEvent(job.id, 'shopify_fulfillment_already_done', {
          shopify_fulfillment_id: numeric,
          shopify_order_id:       job.shopify_order_id,
          shopify_line_item_id:   job.shopify_line_item_id,
          source:                 'backfill_script',
        });
      }
      return { jobId: job.id, orderName: job.shopify_order_name, status: 'already_fulfilled', shopifyFulfillmentId: numeric };
    }
  }

  let foId:   string | null = null;
  let foLiId: string | null = null;
  for (const fo of order.fulfillmentOrders.nodes) {
    if (fo.status === 'CLOSED' || fo.status === 'CANCELLED') continue;
    for (const li of fo.lineItems.nodes) {
      if (li.lineItem.id === lineItemGid && li.remainingQuantity > 0) {
        foId   = fo.id;
        foLiId = li.id;
        break;
      }
    }
    if (foId) break;
  }

  if (!foId || !foLiId) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'no_open_fo', detail: 'no OPEN fulfillment order line item — check Shopify admin manually' };
  }

  if (DRY_RUN) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'created', detail: `[dry] would fulfill FO ${foId} · line ${foLiId}` };
  }

  const trackingCompany = job.tracking_company ?? undefined;
  const trackingUrl     = job.tracking_url     ?? undefined;

  let mutResp: FulfillmentCreateResp;
  try {
    mutResp = await shopifyGraphQL<FulfillmentCreateResp>(FULFILLMENT_CREATE, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{
          fulfillmentOrderId: foId,
          fulfillmentOrderLineItems: [{ id: foLiId, quantity: job.quantity ?? 1 }],
        }],
        notifyCustomer: false,
        trackingInfo: {
          number:  job.tracking_number,
          company: trackingCompany,
          url:     trackingUrl,
        },
      },
    });
  } catch (err) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'mutation_error', detail: (err as Error).message };
  }

  const errors = mutResp.fulfillmentCreateV2.userErrors ?? [];
  if (errors.length > 0) {
    const msg = errors.map(e => `${(e.field ?? []).join('.') || '?'}: ${e.message}`).join('; ');
    await logEvent(job.id, 'shopify_fulfillment_failed', { source: 'backfill_script', errors: msg });
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'mutation_error', detail: msg };
  }

  const created = mutResp.fulfillmentCreateV2.fulfillment;
  if (!created) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'mutation_error', detail: 'mutation returned no fulfillment' };
  }

  const numeric = numericFulfillmentId(created.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (supabaseAdmin as any)
    .from('mug_fulfillment_jobs')
    .update({ shopify_fulfillment_id: numeric, updated_at: new Date().toISOString() })
    .eq('id', job.id);
  if (dbErr) {
    return { jobId: job.id, orderName: job.shopify_order_name, status: 'db_error', detail: dbErr.message, shopifyFulfillmentId: numeric };
  }

  await logEvent(job.id, 'shopify_fulfillment_created', {
    shopify_fulfillment_id: numeric,
    shopify_order_id:       job.shopify_order_id,
    shopify_line_item_id:   job.shopify_line_item_id,
    fulfillment_order_id:   foId,
    tracking_number:        job.tracking_number,
    source:                 'backfill_script',
  });

  return { jobId: job.id, orderName: job.shopify_order_name, status: 'created', shopifyFulfillmentId: numeric };
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\n─── Mug fulfillment backfill ───`);
  console.log(`  Mode:        ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Scope:       ${ONE_ID ? `single job ${ONE_ID}` : 'past 7 days of stuck jobs'}\n`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (supabaseAdmin as any)
    .from('mug_fulfillment_jobs')
    .select('id, shopify_order_name, shopify_order_id, shopify_line_item_id, tracking_number, tracking_url, tracking_company, quantity, shopify_fulfillment_id')
    .in('state', ['shipped', 'delivered'])
    .not('tracking_number', 'is', null)
    .not('shopify_order_id', 'is', null)
    .not('shopify_line_item_id', 'is', null);

  if (ONE_ID) {
    q = q.eq('id', ONE_ID);
  } else {
    q = q.or('shopify_fulfillment_id.is.null,shopify_fulfillment_id.eq.not_found')
         .gte('updated_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
         .order('updated_at', { ascending: false });
  }

  const { data: jobs, error } = await q;
  if (error) {
    console.error(`\n✗ Fetch failed: ${error.message}\n`);
    process.exit(1);
  }
  const stuck = (jobs ?? []) as StuckJob[];
  console.log(`  Found ${stuck.length} stuck job(s).\n`);

  if (stuck.length === 0) {
    console.log(`  Nothing to do.\n`);
    return;
  }

  const buckets: Record<OutcomeStatus, Outcome[]> = {
    created:              [],
    already_fulfilled:    [],
    no_open_fo:           [],
    no_order:             [],
    mutation_error:       [],
    skipped_already_set:  [],
    db_error:             [],
  };

  let i = 0;
  for (const job of stuck) {
    i++;
    if (!ONE_ID) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fresh } = await (supabaseAdmin as any)
        .from('mug_fulfillment_jobs')
        .select('shopify_fulfillment_id')
        .eq('id', job.id).maybeSingle();
      if (fresh?.shopify_fulfillment_id && fresh.shopify_fulfillment_id !== 'not_found') {
        buckets.skipped_already_set.push({ jobId: job.id, orderName: job.shopify_order_name, status: 'skipped_already_set' });
        continue;
      }
    }

    const outcome = await processJob(job);
    buckets[outcome.status].push(outcome);

    const short = outcome.status === 'created' ? '✓ CREATED'
                : outcome.status === 'already_fulfilled' ? '≈ existing'
                : outcome.status === 'no_open_fo' ? '⚠ no open FO'
                : outcome.status === 'skipped_already_set' ? '· skipped'
                : outcome.status === 'db_error' ? '! DB error'
                : outcome.status === 'no_order' ? '! no order'
                : '✗ error';
    const label = `[${String(i).padStart(3)}/${stuck.length}] ${job.shopify_order_name ?? job.shopify_order_id}`;
    console.log(`${label.padEnd(28)} ${short}${outcome.detail ? ` — ${outcome.detail}` : ''}${outcome.shopifyFulfillmentId ? ` (ff ${outcome.shopifyFulfillmentId})` : ''}`);

    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n─── Summary ───`);
  for (const [k, v] of Object.entries(buckets)) {
    if (v.length > 0) console.log(`  ${k.padEnd(22)} ${v.length}`);
  }
  console.log('');

  const needsReview = [...buckets.no_open_fo, ...buckets.no_order, ...buckets.mutation_error, ...buckets.db_error];
  if (needsReview.length > 0) {
    console.log(`─── Needs manual review (${needsReview.length}) ───`);
    for (const o of needsReview) {
      console.log(`  ${o.orderName?.padEnd(10) ?? o.jobId}  ${o.status.padEnd(16)} ${o.detail ?? ''}`);
    }
    console.log('');
  }
}

main().catch(err => {
  console.error('\n✗ Fatal:', err);
  process.exit(1);
});
