import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';
import { debitStoreCredit } from '@/lib/store-credit';

// Migration-credit correction: the old system's balance migration ran more
// than once, posting duplicate migration credits in Mar–Apr 2026. This module
// scans the Membership 2025 members (membership_credit_members) for window
// credits, flags duplicates (every migration credit after the first; the
// normal $29.99 / $39.99 monthly allocations are never touched), and — once a
// row is explicitly approved AND the global kill switch is on — reverses the
// duplicate amount as a debit, posts a correction note on the customer, and
// refreshes the stored balance.

const WINDOW_START = '2026-03-01T00:00:00Z';
const WINDOW_END   = '2026-05-01T00:00:00Z'; // exclusive
// Normal monthly subscription allocations — never flagged as migration credits.
const NORMAL_AMOUNTS_CENTS = [2999, 3999];

export interface WindowCredit {
  tx_id: string;
  occurred_at: string;
  amount_cents: number;
  remaining_cents: number | null;
  normal: boolean;    // $29.99 / $39.99 monthly allocation
  duplicate: boolean; // migration credit after the first
}

// ── config ────────────────────────────────────────────────────────────────────

export interface MigrationFixConfig {
  reversal_enabled: boolean;
  scan_state: {
    // segment pass (phase absent): cursor over membership_credit_members
    cursor_customer_id?: string;
    done_at?: string;
    // store-wide pass: bulk_start → bulk_running → bulk_ingest → holders → done
    phase?: string;
    bulk_op_id?: string;
    url?: string;
    line_offset?: number;
    carry?: { id: string; email: string | null; name: string | null; balance_cents: number } | null;
  };
}

export async function loadFixConfig(): Promise<MigrationFixConfig> {
  const { data, error } = await (supabaseAdmin as any)
    .from('migration_fix_config').select('*').eq('id', 1).single();
  if (error || !data) throw new Error(`migration_fix_config load: ${error?.message ?? 'missing'}`);
  return data as MigrationFixConfig;
}

export async function saveScanState(state: MigrationFixConfig['scan_state']): Promise<void> {
  await (supabaseAdmin as any)
    .from('migration_fix_config')
    .update({ scan_state: state, updated_at: new Date().toISOString() })
    .eq('id', 1);
}

// ── scan ──────────────────────────────────────────────────────────────────────

interface HistoryResp {
  customer: {
    id: string;
    email: string | null;
    displayName: string | null;
    storeCreditAccounts: {
      edges: {
        node: {
          id: string;
          balance: { amount: string; currencyCode: string };
          transactions: {
            edges: {
              node: {
                __typename: string;
                id?: string | null;
                createdAt: string;
                amount: { amount: string };
                ['remainingAmount']?: { amount: string } | null;
              };
            }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      }[];
    };
  } | null;
}

const HISTORY_QUERY = `
  query CreditHistory($id: ID!, $after: String) {
    customer(id: $id) {
      id
      email
      displayName
      storeCreditAccounts(first: 5) {
        edges {
          node {
            id
            balance { amount currencyCode }
            transactions(first: 100, after: $after) {
              edges {
                node {
                  __typename
                  createdAt
                  amount { amount }
                  ... on StoreCreditAccountCreditTransaction {
                    id
                    remainingAmount { amount }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    }
  }
`;

export interface ScanOutcome {
  customerId: string;
  status: 'pending_review' | 'no_duplicates';
  duplicateCents: number;
}

/** Scan one customer: classify Mar–Apr 2026 credits and upsert the review row. */
export async function scanCustomer(customerId: string): Promise<ScanOutcome> {
  const credits: WindowCredit[] = [];
  let balanceCents = 0;
  let email: string | null = null;
  let displayName: string | null = null;

  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const res: HistoryResp = await shopifyGraphQL<HistoryResp>(HISTORY_QUERY, { id: customerId, after: cursor });
    const cust = res.customer;
    if (!cust) break;
    email = cust.email;
    displayName = cust.displayName;

    let more = false;
    balanceCents = 0;
    for (const acc of cust.storeCreditAccounts.edges) {
      balanceCents += Math.round(parseFloat(acc.node.balance.amount) * 100) || 0;
      for (const e of acc.node.transactions.edges) {
        if (!e.node.__typename.includes('CreditTransaction')) continue;
        if (e.node.createdAt < WINDOW_START || e.node.createdAt >= WINDOW_END) continue;
        const amountCents = Math.round(parseFloat(e.node.amount.amount) * 100) || 0;
        credits.push({
          tx_id:           e.node.id ?? `${e.node.createdAt}|${amountCents}`,
          occurred_at:     e.node.createdAt,
          amount_cents:    amountCents,
          remaining_cents: e.node.remainingAmount ? Math.round(parseFloat(e.node.remainingAmount.amount) * 100) : null,
          normal:          NORMAL_AMOUNTS_CENTS.includes(amountCents),
          duplicate:       false, // assigned below
        });
      }
      if (acc.node.transactions.pageInfo.hasNextPage) {
        more = true;
        cursor = acc.node.transactions.pageInfo.endCursor;
      }
    }
    if (!more) break;
  }

  // De-dupe by tx id (multi-account paging can revisit), oldest first.
  const seen = new Set<string>();
  const windowCredits = credits
    .filter(c => (seen.has(c.tx_id) ? false : (seen.add(c.tx_id), true)))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  // First NON-normal window credit = the legitimate migration; later ones are duplicates.
  let sawMigration = false;
  let duplicateCents = 0;
  for (const c of windowCredits) {
    if (c.normal) continue;
    if (!sawMigration) { sawMigration = true; continue; }
    c.duplicate = true;
    duplicateCents += c.amount_cents;
  }

  const proposed = Math.min(duplicateCents, balanceCents);
  const status: ScanOutcome['status'] = duplicateCents > 0 ? 'pending_review' : 'no_duplicates';

  const { error } = await (supabaseAdmin as any).from('migration_credit_review').upsert({
    customer_id:            customerId,
    email,
    display_name:           displayName,
    current_balance_cents:  balanceCents,
    migration_credits:      windowCredits,
    migration_credit_count: windowCredits.filter(c => !c.normal).length,
    duplicate_cents:        duplicateCents,
    proposed_debit_cents:   proposed,
    status,
    scanned_at:             new Date().toISOString(),
    updated_at:             new Date().toISOString(),
  }, { onConflict: 'customer_id' });
  if (error) throw new Error(`review upsert: ${error.message}`);

  return { customerId, status, duplicateCents };
}

// ── reversal ──────────────────────────────────────────────────────────────────

async function logFix(row: Record<string, unknown>): Promise<void> {
  await (supabaseAdmin as any).from('migration_credit_fix_log').insert(row);
}

interface BalanceResp {
  customer: {
    note: string | null;
    storeCreditAccounts: { edges: { node: { balance: { amount: string } } }[] };
  } | null;
}

export interface FixResult { customerId: string; status: string; detail?: string }

/**
 * Reverse one approved row: claim → re-check live balance → debit → customer
 * note → mark reversed → refresh membership_credit_members.
 */
export async function fixApprovedRow(row: {
  customer_id: string; email: string | null; proposed_debit_cents: number; attempts: number;
}): Promise<FixResult> {
  const { data: claimed } = await (supabaseAdmin as any)
    .from('migration_credit_review')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('customer_id', row.customer_id)
    .eq('status', 'approved')
    .select('customer_id');
  if (!claimed || claimed.length === 0) return { customerId: row.customer_id, status: 'not_claimable' };

  const terminal = async (status: string, patch: Record<string, unknown>) => {
    await (supabaseAdmin as any)
      .from('migration_credit_review')
      .update({ status, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...patch })
      .eq('customer_id', row.customer_id)
      .eq('status', 'processing');
  };

  if (!row.email) {
    await terminal('failed', { error: 'no email on review row', attempts: row.attempts + 1 });
    return { customerId: row.customer_id, status: 'failed', detail: 'no email' };
  }

  // Live balance + current note.
  let before: BalanceResp;
  try {
    before = await shopifyGraphQL<BalanceResp>(
      `query B($id: ID!) { customer(id: $id) { note storeCreditAccounts(first: 5) { edges { node { balance { amount } } } } } }`,
      { id: row.customer_id },
    );
  } catch (err) {
    await terminal('failed', { error: `balance fetch: ${(err as Error).message}`, attempts: row.attempts + 1 });
    return { customerId: row.customer_id, status: 'failed' };
  }
  const liveBalance = (before.customer?.storeCreditAccounts.edges ?? [])
    .reduce((s, e) => s + (Math.round(parseFloat(e.node.balance.amount) * 100) || 0), 0);

  const debitCents = Math.min(row.proposed_debit_cents, liveBalance);
  if (debitCents <= 0) {
    await terminal('skipped', { error: 'live balance is zero — nothing to reverse' });
    await logFix({ customer_id: row.customer_id, email: row.email, action: 'skipped_zero_balance', balance_before_cents: liveBalance });
    return { customerId: row.customer_id, status: 'skipped' };
  }

  const outcome = await debitStoreCredit({ email: row.email, amountCents: debitCents });
  if (!outcome.ok) {
    await terminal('failed', { error: `${outcome.reason}: ${outcome.detail}`, attempts: row.attempts + 1 });
    await logFix({ customer_id: row.customer_id, email: row.email, action: 'debit_failed', debit_cents: debitCents, balance_before_cents: liveBalance, error: `${outcome.reason}: ${outcome.detail}` });
    return { customerId: row.customer_id, status: 'failed', detail: outcome.detail };
  }

  // Correction note (appended to the customer's admin note).
  const today = new Date().toISOString().slice(0, 10);
  const noteText = `[Store credit correction ${today}] Reversed $${(debitCents / 100).toFixed(2)} duplicate migration credit(s) posted in Mar/Apr 2026 (balance migration ran more than once). One migration credit retained. Ref: ${outcome.creditReference}.`;
  try {
    const existingNote = before.customer?.note?.trim();
    await shopifyGraphQL(
      `mutation N($input: CustomerInput!) { customerUpdate(input: $input) { userErrors { message } } }`,
      { input: { id: row.customer_id, note: existingNote ? `${existingNote}\n\n${noteText}` : noteText } },
    );
  } catch (err) {
    // Note failure must not undo the debit — log and continue.
    await logFix({ customer_id: row.customer_id, email: row.email, action: 'note_failed', error: (err as Error).message });
  }

  const balanceAfter = liveBalance - debitCents;
  await terminal('reversed', { debit_reference: outcome.creditReference, balance_after_cents: balanceAfter, error: null });
  await logFix({
    customer_id: row.customer_id, email: row.email, action: 'reversed',
    debit_cents: debitCents, balance_before_cents: liveBalance, balance_after_cents: balanceAfter,
    debit_reference: outcome.creditReference, note_text: noteText,
  });

  // Keep the member list current (step 4).
  await (supabaseAdmin as any)
    .from('membership_credit_members')
    .update({ credit_cents: balanceAfter, computed_at: new Date().toISOString() })
    .eq('customer_id', row.customer_id);

  return { customerId: row.customer_id, status: 'reversed' };
}

// ── store-wide discovery (bulk export of all credit holders) ─────────────────
// Enumerates every customer with a store-credit balance via one Shopify bulk
// operation, filling store_credit_holders. The scan route then walks holders
// that have no migration_credit_review row yet (i.e. outside the already-
// scanned Membership 2025 segment).

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

export const HOLDERS_BULK_QUERY = `{
  customers {
    edges {
      node {
        id
        email
        displayName
        storeCreditAccounts {
          edges { node { id balance { amount currencyCode } } }
        }
      }
    }
  }
}`;

export async function startHoldersBulk(): Promise<{ id?: string; error?: string }> {
  const resp = await shopifyGraphQL<{
    bulkOperationRunQuery: { bulkOperation: { id: string; status: string } | null; userErrors: { message: string }[] };
  }>(BULK_RUN, { query: HOLDERS_BULK_QUERY });
  const errs = resp.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length > 0) return { error: errs.map(e => e.message).join('; ') };
  const id = resp.bulkOperationRunQuery?.bulkOperation?.id;
  return id ? { id } : { error: 'no bulk operation id returned' };
}

export async function pollHoldersBulk(id: string): Promise<{ status: string; url?: string | null; errorCode?: string | null; objectCount?: string }> {
  const resp = await shopifyGraphQL<{ node: { status: string; url: string | null; errorCode: string | null; objectCount: string } | null }>(BULK_POLL, { id });
  if (!resp.node) return { status: 'MISSING' };
  return resp.node;
}

type Carry = { id: string; email: string | null; name: string | null; balance_cents: number } | null;

/**
 * Ingest one chunk of the bulk JSONL (parent customer lines followed by their
 * storeCreditAccount child lines). Returns the next offset, the carried
 * in-progress customer (a parent whose children may continue in the next
 * chunk), and whether the file is exhausted.
 */
export async function ingestHoldersChunk(
  url: string,
  offset: number,
  carryIn: Carry,
  maxLines: number,
): Promise<{ nextOffset: number; carry: Carry; done: boolean; inserted: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bulk download HTTP ${res.status}`);
  const lines = (await res.text()).split('\n');

  let carry: Carry = carryIn;
  const rows: Array<{ customer_id: string; email: string | null; display_name: string | null; balance_cents: number }> = [];

  const flushCarry = () => {
    if (carry && carry.balance_cents > 0) {
      rows.push({ customer_id: carry.id, email: carry.email, display_name: carry.name, balance_cents: carry.balance_cents });
    }
    carry = null;
  };

  const end = Math.min(offset + maxLines, lines.length);
  let i = offset;
  for (; i < end; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }

    const id = typeof obj.id === 'string' ? obj.id : '';
    if (id.includes('/Customer/')) {
      flushCarry();
      carry = {
        id,
        email: typeof obj.email === 'string' ? obj.email : null,
        name: typeof obj.displayName === 'string' ? obj.displayName : null,
        balance_cents: 0,
      };
    } else if (id.includes('/StoreCreditAccount/') && carry) {
      const parent = obj.__parentId;
      if (typeof parent === 'string' && parent === carry.id) {
        const bal = (obj.balance as { amount?: string } | undefined)?.amount;
        carry.balance_cents += Math.round(parseFloat(bal ?? '0') * 100) || 0;
      }
    }
  }

  const done = i >= lines.length;
  if (done) flushCarry();

  let inserted = 0;
  for (let j = 0; j < rows.length; j += 500) {
    const { error } = await (supabaseAdmin as any)
      .from('store_credit_holders')
      .upsert(rows.slice(j, j + 500).map(r => ({ ...r, ingested_at: new Date().toISOString() })), { onConflict: 'customer_id' });
    if (error) throw new Error(`holders upsert: ${error.message}`);
    inserted += Math.min(500, rows.length - j);
  }

  return { nextOffset: i, carry: done ? null : carry, done, inserted };
}

/**
 * Next batch of holders that still need scanning: positive balance, no review
 * row yet (segment members already have one). Walks by customer_id cursor.
 */
export async function nextUnscannedHolders(cursor: string, batchSize: number): Promise<{ ids: string[]; lastCursor: string | null }> {
  const { data: holders, error } = await (supabaseAdmin as any)
    .from('store_credit_holders')
    .select('customer_id')
    .gt('customer_id', cursor)
    .gt('balance_cents', 0)
    .order('customer_id', { ascending: true })
    .limit(batchSize);
  if (error) throw new Error(`holders page: ${error.message}`);
  const list = (holders ?? []) as { customer_id: string }[];
  if (list.length === 0) return { ids: [], lastCursor: null };

  const ids = list.map(h => h.customer_id);
  const { data: existing, error: exErr } = await (supabaseAdmin as any)
    .from('migration_credit_review')
    .select('customer_id')
    .in('customer_id', ids);
  if (exErr) throw new Error(`review existence check: ${exErr.message}`);
  const have = new Set(((existing ?? []) as { customer_id: string }[]).map(r => r.customer_id));

  return { ids: ids.filter(id => !have.has(id)), lastCursor: ids[ids.length - 1] };
}
