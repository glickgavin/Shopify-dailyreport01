import { NextRequest, NextResponse } from 'next/server';
import { fetchCampaignInsights, fetchAdInsightsForCampaign } from '@/lib/meta';
import type { MetaPreset } from '@/lib/meta';

export const dynamic = 'force-dynamic';

const VALID: MetaPreset[] = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_30d'];

export async function GET(req: NextRequest) {
  const rangeParam = req.nextUrl.searchParams.get('range') ?? 'today';
  const range: MetaPreset = VALID.includes(rangeParam as MetaPreset) ? (rangeParam as MetaPreset) : 'today';

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 });
  }

  try {
    const campaigns = await fetchCampaignInsights(range);
    const ascMain   = campaigns.filter((c) => /asc/i.test(c.campaign_name) && !/test/i.test(c.campaign_name));
    const testing   = campaigns.filter((c) => !(/asc/i.test(c.campaign_name) && !/test/i.test(c.campaign_name)));

    const ads = testing.length > 0
      ? (await Promise.all(testing.map((c) => fetchAdInsightsForCampaign(c.campaign_id, range)))).flat()
      : [];

    const agg = (cs: typeof campaigns) => ({
      spend:             cs.reduce((s, c) => s + c.spend, 0),
      impressions:       cs.reduce((s, c) => s + c.impressions, 0),
      purchases:         cs.reduce((s, c) => s + c.purchases, 0),
    });

    return NextResponse.json({
      range,
      asc:     { kpis: agg(ascMain),  campaigns: ascMain },
      testing: { kpis: agg(testing),  campaigns: testing, ads },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
