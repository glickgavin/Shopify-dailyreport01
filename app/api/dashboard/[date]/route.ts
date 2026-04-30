import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { date: string } }) {
  const { date } = params;

  const [{ data: summary }, { data: products }, { data: memOrders }] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    supabaseAdmin.from('daily_products').select('*').eq('date', date).order('revenue', { ascending: false }),
    supabaseAdmin.from('daily_membership_orders').select('*').eq('date', date).order('order_name'),
  ]);

  if (!summary) {
    return NextResponse.json({ error: 'No data for this date' }, { status: 404 });
  }

  return NextResponse.json({ date, summary, products: products ?? [], memOrders: memOrders ?? [] });
}
