import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminSessionUser } from '@/lib/admin-session';

/**
 * GET /api/admin/paypal-subscriptions
 *
 * Query params (all optional):
 *   from, to           — inclusive PT date range (YYYY-MM-DD)
 *   status             — 'pending' | 'allocated' | 'skipped' | 'refunded' | 'failed' | 'all'
 *   email              — substring match on payer or custom_field email
 *   limit, offset      — pagination (defaults: 100 / 0)
 *   summary            — when 'true', returns aggregate stats INSTEAD of rows
 *
 * Admin-session guarded: this exposes customer PII, so it must not be public.
 */
export async function GET(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const from    = p.get('from');
  const to      = p.get('to');
  const status  = p.get('status') ?? 'pending';
  const email   = p.get('email')?.trim() || null;
  const limit   = Math.min(parseInt(p.get('limit') ?? '100', 10) || 100, 500);
  const offset  = Math.max(parseInt(p.get('offset') ?? '0', 10) || 0, 0);
  const wantSummary = p.get('summary') === 'true';

  let query: any = (supabaseAdmin as any).from('paypal_subscription_ledger');

  if (wantSummary) {
    const buckets = ['pending','allocated','skipped','refunded','failed'] as const;
    const results = await Promise.all(buckets.map(async b => {
      let q: any = (supabaseAdmin as any)
        .from('paypal_subscription_ledger')
        .select('gross_cents', { count: 'exact' })
        .eq('credit_status', b);
      if (from) q = q.gte('pt_date', from);
      if (to)   q = q.lte('pt_date', to);
      if (email) q = q.or(`payer_email.ilike.%${email}%,custom_field_email.ilike.%${email}%`);
      const { data, count, error } = await q;
      if (error) throw error;
      const sum = (data ?? []).reduce((acc: number, r: { gross_cents: number }) => acc + (r.gross_cents ?? 0), 0);
      return [b, { count: count ?? 0, total_cents: sum }] as const;
    }));
    return NextResponse.json({ summary: Object.fromEntries(results) });
  }

  query = query.select('*', { count: 'exact' });
  if (status !== 'all') query = query.eq('credit_status', status);
  if (from)  query = query.gte('pt_date', from);
  if (to)    query = query.lte('pt_date', to);
  if (email) query = query.or(`payer_email.ilike.%${email}%,custom_field_email.ilike.%${email}%,credit_email.ilike.%${email}%`);
  query = query.order('initiated_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [], total: count ?? 0, limit, offset });
}
