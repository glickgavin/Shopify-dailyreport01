import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const anchor = searchParams.get('anchor');
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');
  const exclude = searchParams.get('exclude'); // comma-separated labels

  if (!anchor || !from || !to) return NextResponse.json({ error: 'anchor, from and to required' }, { status: 400 });

  const excludeLabels = exclude
    ? exclude.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('analytics_event_neighborhood', {
    p_anchor: anchor,
    p_from: from,
    p_to: to,
    p_depth: 3,
    p_top_n: 5, // reduced from 8 — less noise, top events more readable
    p_exclude_labels: excludeLabels,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
