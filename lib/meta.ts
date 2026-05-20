// Meta Graph API client — live campaign + ad insights

const GRAPH = `https://graph.facebook.com/${process.env.META_API_VERSION ?? 'v21.0'}`;
const ACCOUNT = process.env.META_AD_ACCOUNT_ID ?? '';
const TOKEN   = process.env.META_ACCESS_TOKEN  ?? '';

export type MetaPreset = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_30d';

const PRESET_FRESHNESS: Record<MetaPreset, number> = {
  today:     60,
  yesterday: 300,
  last_3d:   300,
  last_7d:   600,
  last_30d:  600,
};

export interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  status: string;
  spend: number;
  impressions: number;
  cpm: number;
  purchases: number;
  cost_per_purchase: number | null;
  purchase_roas: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
}

export type AdInsight = Omit<CampaignInsight, 'campaign_id' | 'campaign_name' | 'status'> & {
  ad_id: string;
  ad_name: string;
  effective_status: string;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function extractAction(actions: { action_type: string; value: string }[] | undefined, type: string): number {
  return Number(actions?.find((a) => a.action_type === type)?.value ?? 0);
}

function extractActionCost(
  costArr: { action_type: string; value: string }[] | undefined,
  type: string,
): number | null {
  const v = costArr?.find((a) => a.action_type === type)?.value;
  return v != null ? Number(v) : null;
}

async function fetchAllPages(url: string, revalidate: number): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next && pages < 5) {
    const res = await fetch(next, { next: { revalidate } });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string; code?: number; error_subcode?: number } };
      const e = err.error ?? {};
      throw new Error(`Meta API error ${e.code ?? res.status}${e.error_subcode ? `/${e.error_subcode}` : ''}: ${e.message ?? res.statusText}`);
    }
    const j = await res.json() as { data?: Record<string, unknown>[]; paging?: { next?: string } };
    all.push(...(j.data ?? []));
    next = j.paging?.next ?? null;
    pages++;
  }
  return all;
}

function buildInsightUrl(level: 'campaign' | 'ad', preset: MetaPreset, extraFilters: Record<string, unknown>[] = []): string {
  const baseFilters: Record<string, unknown>[] = [
    { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
    ...extraFilters,
  ];
  const fields = level === 'campaign'
    ? 'campaign_id,campaign_name,spend,impressions,cpm,clicks,ctr,cpc,actions,cost_per_action_type,purchase_roas'
    : 'ad_id,ad_name,effective_status,spend,impressions,cpm,clicks,ctr,cpc,actions,cost_per_action_type';

  const params = new URLSearchParams({
    level,
    date_preset: preset,
    fields,
    filtering: JSON.stringify(baseFilters),
    limit: '500',
    access_token: TOKEN,
  });
  return `${GRAPH}/act_${ACCOUNT}/insights?${params}`;
}

// ── public API ────────────────────────────────────────────────────────────────

export async function fetchCampaignInsights(preset: MetaPreset): Promise<CampaignInsight[]> {
  const ttl = PRESET_FRESHNESS[preset];
  const rows = await fetchAllPages(buildInsightUrl('campaign', preset), ttl);

  return rows.map((r) => {
    const actions    = r.actions    as { action_type: string; value: string }[] | undefined;
    const costArr    = r.cost_per_action_type as { action_type: string; value: string }[] | undefined;
    const roasArr    = r.purchase_roas as { action_type: string; value: string }[] | undefined;
    const purchases  = extractAction(actions, 'offsite_conversion.fb_pixel_purchase');
    const cpp        = extractActionCost(costArr, 'offsite_conversion.fb_pixel_purchase');
    const roasVal    = roasArr?.find((v) => v.action_type === 'offsite_conversion.fb_pixel_purchase')?.value;
    const roas       = roasVal != null ? Number(roasVal) : null;

    if (cpp !== null && roas === null) {
      console.warn(`[meta] campaign ${r.campaign_id}: cost_per_purchase present but purchase_roas null — investigate`);
    }

    return {
      campaign_id:       String(r.campaign_id ?? ''),
      campaign_name:     String(r.campaign_name ?? ''),
      status:            String(r.status ?? 'UNKNOWN'),
      spend:             Number(r.spend ?? 0),
      impressions:       Number(r.impressions ?? 0),
      cpm:               Number(r.cpm ?? 0),
      purchases,
      cost_per_purchase: cpp,
      purchase_roas:     roas,
      clicks:            r.clicks != null ? Number(r.clicks) : null,
      ctr:               r.ctr   != null ? Number(r.ctr)   : null,
      cpc:               r.cpc   != null ? Number(r.cpc)   : null,
    };
  });
}

export async function fetchAdInsightsForCampaign(campaignId: string, preset: MetaPreset): Promise<AdInsight[]> {
  const ttl = PRESET_FRESHNESS[preset];
  const extraFilters = [
    { field: 'ad.campaign_id',  operator: 'EQUAL',        value: campaignId },
    { field: 'ad.impressions',  operator: 'GREATER_THAN', value: '0' },
  ];
  const rows = await fetchAllPages(buildInsightUrl('ad', preset, extraFilters), ttl);

  return rows.map((r) => {
    const actions   = r.actions as { action_type: string; value: string }[] | undefined;
    const costArr   = r.cost_per_action_type as { action_type: string; value: string }[] | undefined;
    const purchases = extractAction(actions, 'offsite_conversion.fb_pixel_purchase');
    const cpp       = extractActionCost(costArr, 'offsite_conversion.fb_pixel_purchase');
    return {
      ad_id:             String(r.ad_id ?? ''),
      ad_name:           String(r.ad_name ?? ''),
      effective_status:  String(r.effective_status ?? 'UNKNOWN'),
      spend:             Number(r.spend ?? 0),
      impressions:       Number(r.impressions ?? 0),
      cpm:               Number(r.cpm ?? 0),
      purchases,
      cost_per_purchase: cpp,
      purchase_roas:     null,
      clicks:            r.clicks != null ? Number(r.clicks) : null,
      ctr:               r.ctr   != null ? Number(r.ctr)   : null,
      cpc:               r.cpc   != null ? Number(r.cpc)   : null,
    };
  });
}
