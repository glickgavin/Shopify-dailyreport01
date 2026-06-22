import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  const { data, error } = await (supabaseAdmin as any).rpc('analytics_page_sessions', {
    p_from: from, p_to: to,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
