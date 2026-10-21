import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// Approve (or un-approve) review rows for reversal. Approving requires the
// literal confirmation string REVERSE; only pending_review rows transition.

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const ids: string[] = Array.isArray(body.customer_ids) ? body.customer_ids : [];
  if (ids.length === 0) return NextResponse.json({ error: 'customer_ids required' }, { status: 400 });

  if (body.action === 'unapprove') {
    const { data, error } = await (supabaseAdmin as any)
      .from('migration_credit_review')
      .update({ status: 'pending_review', updated_at: new Date().toISOString() })
      .in('customer_id', ids)
      .eq('status', 'approved')
      .select('customer_id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ unapproved: (data ?? []).length });
  }

  if (body.confirm !== 'REVERSE') {
    return NextResponse.json({ error: 'confirmation mismatch — type REVERSE to approve' }, { status: 400 });
  }

  const { data, error } = await (supabaseAdmin as any)
    .from('migration_credit_review')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .in('customer_id', ids)
    .eq('status', 'pending_review')
    .select('customer_id, email, proposed_debit_cents');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { customer_id: string; email: string | null; proposed_debit_cents: number }[];
  if (rows.length === 0) return NextResponse.json({ error: 'no approvable rows (none in pending_review)' }, { status: 409 });

  await (supabaseAdmin as any).from('migration_credit_fix_log').insert(rows.map(r => ({
    customer_id: r.customer_id,
    email: r.email,
    action: 'approved',
    debit_cents: r.proposed_debit_cents,
    note_text: `approved by ${user.email ?? user.id}`,
  })));

  return NextResponse.json({
    approved: rows.length,
    skipped: ids.length - rows.length,
    total_cents: rows.reduce((s, r) => s + r.proposed_debit_cents, 0),
  });
}
