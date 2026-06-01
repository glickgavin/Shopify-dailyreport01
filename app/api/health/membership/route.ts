export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('membership_metrics_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json({ status: 'degraded', reason: 'no rows' }, { status: 503 });
  }

  const ageMs = Date.now() - new Date(data.metric_date).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > 2) {
    return NextResponse.json(
      { status: 'degraded', reason: `last row is ${ageDays.toFixed(1)} days old`, metric_date: data.metric_date },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'operational', metric_date: data.metric_date });
}
