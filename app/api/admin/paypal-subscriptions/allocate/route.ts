import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { allocateLedgerRows } from '@/lib/paypal-allocate';

/**
 * POST /api/admin/paypal-subscriptions/allocate
 * Body: { ids: string[]; actor?: string }
 *
 * Manual allocation from the dashboard. Claims from pending OR failed so the
 * Retry button works. The shared allocateLedgerRows loop is concurrency-safe
 * (atomic claim before the Shopify mutation — no double-credit).
 */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { ids?: string[]; actor?: string } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter(x => typeof x === 'string') : [];
  const actor = body?.actor ?? user.email ?? 'admin';
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const results = await allocateLedgerRows(ids, actor, ['pending', 'failed']);
  return NextResponse.json({ results });
}
