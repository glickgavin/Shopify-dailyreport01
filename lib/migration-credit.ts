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
  scan_state: { cursor_customer_id?: string; done_at?: string };
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
