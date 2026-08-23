import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Approve one or many batches for deletion in a single call. Requires the
// literal confirmation string; only 'ready' batches are approvable. The
// worker processes approved batches oldest-first, back-to-back.

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const ids: string[] = Array.isArray(body.batch_ids)
    ? body.batch_ids
    : body.batch_id ? [body.batch_id] : [];
  if (ids.length === 0) return NextResponse.json({ error: 'batch_ids required' }, { status: 400 });
  if (body.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'confirmation mismatch — type DELETE to approve' }, { status: 400 });
  }

  const { data, error } = await (supabaseAdmin as any)
    .from('product_cleanup_batches')
    .update({ status: 'approved', approved_by: user.email ?? user.id, approved_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'ready')
    .select('batch_number, size');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { batch_number: number; size: number }[];
  if (rows.length === 0) return NextResponse.json({ error: 'no approvable batches (none in ready state)' }, { status: 409 });

  return NextResponse.json({
    approved: rows.length,
    skipped: ids.length - rows.length,
    batch_numbers: rows.map(r => r.batch_number).sort((a, b) => a - b),
    total_products: rows.reduce((s, r) => s + r.size, 0),
  });
}
