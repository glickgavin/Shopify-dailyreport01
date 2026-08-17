import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/admin-session';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const db = supabaseAdmin as any;

// GET: everything the admin page needs. POST: update the config row.

export async function GET() {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: config }, { data: invoices }, { data: refunds }, { data: logs }] = await Promise.all([
    db.from('stripe_credit_config').select('*').eq('id', 1).single(),
    db.from('stripe_credit_invoices').select('*').order('created_at', { ascending: false }).limit(200),
    db.from('stripe_credit_refunds').select('*').order('created_at', { ascending: false }).limit(100),
    db.from('stripe_credit_logs').select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  return NextResponse.json({ config, invoices: invoices ?? [], refunds: refunds ?? [], logs: logs ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.allocation_enabled === 'boolean') patch.allocation_enabled = body.allocation_enabled;
  if (Number.isInteger(body.allocation_percentage) && body.allocation_percentage >= 0 && body.allocation_percentage <= 100) {
    patch.allocation_percentage = body.allocation_percentage;
  }
  if (Number.isInteger(body.min_amount_cents) && body.min_amount_cents >= 0) patch.min_amount_cents = body.min_amount_cents;
  if (body.max_amount_cents === null || (Number.isInteger(body.max_amount_cents) && body.max_amount_cents > 0)) {
    patch.max_amount_cents = body.max_amount_cents;
  }
  if (Array.isArray(body.eligible_currencies) && body.eligible_currencies.every((c: unknown) => typeof c === 'string')) {
    patch.eligible_currencies = body.eligible_currencies.map((c: string) => c.toUpperCase());
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no valid fields' }, { status: 400 });

  patch.updated_at = new Date().toISOString();
  patch.updated_by = user.email ?? user.id;

  const { data, error } = await db.from('stripe_credit_config').update(patch).eq('id', 1).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
