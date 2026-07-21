import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminSessionUser } from '@/lib/admin-session';

/**
 * POST /api/admin/paypal-subscriptions/skip
 * Body: { ids: string[]; reason?: string; actor?: string }
 *
 * Marks the given rows as 'skipped' without allocating credit.
 * Used for duplicates, test transactions, or cases handled manually.
 */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { ids?: string[]; reason?: string; actor?: string } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter(x => typeof x === 'string') : [];
  const reason = body?.reason?.trim() || 'skipped by operator';
  const actor = body?.actor ?? user.email ?? 'admin';
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const { data, error } = await (supabaseAdmin as any)
    .from('paypal_subscription_ledger')
    .update({
      credit_status: 'skipped',
      credit_notes: reason,
      credit_allocated_by: actor,
      credit_allocated_at: new Date().toISOString(),
    })
    .in('id', ids)
    .eq('credit_status', 'pending')
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: data?.length ?? 0 });
}
