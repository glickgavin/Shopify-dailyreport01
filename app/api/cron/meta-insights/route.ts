import { NextRequest, NextResponse } from 'next/server';
import { format, subDays } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchCampaignInsightsDaily } from '@/lib/meta';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Meta insights snapshot (every 4 hours): fetches per-campaign, per-day
// spend / purchases / attributed purchase revenue for the trailing 30 days
// in ONE ranged API call (time_increment=1) and upserts on (date, campaign).
// Re-upserting the whole window every run means late attribution updates
// self-correct and the first run backfills 30 days of history.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const daysParam = Number(req.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 30;

  const until = format(new Date(), 'yyyy-MM-dd');
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd');

  const rows = await fetchCampaignInsightsDaily(since, until);

  const dbRows = rows.map(r => ({
    date: r.date,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    purchases: r.purchases,
    revenue: r.revenue,
    fetched_at: new Date().toISOString(),
  }));
  for (let i = 0; i < dbRows.length; i += 500) {
    const { error } = await (supabaseAdmin as any)
      .from('meta_insights_daily')
      .upsert(dbRows.slice(i, i + 500), { onConflict: 'date,campaign_id' });
    if (error) return NextResponse.json({ error: `upsert: ${error.message}` }, { status: 500 });
  }

  const revenueTotal = rows.reduce((s, r) => s + (r.revenue ?? 0), 0);
  console.log(`[meta-insights] upserted ${rows.length} rows (${since} → ${until}), attributed revenue $${revenueTotal.toFixed(0)}`);
  return NextResponse.json({ status: 'ok', rows: rows.length, since, until });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
