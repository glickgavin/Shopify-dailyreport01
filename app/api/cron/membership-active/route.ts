import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Nightly "active members" snapshot: counts the members of the Shopify
// customer segment "Membership 2025" and totals their store-credit balances.
// One row per day in membership_active_snapshot, so the figure is also a
// trend over time.

const SEGMENT_ID = 'gid://shopify/Segment/482009710788'; // "Membership 2025"

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

interface SegmentPage {
  customerSegmentMembers: {
    totalCount: number;
    edges: { node: { id: string } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface CreditNodes {
  nodes: Array<{
    id: string;
    email: string | null;
    displayName: string | null;
    storeCreditAccounts: { edges: { node: { balance: { amount: string; currencyCode: string } } }[] };
  } | null>;
}

interface MemberCreditRow {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  credit_cents: number;
  currency: string | null;
  snapshot_date: string;
}

async function run(): Promise<NextResponse> {
  // 1. Collect all segment member ids (250/page).
  const customerIds: string[] = [];
  let totalCount = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const res: SegmentPage = await shopifyGraphQL<SegmentPage>(
      `query Members($seg: ID!, $after: String) {
        customerSegmentMembers(segmentId: $seg, first: 250, after: $after) {
          totalCount
          edges { node { id } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { seg: SEGMENT_ID, after: cursor },
    );
    const conn = res.customerSegmentMembers;
    totalCount = conn.totalCount;
    for (const e of conn.edges) {
      // CustomerSegmentMember ids share the customer's numeric id.
      const num = e.node.id.split('/').pop();
      if (num) customerIds.push(`gid://shopify/Customer/${num}`);
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  // 2. Sum store-credit balances in batches (100 keeps query cost in bounds),
  //    keeping a per-member breakdown for the drill-down table.
  const today = new Date().toISOString().slice(0, 10);
  let totalCents = 0;
  let accountsWithCredit = 0;
  const memberRows: MemberCreditRow[] = [];
  for (let i = 0; i < customerIds.length; i += 100) {
    const batch = customerIds.slice(i, i + 100);
    const res = await shopifyGraphQL<CreditNodes>(
      `query Credits($ids: [ID!]!) {
        nodes(ids: $ids) {
          id
          ... on Customer {
            email
            displayName
            storeCreditAccounts(first: 3) {
              edges { node { balance { amount currencyCode } } }
            }
          }
        }
      }`,
      { ids: batch },
    );
    for (const n of res.nodes) {
      if (!n || !('storeCreditAccounts' in n) || !n.storeCreditAccounts) continue;
      let customerCents = 0;
      let currency: string | null = null;
      for (const e of n.storeCreditAccounts.edges) {
        customerCents += Math.round(parseFloat(e.node.balance.amount) * 100) || 0;
        currency = currency ?? e.node.balance.currencyCode;
      }
      totalCents += customerCents;
      if (customerCents > 0) accountsWithCredit++;
      memberRows.push({
        customer_id:  n.id,
        email:        n.email ?? null,
        display_name: n.displayName ?? null,
        credit_cents: customerCents,
        currency,
        snapshot_date: today,
      });
    }
  }

  // Replace the breakdown table with this run's rows.
  await (supabaseAdmin as any).from('membership_credit_members').delete().neq('customer_id', '');
  for (let i = 0; i < memberRows.length; i += 500) {
    const { error: insErr } = await (supabaseAdmin as any)
      .from('membership_credit_members')
      .upsert(memberRows.slice(i, i + 500), { onConflict: 'customer_id' });
    if (insErr) return NextResponse.json({ error: `member rows: ${insErr.message}` }, { status: 500 });
  }

  const { error } = await (supabaseAdmin as any)
    .from('membership_active_snapshot')
    .upsert({
      date: today,
      member_count: totalCount || customerIds.length,
      store_credit_total_cents: totalCents,
      accounts_with_credit: accountsWithCredit,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'date' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.log(`[membership-active] ${today}: ${totalCount} members, $${(totalCents / 100).toFixed(2)} store credit (${accountsWithCredit} with balance)`);
  return NextResponse.json({ status: 'ok', date: today, members: totalCount, store_credit_cents: totalCents, accounts_with_credit: accountsWithCredit });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
