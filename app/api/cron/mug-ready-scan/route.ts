import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchMugReadyStatus } from '@/lib/mugs/mug-ready';
import type { Json } from '@/lib/types/database';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Scans mug jobs created in the last 3 days and checks whether the customer
// has confirmed their mug selection (mug:ready tag + custom.mug_choice metafield).
// Runs every 15 minutes via Vercel cron.
//
// Groups jobs by shopify_order_id to avoid redundant Shopify API calls for
// multi-line orders. Caps at 50 unique orders per run.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function logEvent(
  jobId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id:     jobId,
    event_type: eventType,
    from_state: null,
    to_state:   null,
    payload:    payload as Json,
    error:      null,
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // `days` param lets manual callers extend the lookback window beyond the default 3.
  const daysParam = parseInt(req.nextUrl.searchParams.get('days') ?? '3', 10);
  const days      = isNaN(daysParam) || daysParam < 1 ? 3 : Math.min(daysParam, 90);
  const cutoff    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const now       = new Date().toISOString();

  // Non-terminal states where a ready flag still matters.
  const activeStates = ['received', 'generating', 'file_ready', 'draft_created', 'submitted', 'passed', 'printed', 'failed'];

  // Cap is raised when scanning a wider window manually.
  const jobLimit   = days > 3 ? 500 : 200;
  const orderLimit = days > 3 ? 200 : 50;

  // Fetch two sets and merge:
  // 1. Recent jobs (within the `days` window) — catches new orders quickly.
  // 2. Older active jobs still waiting for mug:ready — so orders like a 10-day-old
  //    "submitted" job aren't silently skipped after the initial backfill.
  const [recentResult, stalePendingResult] = await Promise.all([
    supabaseAdmin
      .from('mug_fulfillment_jobs')
      .select('id, shopify_order_id, mug_ready, mug_ready_at')
      .in('state', activeStates)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(jobLimit),
    supabaseAdmin
      .from('mug_fulfillment_jobs')
      .select('id, shopify_order_id, mug_ready, mug_ready_at')
      .in('state', activeStates)
      .lt('created_at', cutoff)   // older than the recent window
      .eq('mug_ready', false)     // still not confirmed ready
      .order('updated_at', { ascending: false })
      .limit(100),                // reasonable cap for stale orders
  ]);

  if (recentResult.error) {
    console.error('[mug-ready-scan] fetch error:', recentResult.error.message);
    return NextResponse.json({ error: recentResult.error.message }, { status: 500 });
  }
  if (stalePendingResult.error) {
    console.error('[mug-ready-scan] stale fetch error:', stalePendingResult.error.message);
  }

  const jobs = [...(recentResult.data ?? []), ...(stalePendingResult.data ?? [])];

  // Dedupe by shopify_order_id — cap raised for manual backfill runs.
  const orderToJobs = new Map<string, typeof jobs>();
  for (const job of jobs ?? []) {
    if (!orderToJobs.has(job.shopify_order_id)) {
      if (orderToJobs.size >= orderLimit) break;
      orderToJobs.set(job.shopify_order_id, []);
    }
    orderToJobs.get(job.shopify_order_id)!.push(job);
  }

  const results = { checked: 0, newly_ready: 0, errors: 0 };

  for (const [orderId, orderJobs] of Array.from(orderToJobs.entries())) {
    results.checked++;
    try {
      const status = await fetchMugReadyStatus(orderId);
      const checkedAt = now;

      for (const job of orderJobs ?? []) {
        const wasReady    = job.mug_ready;
        const isNowReady  = status.ready;
        const justFlipped = !wasReady && isNowReady;

        await (supabaseAdmin as any)
          .from('mug_fulfillment_jobs')
          .update({
            mug_ready:            isNowReady,
            mug_ready_checked_at: checkedAt,
            ...(justFlipped ? { mug_ready_at: checkedAt } : {}),
            updated_at:           checkedAt,
          })
          .eq('id', job.id);

        if (justFlipped) {
          results.newly_ready++;
          await logEvent(job.id, 'mug_ready_detected', {
            shopify_order_id:     orderId,
            tile_id:              status.tileId,
            image_url:            status.imageUrl,
            source:               status.source,
            metafield_updated_at: status.metafieldUpdatedAt,
          });
        }
      }
    } catch (err) {
      results.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mug-ready-scan] order ${orderId} error:`, msg);
      // Log against the first job for this order so it's visible in the drawer.
      const firstJob = orderJobs?.[0];
      if (firstJob) {
        await supabaseAdmin.from('mug_fulfillment_events').insert({
          job_id:     firstJob.id,
          event_type: 'mug_ready_check_failed',
          from_state: null,
          to_state:   null,
          payload:    { shopify_order_id: orderId } as Json,
          error:      msg,
        });
      }
    }
  }

  return NextResponse.json({ status: 'ok', days_scanned: days, ...results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
