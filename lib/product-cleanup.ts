import { shopifyGraphQL } from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';

// ── Magic Portraits product cleanup engine ───────────────────────────────────
// Shopify hit the 1M product limit because personalized Magic Portrait
// products are minted daily. This engine:
//   1. SYNC (state machine, resumable): bulk-exports products created in the
//      config window (Mar–May 2026 for now) into product_cleanup_candidates,
//      and all order line-item product ids into sold_products; then flags
//      sold candidates and builds batches of ≤batch_size unsold portraits,
//      chronologically.
//   2. DELETE WORKER: processes ONLY admin-approved batches, and only while
//      deletion_enabled is true. Every guard is re-checked per product at
//      delete time; every outcome is logged with a snapshot.
//
// THE MASTER PRODUCT IS NEVER DELETABLE: hard-coded here, in the config's
// protected list, and re-checked at delete time.

export const MASTER_PRODUCT_ID = 'gid://shopify/Product/8471707222212';

const db = supabaseAdmin as any;

// ── config ───────────────────────────────────────────────────────────────────

export interface CleanupConfig {
  deletion_enabled: boolean;
  window_start: string;
  window_end: string;
  title_pattern: string;
  protected_product_ids: string[];
  batch_size: number;
  sync_state: SyncState;
}

export interface SyncState {
  phase?: 'idle' | 'products_running' | 'products_ingest' | 'orders_running' | 'orders_ingest' | 'finalize';
  bulk_op_id?: string;
  url?: string;
  line_offset?: number;
  last_error?: string;
  last_completed_at?: string;
  counts?: Record<string, number>;
}

export async function loadCleanupConfig(): Promise<CleanupConfig> {
  const { data, error } = await db.from('product_cleanup_config').select('*').eq('id', 1).single();
  if (error || !data) throw new Error(`product_cleanup_config load: ${error?.message ?? 'missing'}`);
  return data as CleanupConfig;
}

async function saveSyncState(state: SyncState): Promise<void> {
  await db.from('product_cleanup_config').update({ sync_state: state }).eq('id', 1);
}

// ── Shopify bulk-operation helpers ───────────────────────────────────────────

const BULK_RUN = `
  mutation BulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;
const BULK_POLL = `
  query BulkPoll($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode objectCount url }
    }
  }
`;

async function startBulkOperation(query: string): Promise<{ id?: string; error?: string }> {
  const resp = await shopifyGraphQL<{
    bulkOperationRunQuery: { bulkOperation: { id: string; status: string } | null; userErrors: { message: string }[] };
  }>(BULK_RUN, { query });
  const errs = resp.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length > 0) return { error: errs.map(e => e.message).join('; ') };
  const id = resp.bulkOperationRunQuery?.bulkOperation?.id;
  return id ? { id } : { error: 'no bulk operation id returned' };
}

async function pollBulkOperation(id: string): Promise<{ status: string; url?: string | null; errorCode?: string | null; objectCount?: string }> {
  const resp = await shopifyGraphQL<{ node: { status: string; url: string | null; errorCode: string | null; objectCount: string } | null }>(BULK_POLL, { id });
  if (!resp.node) return { status: 'MISSING' };
  return resp.node;
}

// ── sync step (called by the cron; advances one phase per invocation) ────────

const INGEST_LINES_PER_RUN = 40_000;

export async function runSyncStep(): Promise<{ phase: string; detail: string }> {
  const cfg = await loadCleanupConfig();
  const st: SyncState = { ...(cfg.sync_state ?? {}) };
  const phase = st.phase ?? 'idle';

  // ── idle → start products bulk export ─────────────────────────────────────
  if (phase === 'idle') {
    const q = `{ products(query: "created_at:>='${cfg.window_start}T00:00:00Z' AND created_at:<='${cfg.window_end}T23:59:59Z'") { edges { node { id title handle status productType createdAt tags } } } }`;
    const started = await startBulkOperation(q);
    if (started.error) {
      // Commonly: another bulk op already running on the shop — retry next tick.
      await saveSyncState({ ...st, phase: 'idle', last_error: started.error });
      return { phase: 'idle', detail: `start deferred: ${started.error}` };
    }
    await saveSyncState({ phase: 'products_running', bulk_op_id: started.id, last_error: undefined });
    return { phase: 'products_running', detail: `bulk export started ${started.id}` };
  }

  // ── products bulk running → poll ───────────────────────────────────────────
  if (phase === 'products_running') {
    const op = await pollBulkOperation(st.bulk_op_id!);
    if (op.status === 'COMPLETED') {
      if (!op.url) {
        // Zero results — nothing created in window.
        await saveSyncState({ phase: 'orders_running_start' as any });
        return await runSyncStep();
      }
      await saveSyncState({ phase: 'products_ingest', url: op.url, line_offset: 0 });
      return { phase: 'products_ingest', detail: `export ready (${op.objectCount} objects)` };
    }
    if (op.status === 'RUNNING' || op.status === 'CREATED') {
      return { phase: 'products_running', detail: `still ${op.status}` };
    }
    await saveSyncState({ phase: 'idle', last_error: `products bulk ${op.status} ${op.errorCode ?? ''}` });
    return { phase: 'idle', detail: `products bulk failed: ${op.status}` };
  }

  // ── products ingest (chunked, resumable) ───────────────────────────────────
  if (phase === 'products_ingest') {
    const res = await fetch(st.url!);
    if (!res.ok) throw new Error(`bulk download HTTP ${res.status}`);
    const lines = (await res.text()).split('\n').filter(Boolean);
    const start = st.line_offset ?? 0;
    const slice = lines.slice(start, start + INGEST_LINES_PER_RUN);
    const pattern = new RegExp(cfg.title_pattern, 'i');
    const protectedSet = new Set([...(cfg.protected_product_ids ?? []), MASTER_PRODUCT_ID]);

    const rows = slice.map(l => {
      const n = JSON.parse(l);
      const isProtected = protectedSet.has(n.id);
      const isPortrait = pattern.test(n.title ?? '');
      return {
        product_id: n.id,
        title: n.title ?? null,
        handle: n.handle ?? null,
        product_type: n.productType ?? null,
        tags: Array.isArray(n.tags) ? n.tags : null,
        product_status: n.status ?? null,
        shopify_created_at: n.createdAt ?? null,
        is_portrait: isPortrait,
        status: isProtected ? 'protected' : (isPortrait ? 'candidate' : 'excluded'),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('product_cleanup_candidates')
        .upsert(rows.slice(i, i + 500), { onConflict: 'product_id', ignoreDuplicates: true });
      if (error) throw new Error(`candidates upsert: ${error.message}`);
    }

    const next = start + slice.length;
    if (next >= lines.length) {
      await saveSyncState({ phase: 'orders_running_start' as any, counts: { ...(st.counts ?? {}), products_ingested: lines.length } });
      return { phase: 'orders_running_start', detail: `products ingested (${lines.length} total)` };
    }
    await saveSyncState({ ...st, line_offset: next });
    return { phase: 'products_ingest', detail: `ingested ${next}/${lines.length}` };
  }

  // ── start orders bulk export (sold ledger) ─────────────────────────────────
  if ((phase as string) === 'orders_running_start') {
    // Orders from just before the window start can contain window products.
    const from = new Date(new Date(cfg.window_start).getTime() - 30 * 86400_000).toISOString().slice(0, 10);
    const q = `{ orders(query: "created_at:>='${from}'") { edges { node { id lineItems { edges { node { product { id } } } } } } } }`;
    const started = await startBulkOperation(q);
    if (started.error) {
      await saveSyncState({ ...st, phase: 'orders_running_start' as any, last_error: started.error });
      return { phase: 'orders_running_start', detail: `start deferred: ${started.error}` };
    }
    await saveSyncState({ phase: 'orders_running', bulk_op_id: started.id, counts: st.counts });
    return { phase: 'orders_running', detail: `orders bulk started ${started.id}` };
  }

  if (phase === 'orders_running') {
    const op = await pollBulkOperation(st.bulk_op_id!);
    if (op.status === 'COMPLETED') {
      if (!op.url) {
        await saveSyncState({ phase: 'finalize', counts: st.counts });
        return await runSyncStep();
      }
      await saveSyncState({ phase: 'orders_ingest', url: op.url, line_offset: 0, counts: st.counts });
      return { phase: 'orders_ingest', detail: `orders export ready (${op.objectCount})` };
    }
    if (op.status === 'RUNNING' || op.status === 'CREATED') {
      return { phase: 'orders_running', detail: `still ${op.status}` };
    }
    await saveSyncState({ phase: 'idle', last_error: `orders bulk ${op.status} ${op.errorCode ?? ''}`, counts: st.counts });
    return { phase: 'idle', detail: `orders bulk failed: ${op.status}` };
  }

  if (phase === 'orders_ingest') {
    const res = await fetch(st.url!);
    if (!res.ok) throw new Error(`bulk download HTTP ${res.status}`);
    const lines = (await res.text()).split('\n').filter(Boolean);
    const start = st.line_offset ?? 0;
    const slice = lines.slice(start, start + INGEST_LINES_PER_RUN);

    const ids = new Set<string>();
    for (const l of slice) {
      const n = JSON.parse(l);
      const pid = n.product?.id;
      if (typeof pid === 'string' && pid.startsWith('gid://shopify/Product/')) ids.add(pid);
    }
    const idRows = Array.from(ids).map(product_id => ({ product_id }));
    for (let i = 0; i < idRows.length; i += 500) {
      const { error } = await db.from('sold_products')
        .upsert(idRows.slice(i, i + 500), { onConflict: 'product_id', ignoreDuplicates: true });
      if (error) throw new Error(`sold_products upsert: ${error.message}`);
    }

    const next = start + slice.length;
    if (next >= lines.length) {
      await saveSyncState({ phase: 'finalize', counts: { ...(st.counts ?? {}), order_lines: lines.length } });
      return { phase: 'finalize', detail: `orders ingested (${lines.length} lines)` };
    }
    await saveSyncState({ ...st, line_offset: next });
    return { phase: 'orders_ingest', detail: `ingested ${next}/${lines.length}` };
  }

  // ── finalize: flag sold, build batches ─────────────────────────────────────
  if (phase === 'finalize') {
    // Mark sold candidates (only non-terminal ones). Paged through the sold
    // ledger in chunks to stay inside PostgREST limits.
    for (let from = 0; ; from += 1000) {
      const { data: soldRows, error: soldErr } = await db.from('sold_products')
        .select('product_id').range(from, from + 999);
      if (soldErr) throw new Error(`sold_products page: ${soldErr.message}`);
      if (!soldRows || soldRows.length === 0) break;
      const idsPage: string[] = soldRows.map((r: any) => r.product_id);
      for (let i = 0; i < idsPage.length; i += 400) {
        await db.from('product_cleanup_candidates')
          .update({ sold: true, status: 'sold', batch_id: null })
          .in('product_id', idsPage.slice(i, i + 400))
          .in('status', ['candidate', 'queued']);
      }
      if (soldRows.length < 1000) break;
    }

    // Build batches from unsold portrait candidates without a batch.
    const { data: maxRow } = await db.from('product_cleanup_batches')
      .select('batch_number').order('batch_number', { ascending: false }).limit(1).maybeSingle();
    let batchNumber = (maxRow?.batch_number ?? 0) + 1;

    while (true) {
      const { data: eligible, error } = await db
        .from('product_cleanup_candidates')
        .select('id, shopify_created_at')
        .eq('status', 'candidate')
        .eq('is_portrait', true)
        .eq('sold', false)
        .is('batch_id', null)
        .order('shopify_created_at', { ascending: true })
        .limit(cfg.batch_size);
      if (error) throw new Error(`eligible select: ${error.message}`);
      if (!eligible || eligible.length === 0) break;

      const first = eligible[0].shopify_created_at?.slice(0, 7) ?? '';
      const last  = eligible[eligible.length - 1].shopify_created_at?.slice(0, 7) ?? '';
      const { data: batch, error: bErr } = await db.from('product_cleanup_batches')
        .insert({ batch_number: batchNumber, month_label: first === last ? first : `${first} → ${last}`, size: eligible.length, status: 'ready' })
        .select('id').single();
      if (bErr || !batch) throw new Error(`batch insert: ${bErr?.message}`);

      const ids = eligible.map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 400) {
        await db.from('product_cleanup_candidates')
          .update({ batch_id: batch.id, status: 'queued' })
          .in('id', ids.slice(i, i + 400));
      }
      batchNumber++;
    }

    await saveSyncState({ phase: 'idle', last_completed_at: new Date().toISOString(), counts: st.counts });
    return { phase: 'idle', detail: 'sync complete: sold flagged, batches built' };
  }

  return { phase, detail: 'unknown phase — reset to idle on next run' };
}

// ── deletion worker ──────────────────────────────────────────────────────────

const PRODUCT_DELETE = `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function runDeleteWorker(limit = 150, actor = 'cron'): Promise<{ processed: number; deleted: number; skipped: number; errors: number; batch?: number; detail?: string }> {
  const cfg = await loadCleanupConfig();
  if (!cfg.deletion_enabled) return { processed: 0, deleted: 0, skipped: 0, errors: 0, detail: 'deletion disabled (kill switch off)' };

  // Pick the batch being worked on: 'deleting' first, else oldest 'approved'.
  let { data: batch } = await db.from('product_cleanup_batches')
    .select('*').eq('status', 'deleting').order('batch_number').limit(1).maybeSingle();
  if (!batch) {
    const { data: approved } = await db.from('product_cleanup_batches')
      .select('*').eq('status', 'approved').order('batch_number').limit(1).maybeSingle();
    if (!approved) return { processed: 0, deleted: 0, skipped: 0, errors: 0, detail: 'no approved batch' };
    await db.from('product_cleanup_batches').update({ status: 'deleting' }).eq('id', approved.id).eq('status', 'approved');
    batch = { ...approved, status: 'deleting' };
  }

  const { data: rows, error } = await db.from('product_cleanup_candidates')
    .select('*').eq('batch_id', batch.id).eq('status', 'queued')
    .order('shopify_created_at', { ascending: true }).limit(limit);
  if (error) throw new Error(`worker select: ${error.message}`);

  if (!rows || rows.length === 0) {
    await db.from('product_cleanup_batches')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', batch.id).eq('status', 'deleting');
    return { processed: 0, deleted: 0, skipped: 0, errors: 0, batch: batch.batch_number, detail: 'batch complete' };
  }

  const protectedSet = new Set([...(cfg.protected_product_ids ?? []), MASTER_PRODUCT_ID]);
  const pattern = new RegExp(cfg.title_pattern, 'i');
  let deleted = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    // Re-check the kill switch every iteration so a mid-run flip halts instantly.
    const { data: liveCfg } = await db.from('product_cleanup_config').select('deletion_enabled').eq('id', 1).single();
    if (!liveCfg?.deletion_enabled) return { processed: deleted + skipped + errors, deleted, skipped, errors, batch: batch.batch_number, detail: 'halted: kill switch turned off' };

    const logBase = {
      product_id: row.product_id, title: row.title, handle: row.handle,
      shopify_created_at: row.shopify_created_at, batch_id: batch.id,
      batch_number: batch.batch_number, snapshot: row, deleted_by: actor,
    };

    // ── Hard guards, re-verified at delete time ─────────────────────────────
    const guard =
      protectedSet.has(row.product_id) ? 'protected product'
      : !row.is_portrait || !pattern.test(row.title ?? '') ? 'not a Magic Portrait'
      : null;
    if (!guard) {
      const { data: soldNow } = await db.from('sold_products').select('product_id').eq('product_id', row.product_id).maybeSingle();
      if (soldNow) {
        await db.from('product_cleanup_candidates').update({ status: 'sold', sold: true }).eq('id', row.id);
        await db.from('product_cleanup_log').insert({ ...logBase, result: 'skipped', error: 'sold (re-check at delete time)' });
        skipped++;
        continue;
      }
    } else {
      await db.from('product_cleanup_candidates').update({ status: guard === 'protected product' ? 'protected' : 'excluded', error: guard }).eq('id', row.id);
      await db.from('product_cleanup_log').insert({ ...logBase, result: 'skipped', error: guard });
      skipped++;
      continue;
    }

    // ── Delete ──────────────────────────────────────────────────────────────
    try {
      const resp = await shopifyGraphQL<{ productDelete: { deletedProductId: string | null; userErrors: { message: string }[] } }>(
        PRODUCT_DELETE, { input: { id: row.product_id } },
      );
      const errs = resp.productDelete?.userErrors ?? [];
      if (errs.length > 0 || !resp.productDelete?.deletedProductId) {
        const msg = errs.map(e => e.message).join('; ') || 'no deletedProductId returned';
        await db.from('product_cleanup_candidates').update({ status: 'error', error: msg }).eq('id', row.id);
        await db.from('product_cleanup_log').insert({ ...logBase, result: 'error', error: msg });
        errors++;
      } else {
        await db.from('product_cleanup_candidates').update({ status: 'deleted', deleted_at: new Date().toISOString(), error: null }).eq('id', row.id);
        await db.from('product_cleanup_log').insert({ ...logBase, result: 'deleted' });
        deleted++;
      }
    } catch (err) {
      const msg = (err as Error).message;
      await db.from('product_cleanup_candidates').update({ status: 'error', error: msg }).eq('id', row.id);
      await db.from('product_cleanup_log').insert({ ...logBase, result: 'error', error: msg });
      errors++;
    }
    await sleep(600); // ~1.6 deletes/sec — well inside Shopify limits
  }

  // Update batch counters.
  const { data: fresh } = await db.from('product_cleanup_batches').select('deleted_count, error_count').eq('id', batch.id).single();
  await db.from('product_cleanup_batches').update({
    deleted_count: (fresh?.deleted_count ?? 0) + deleted,
    error_count: (fresh?.error_count ?? 0) + errors,
  }).eq('id', batch.id);

  return { processed: rows.length, deleted, skipped, errors, batch: batch.batch_number };
}
