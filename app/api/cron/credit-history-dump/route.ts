import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Investigation helper: dumps the full store-credit transaction history for
// the top-N balances in membership_credit_members into
// store_credit_history_dump. ?limit= overrides the default 10. The table is
// replaced on each run.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

interface TxPage {
  customer: {
    id: string;
    email: string | null;
    storeCreditAccounts: {
      edges: {
        node: {
          id: string;
          transactions: {
            edges: {
              node: {
                __typename: string;
                createdAt: string;
                amount: { amount: string; currencyCode: string };
                balanceAfterTransaction: { amount: string } | null;
              };
            }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      }[];
    };
  } | null;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const limitParam = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam >= 1 && limitParam <= 50 ? limitParam : 10;

  const { data: top, error: topErr } = await (supabaseAdmin as any)
    .from('membership_credit_members')
    .select('customer_id, email, credit_cents')
    .order('credit_cents', { ascending: false })
    .limit(limit);
  if (topErr) return NextResponse.json({ error: topErr.message }, { status: 500 });

  const rows: Record<string, unknown>[] = [];

  for (const member of (top ?? []) as { customer_id: string; email: string | null }[]) {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: TxPage = await shopifyGraphQL<TxPage>(
        `query CreditHistory($id: ID!, $after: String) {
          customer(id: $id) {
            id
            email
            storeCreditAccounts(first: 5) {
              edges {
                node {
                  id
                  transactions(first: 100, after: $after) {
                    edges {
                      node {
                        __typename
                        createdAt
                        amount { amount currencyCode }
                        balanceAfterTransaction { amount }
                      }
                    }
                    pageInfo { hasNextPage endCursor }
                  }
                }
              }
            }
          }
        }`,
        { id: member.customer_id, after: cursor },
      );
      const accounts = res.customer?.storeCreditAccounts.edges ?? [];
      let more = false;
      for (const acc of accounts) {
        for (const e of acc.node.transactions.edges) {
          rows.push({
            customer_id:         member.customer_id,
            email:               res.customer?.email ?? member.email,
            account_id:          acc.node.id,
            occurred_at:         e.node.createdAt,
            tx_type:             e.node.__typename,
            amount_cents:        Math.round(parseFloat(e.node.amount.amount) * 100) || 0,
            balance_after_cents: e.node.balanceAfterTransaction
              ? Math.round(parseFloat(e.node.balanceAfterTransaction.amount) * 100)
              : null,
          });
        }
        if (acc.node.transactions.pageInfo.hasNextPage) {
          more = true;
          cursor = acc.node.transactions.pageInfo.endCursor;
        }
      }
      if (!more) break;
    }
  }

  await (supabaseAdmin as any).from('store_credit_history_dump').delete().neq('customer_id', '');
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabaseAdmin as any).from('store_credit_history_dump').insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[credit-history-dump] ${rows.length} transactions across ${(top ?? []).length} customers`);
  return NextResponse.json({ status: 'ok', customers: (top ?? []).length, transactions: rows.length });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
