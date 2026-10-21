import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Review data for /dashboard/admin/credit-correction: config, status counts,
// and the review rows (filterable by status; biggest duplicates first).

export async function GET(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? 'pending_review';

  const [cfgRes, countsRes] = await Promise.all([
    (supabaseAdmin as any).from('migration_fix_config').select('reversal_enabled, scan_state').eq('id', 1).single(),
    (supabaseAdmin as any).from('migration_credit_review').select('status, duplicate_cents, proposed_debit_cents'),
  ]);
  if (cfgRes.error) return NextResponse.json({ error: cfgRes.error.message }, { status: 500 });
  if (countsRes.error) return NextResponse.json({ error: countsRes.error.message }, { status: 500 });

  const counts: Record<string, number> = {};
  let flaggedDup = 0, flaggedProposed = 0;
  for (const r of (countsRes.data ?? []) as { status: string; duplicate_cents: number; proposed_debit_cents: number }[]) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === 'pending_review' || r.status === 'approved' || r.status === 'processing') {
      flaggedDup += r.duplicate_cents;
      flaggedProposed += r.proposed_debit_cents;
    }
  }

  let query = (supabaseAdmin as any)
    .from('migration_credit_review')
    .select('*')
    .order('duplicate_cents', { ascending: false })
    .limit(500);
  if (status !== 'all') query = query.eq('status', status);
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    config: cfgRes.data,
    counts,
    outstanding_duplicate_cents: flaggedDup,
    outstanding_proposed_cents: flaggedProposed,
    rows: rows ?? [],
  });
}
