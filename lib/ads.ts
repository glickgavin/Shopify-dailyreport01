const ADS_URL = process.env.ADS_SUPABASE_URL ?? 'https://byobvmimvacxuwumhbyw.supabase.co';
const ADS_KEY  = process.env.ADS_SUPABASE_KEY ?? 'sb_publishable_PbK4JVIxW8ugyqQBYd11BA_-vGQKKa_';

export interface AdsRow {
  report_date: string;
  spend: number;
  purchases: number;
  cpa: number;
  atcs: number | null;
  link_clicks: number | null;
  click_to_atc: number | null;
  atc_to_purchase: number | null;
}

export async function fetchAds(date: string): Promise<AdsRow | null> {
  try {
    const res = await fetch(
      `${ADS_URL}/rest/v1/meta_ads_daily_report?report_date=eq.${date}&limit=1`,
      { headers: { apikey: ADS_KEY, Authorization: `Bearer ${ADS_KEY}` }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const rows: AdsRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function fetchAdsRange(startDate: string, endDate: string): Promise<AdsRow | null> {
  try {
    const res = await fetch(
      `${ADS_URL}/rest/v1/meta_ads_daily_report?report_date=gte.${startDate}&report_date=lte.${endDate}&order=report_date`,
      { headers: { apikey: ADS_KEY, Authorization: `Bearer ${ADS_KEY}` }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const rows: AdsRow[] = await res.json();
    if (!rows.length) return null;

    let spend = 0, purchases = 0, atcs = 0, link_clicks = 0;
    let hasAtcs = false, hasClicks = false;
    for (const r of rows) {
      spend += r.spend;
      purchases += r.purchases;
      if (r.atcs != null) { atcs += r.atcs; hasAtcs = true; }
      if (r.link_clicks != null) { link_clicks += r.link_clicks; hasClicks = true; }
    }

    return {
      report_date: startDate,
      spend,
      purchases,
      cpa: purchases > 0 ? spend / purchases : 0,
      atcs: hasAtcs ? atcs : null,
      link_clicks: hasClicks ? link_clicks : null,
      click_to_atc: hasAtcs && hasClicks && link_clicks > 0 ? atcs / link_clicks : null,
      atc_to_purchase: hasAtcs && atcs > 0 ? purchases / atcs : null,
    };
  } catch {
    return null;
  }
}
