import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRangeRaw } from '@/lib/ads';
import { memberLtv } from '@/lib/business-rules';
import HistoryPeriodTable from './HistoryPeriodTable';
import HistoryCharts from './HistoryCharts';
import HistoryTable from './HistoryTable';

export const revalidate = 3600;

export type HistoryRow = {
  date: string;
  total_revenue: number;
  total_net_sales: number;
  total_orders: number;
  total_margin: number;
  total_aov: number;
  total_profit: number;
  phys_cash_revenue: number;
  phys_non_cash_revenue: number;
  mem_revenue: number;
  mem_orders: number;
  amazon_revenue: number;
  // Profit views: GP = gross profit, GP − Ads = after ad spend,
  // GP − Ads + LTV = after ad spend plus new-member LTV.
  ad_spend: number;
  new_members: number;
  gross_profit: number;
  gp_ads: number;
  gp_ads_ltv: number;
};

export type PeriodStats = {
  revenue: number;
  orders: number;
  aov: number;
  margin: number;
  grossProfit: number;
  gp: number;      // GP − Ads
  gpLtv: number;   // GP − Ads + LTV
};

export type PeriodEntry = {
  label: string;
  days: number;
  current: PeriodStats;
  prior: PeriodStats | null;
};

function aggregate(slice: HistoryRow[]): PeriodStats {
  const revenue  = slice.reduce((s, r) => s + r.total_revenue, 0);
  const orders   = slice.reduce((s, r) => s + r.total_orders, 0);
  const profit   = slice.reduce((s, r) => s + r.total_profit, 0);
  const adSpend  = slice.reduce((s, r) => s + r.ad_spend, 0);
  const ltv      = memberLtv(slice.reduce((s, r) => s + r.new_members, 0));
  return {
    revenue,
    orders,
    aov:         orders > 0 ? revenue / orders : 0,
    margin:      revenue > 0 ? (profit / revenue) * 100 : 0,
    grossProfit: profit,
    gp:          profit - adSpend,
    gpLtv:       profit - adSpend + ltv,
  };
}

export default async function HistoryPage() {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 61);
  const startDate = sixtyDaysAgo.toISOString().slice(0, 10);
  const today     = new Date().toISOString().slice(0, 10);

  const [{ data: rows }, adsRaw, { data: memRows }] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('date,total_revenue,total_net_sales,total_orders,total_margin,total_aov,total_profit,phys_cash_revenue,phys_non_cash_revenue,mem_revenue,mem_orders,amazon_revenue')
      .gte('date', startDate)
      .order('date', { ascending: false }),
    fetchAdsRangeRaw(startDate, today),
    supabaseAdmin
      .from('daily_membership_orders')
      .select('date,membership_type')
      .gte('date', startDate),
  ]);

  // Build ad spend lookup: date → spend
  const adsByDate = new Map<string, number>(
    adsRaw.map((r) => [r.report_date, r.spend]),
  );

  // New-member count per date (for LTV): count membership_type = 'new'.
  const newMembersByDate = new Map<string, number>();
  for (const m of memRows ?? []) {
    if (m.membership_type === 'new') {
      newMembersByDate.set(m.date, (newMembersByDate.get(m.date) ?? 0) + 1);
    }
  }

  const allRows: HistoryRow[] = (rows ?? []).map((r) => {
    const adSpend    = adsByDate.get(r.date) ?? 0;
    const newMembers = newMembersByDate.get(r.date) ?? 0;
    const grossProfit = r.total_profit ?? 0;
    const gpAds       = grossProfit - adSpend;
    return {
      date:                  r.date,
      total_revenue:         r.total_revenue         ?? 0,
      total_net_sales:       r.total_net_sales        ?? 0,
      total_orders:          r.total_orders           ?? 0,
      total_margin:          r.total_margin           ?? 0,
      total_aov:             r.total_aov              ?? 0,
      total_profit:          grossProfit,
      phys_cash_revenue:     r.phys_cash_revenue      ?? 0,
      phys_non_cash_revenue: r.phys_non_cash_revenue  ?? 0,
      mem_revenue:           r.mem_revenue            ?? 0,
      mem_orders:            r.mem_orders             ?? 0,
      amazon_revenue:        r.amazon_revenue         ?? 0,
      ad_spend:              adSpend,
      new_members:           newMembers,
      gross_profit:          grossProfit,
      gp_ads:                gpAds,
      gp_ads_ltv:            gpAds + memberLtv(newMembers),
    };
  });

  // rows are newest-first; slice into periods
  const periods: PeriodEntry[] = [1, 3, 7, 30].map((n) => ({
    label:   n === 1 ? '1D' : n === 3 ? '3D' : n === 7 ? '7D' : '30D',
    days:    n,
    current: aggregate(allRows.slice(0, n)),
    prior:   allRows.length >= n * 2 ? aggregate(allRows.slice(n, n * 2)) : null,
  }));

  const chartRows = [...allRows].slice(0, 30).reverse(); // oldest-first for charts
  const tableRows = allRows.slice(0, 30);                // newest-first for table

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            Sales <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>History</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Last 30 days · click any date to open daily dashboard
          </div>
        </div>
        <Link href="/dashboard" style={{
          background: 'var(--neutral-100)', color: 'var(--neutral-700)',
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '0.4rem 0.875rem', fontSize: '0.8rem',
          textDecoration: 'none', fontFamily: 'var(--font-mono)',
        }}>
          ← Dashboard
        </Link>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

        {/* Section 1 — Period comparison table */}
        <HistoryPeriodTable periods={periods} />

        {/* Section 2 — Charts */}
        <HistoryCharts rows={chartRows} />

        {/* Section 3 — Day list */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem' }}>
          <HistoryTable rows={tableRows} />
        </div>

      </div>
    </div>
  );
}

