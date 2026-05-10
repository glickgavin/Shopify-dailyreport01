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
