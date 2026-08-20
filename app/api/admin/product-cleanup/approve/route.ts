import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Approve one batch for deletion. Requires the literal confirmation string —
// the worker only ever touches approved batches, and only while the kill
// switch is on.

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { batch_id, confirm } = await req.json();
  if (!batch_id) return NextResponse.json({ error: 'batch_id required' }, { status: 400 });
  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: "confirmation mismatch — type DELETE to approve" }, { status: 400 });
  }

  const { data, error } = await (supabaseAdmin as any)
    .from('product_cleanup_batches')
    .update({ status: 'approved', approved_by: user.email ?? user.id, approved_at: new Date().toISOString() })
    .eq('id', batch_id)
    .eq('status', 'ready')
    .select('batch_number, size');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = (data ?? [])[0];
  if (!row) return NextResponse.json({ error: 'batch not approvable (not in ready state)' }, { status: 409 });

  return NextResponse.json({ approved: true, batch_number: row.batch_number, size: row.size });
}
