import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const anchor = searchParams.get('anchor');
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');

  if (!anchor || !from || !to) return NextResponse.json({ error: 'anchor, from and to required' }, { status: 400 });

  const { data, error } = await supabaseAdmin.rpc('analytics_event_neighborhood', {
    p_anchor: anchor, p_from: from, p_to: to, p_depth: 3, p_top_n: 8,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
