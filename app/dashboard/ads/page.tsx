import Link from 'next/link';
import { format, subDays, parseISO, getDay, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRangeRaw } from '@/lib/ads';
import type { AdsRow } from '@/lib/ads';
import { fmt, fmtDec, SectionLabel } from '../_components/cards';
import AdChart from './AdChart';
import type { ChartDay } from './AdChart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── types ─────────────────────────────────────────────────────────────────────

interface SummaryRow {
  date: string;
  total_orders: number;
  total_revenue: number;
  phys_cash_orders: number;
  phys_non_cash_orders: number;
  amazon_orders: number;
}

interface PeriodStats {
  spend: number;
  purchases: number;
  orders: number;
  productOrders: number;
  revenue: number;
  cpaM: number | null;
  cpaB: number | null;
  roas: number | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sliceAds(rows: AdsRow[], start: string, end: string): AdsRow[] {
  return rows.filter((r) => r.report_date >= start && r.report_date <= end);
}

function sliceSummary(rows: SummaryRow[], start: string, end: string): SummaryRow[] {
  return rows.filter((r) => r.date >= start && r.date <= end);
}

function periodStats(adsSlice: AdsRow[], sumSlice: SummaryRow[]): PeriodStats {
  const spend         = adsSlice.reduce((s, r) => s + (r.spend     ?? 0), 0);
  const purchases     = adsSlice.reduce((s, r) => s + (r.purchases ?? 0), 0);
  const orders        = sumSlice.reduce((s, r) => s + (r.total_orders        ?? 0), 0);
  const productOrders = sumSlice.reduce((s, r) => s + (r.phys_cash_orders ?? 0) + (r.phys_non_cash_orders ?? 0) + (r.amazon_orders ?? 0), 0);
  const revenue       = sumSlice.reduce((s, r) => s + (r.total_revenue       ?? 0), 0);
  return {
    spend,
    purchases,
    orders,
    productOrders,
    revenue,
    cpaM: spend > 0 && purchases    > 0 ? spend / purchases    : null,
    cpaB: spend > 0 && productOrders > 0 ? spend / productOrders : null,
    roas: spend > 0                      ? revenue / spend        : null,
  };
}

function trendPct(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function TrendBadge({ pct, inverted = false }: { pct: number | null; inverted?: boolean }) {
  if (pct === null) return <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>;
  const up = pct >= 0;
  const good = inverted ? !up : up;
  return (
    <span style={{
      fontSize: '0.72rem',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      color: good ? '#1D9E75' : '#e53e3e',
    }}>
      {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── page ─────────────────────────────────────────────────────────────────────

export default async function AdReportPage() {
  const todayStr     = format(new Date(), 'yyyy-MM-dd');
  const yestStr      = format(subDays(new Date(), 1),  'yyyy-MM-dd');
  const d2str        = format(subDays(new Date(), 2),  'yyyy-MM-dd'); // day-before-yesterday (yesterday prior)
  const d3str        = format(subDays(new Date(), 3),  'yyyy-MM-dd'); // 3d start
  const d4str        = format(subDays(new Date(), 4),  'yyyy-MM-dd'); // 3d prior end
  const d6str        = format(subDays(new Date(), 6),  'yyyy-MM-dd'); // 3d prior start
  const d7str        = format(subDays(new Date(), 7),  'yyyy-MM-dd'); // 7d start
  const d8str        = format(subDays(new Date(), 8),  'yyyy-MM-dd'); // 7d prior end
  const d14str       = format(subDays(new Date(), 14), 'yyyy-MM-dd'); // 7d prior start
  const d30str       = format(subDays(new Date(), 30), 'yyyy-MM-dd'); // 30d start + DoW start
  const d31str       = format(subDays(new Date(), 31), 'yyyy-MM-dd'); // 30d prior end
  const d60str       = format(subDays(new Date(), 60), 'yyyy-MM-dd'); // 30d prior start
  const d65str       = format(subDays(new Date(), 65), 'yyyy-MM-dd'); // chart window start
  const d80str       = format(subDays(new Date(), 80), 'yyyy-MM-dd'); // fetch window start (covers 10 weeks + prior)

  // Fetch 81 days of raw data (covers chart + all prior periods + 10-week table with prior)
  const [adsRaw, { data: summaryRaw }] = await Promise.all([
    fetchAdsRangeRaw(d80str, todayStr),
    supabaseAdmin
      .from('daily_summary')
      .select('date,total_orders,total_revenue,phys_cash_orders,phys_non_cash_orders,amazon_orders')
      .gte('date', d80str)
      .lte('date', todayStr)
      .order('date', { ascending: true }),
  ]);

  const sumRows = (summaryRaw ?? []) as SummaryRow[];

  // ── period stats ─────────────────────────────────────────────────────────
  const periods = [
    {
      label: 'Today',
      curr: periodStats(sliceAds(adsRaw, todayStr, todayStr), sliceSummary(sumRows, todayStr, todayStr)),
      prev: periodStats(sliceAds(adsRaw, yestStr,  yestStr),  sliceSummary(sumRows, yestStr,  yestStr)),
    },
    {
      label: 'Yesterday',
      curr: periodStats(sliceAds(adsRaw, yestStr, yestStr), sliceSummary(sumRows, yestStr, yestStr)),
      prev: periodStats(sliceAds(adsRaw, d2str,   d2str),   sliceSummary(sumRows, d2str,   d2str)),
    },
    {
      label: '3 Days',
      curr: periodStats(sliceAds(adsRaw, d3str, yestStr), sliceSummary(sumRows, d3str, yestStr)),
      prev: periodStats(sliceAds(adsRaw, d6str, d4str),   sliceSummary(sumRows, d6str, d4str)),
    },
    {
      label: '7 Days',
      curr: periodStats(sliceAds(adsRaw, d7str,  yestStr), sliceSummary(sumRows, d7str,  yestStr)),
      prev: periodStats(sliceAds(adsRaw, d14str, d8str),   sliceSummary(sumRows, d14str, d8str)),
    },
    {
      label: '30 Days',
      curr: periodStats(sliceAds(adsRaw, d30str, yestStr), sliceSummary(sumRows, d30str, yestStr)),
      prev: periodStats(sliceAds(adsRaw, d60str, d31str),  sliceSummary(sumRows, d60str, d31str)),
    },
  ];

  // ── weekly stats (current week + 9 prior) ────────────────────────────────
  const currentWeekMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekRows = Array.from({ length: 10 }, (_, i) => {
    const wMon      = addWeeks(currentWeekMonday, -i);
    const wSun      = i === 0 ? new Date() : endOfWeek(wMon, { weekStartsOn: 1 });
    const wStartStr = format(wMon,  'yyyy-MM-dd');
    const wEndStr   = format(wSun,  'yyyy-MM-dd');
    const label     = i === 0
      ? `${format(wMon, 'MMM d')} – today`
      : `${format(wMon, 'MMM d')} – ${format(wSun, 'MMM d')}`;

    const prevMon      = addWeeks(wMon, -1);
    const prevSun      = endOfWeek(prevMon, { weekStartsOn: 1 });
    const prevStartStr = format(prevMon, 'yyyy-MM-dd');
    const prevEndStr   = format(prevSun,  'yyyy-MM-dd');

    const curr = periodStats(sliceAds(adsRaw, wStartStr, wEndStr),    sliceSummary(sumRows, wStartStr, wEndStr));
    const prev = periodStats(sliceAds(adsRaw, prevStartStr, prevEndStr), sliceSummary(sumRows, prevStartStr, prevEndStr));
    return { label, curr, prev };
  });

  // ── chart data (last 60 days) ─────────────────────────────────────────────
  const adsMap = new Map(adsRaw.map((r) => [r.report_date, r]));

  const chartDays: ChartDay[] = [];
  for (let i = 59; i >= 0; i--) {
    const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
    const row = adsMap.get(d);
    chartDays.push({
      date: format(parseISO(d), 'MMM d'),
      spend:    row ? row.spend : null,
      cpaDaily: row && row.purchases > 0 ? row.spend / row.purchases : null,
      cpa5d:    null, // computed below
    });
  }

  // 5-day trailing rolling CPA
  for (let i = 0; i < chartDays.length; i++) {
    const window = chartDays.slice(Math.max(0, i - 4), i + 1);
    const ws = window.reduce((s, d) => s + (d.spend ?? 0), 0);
    const wp = window.reduce((s, d) => {
      const key = format(subDays(new Date(), 59 - (chartDays.indexOf(d))), 'yyyy-MM-dd');
      return s + (adsMap.get(key)?.purchases ?? 0);
    }, 0);
    chartDays[i].cpa5d = ws > 0 && wp > 0 ? ws / wp : null;
  }

  // ── funnel (7d) ───────────────────────────────────────────────────────────
  const funnel7d = sliceAds(adsRaw, d7str, yestStr);
  const fSpend     = funnel7d.reduce((s, r) => s + r.spend,    0);
  const fPurchases = funnel7d.reduce((s, r) => s + r.purchases, 0);
  const fAtcs      = funnel7d.reduce((s, r) => s + (r.atcs        ?? 0), 0);
  const fClicks    = funnel7d.reduce((s, r) => s + (r.link_clicks ?? 0), 0);
  const hasAtcs    = funnel7d.some((r) => r.atcs != null);
  const hasClicks  = funnel7d.some((r) => r.link_clicks != null);
  const fCtoA      = hasAtcs && hasClicks && fClicks > 0 ? fAtcs / fClicks : null;
  const fAtoP      = hasAtcs && fAtcs > 0 ? fPurchases / fAtcs : null;

  // ── day-of-week breakdown (last 30d) ──────────────────────────────────────
  const dow30 = sliceAds(adsRaw, d30str, yestStr);
  const dowMap = new Map<number, { spend: number; purchases: number; days: number }>();
  for (let d = 0; d <= 6; d++) dowMap.set(d, { spend: 0, purchases: 0, days: 0 });
  for (const r of dow30) {
    const d = getDay(parseISO(r.report_date));
    const e = dowMap.get(d)!;
    e.spend     += r.spend;
    e.purchases += r.purchases;
    e.days      += 1;
  }
  const dowRows = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const e = dowMap.get(d)!;
    const avgSpend = e.days > 0 ? e.spend     / e.days : 0;
    const avgPurch = e.days > 0 ? e.purchases / e.days : 0;
    const avgCpa   = avgSpend > 0 && avgPurch > 0 ? avgSpend / avgPurch : null;
    return { label: DOW_LABELS[d], avgSpend, avgPurch, avgCpa, days: e.days };
  });
  const bestDow  = dowRows.reduce((b, r) => (!b || (r.avgCpa !== null && b.avgCpa !== null && r.avgCpa < b.avgCpa)) ? r : b);
  const worstDow = dowRows.reduce((b, r) => (!b || (r.avgCpa !== null && b.avgCpa !== null && r.avgCpa > b.avgCpa)) ? r : b);

  const hasAnyData = adsRaw.length > 0;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
            Ad <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Report</em>
          </h1>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)' }}>
            Meta · as of {todayStr}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/dashboard" style={{ background: 'var(--neutral-100)', color: 'var(--neutral-700)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>Daily</Link>
          <Link href="/dashboard/range" style={{ background: 'var(--neutral-100)', color: 'var(--neutral-700)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>Range</Link>
        </div>
      </div>

      {!hasAnyData && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          No ad data found for the past 65 days.
        </div>
      )}

      {hasAnyData && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

          {/* ── SUMMARY TABLE ───────────────────────────────────────────── */}
          <SectionLabel>Performance by Period</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            marginBottom: '2rem',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Period', 'Spend', 'Purchases', 'Blended Orders', 'CPA (Meta)', 'CPA (Blended)', 'ROAS', 'vs Prior'].map((h) => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem',
                      textAlign: h === 'Period' ? 'left' : 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map(({ label, curr, prev }, i) => {
                  const trendCpa = trendPct(curr.cpaM, prev.cpaM);
                  return (
                    <tr key={label} style={{
                      borderBottom: i < periods.length - 1 ? '1px solid var(--border)' : 'none',
                      background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
                    }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{label}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {curr.spend > 0 ? fmt(curr.spend) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {curr.purchases > 0 ? curr.purchases : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#6b7280' }}>
                        {curr.productOrders > 0 ? curr.productOrders : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#1d4ed8' }}>
                        {curr.cpaM !== null ? fmtDec(curr.cpaM) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#6b7280' }}>
                        {curr.cpaB !== null ? fmtDec(curr.cpaB) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: curr.roas !== null && curr.roas >= 1 ? '#1D9E75' : '#e53e3e' }}>
                        {curr.roas !== null ? `${curr.roas.toFixed(2)}×` : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <TrendBadge pct={trendCpa} inverted />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: '0.5rem 1rem', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              CPA (Meta) = ad spend ÷ Meta-attributed purchases · Blended Orders = cash + non-cash + Amazon product orders (excl. memberships &amp; internal) · CPA (Blended) = ad spend ÷ blended orders · ROAS = Shopify revenue ÷ ad spend · vs Prior compares CPA (Meta) to equivalent prior period
            </div>
          </div>

          {/* ── WEEKLY TABLE ────────────────────────────────────────────── */}
          <SectionLabel>Performance by Week</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            marginBottom: '2rem',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Week', 'Spend', 'Purchases', 'Blended Orders', 'CPA (Meta)', 'CPA (Blended)', 'ROAS', 'vs Prior'].map((h) => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem',
                      textAlign: h === 'Week' ? 'left' : 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekRows.map(({ label, curr, prev }, i) => {
                  const trendCpa = trendPct(curr.cpaM, prev.cpaM);
                  return (
                    <tr key={label} style={{
                      borderBottom: i < weekRows.length - 1 ? '1px solid var(--border)' : 'none',
                      background: i === 0 ? 'rgba(99,102,241,0.04)' : i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
                    }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: i === 0 ? 700 : 500, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{label}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {curr.spend > 0 ? fmt(curr.spend) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {curr.purchases > 0 ? curr.purchases : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#6b7280' }}>
                        {curr.productOrders > 0 ? curr.productOrders : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#1d4ed8' }}>
                        {curr.cpaM !== null ? fmtDec(curr.cpaM) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#6b7280' }}>
                        {curr.cpaB !== null ? fmtDec(curr.cpaB) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: curr.roas !== null && curr.roas >= 1 ? '#1D9E75' : '#e53e3e' }}>
                        {curr.roas !== null ? `${curr.roas.toFixed(2)}×` : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <TrendBadge pct={trendCpa} inverted />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: '0.5rem 1rem', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              Weeks run Mon–Sun · current week is partial · vs Prior compares CPA (Meta) to the preceding week
            </div>
          </div>

          {/* ── TREND CHART ─────────────────────────────────────────────── */}
          <SectionLabel>60-Day CPA Trend</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}>
            <AdChart data={chartDays} />
          </div>

          {/* ── AD FUNNEL ───────────────────────────────────────────────── */}
          {(hasClicks || hasAtcs) && (
            <>
              <SectionLabel>Ad Funnel — Last 7 Days</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1.5px solid #3b82f6',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Spend',        value: fmt(fSpend),       accent: '#6b7280',  show: true },
                    { label: 'Link Clicks',  value: fClicks.toLocaleString(), accent: '#6b7280', show: hasClicks },
                    { label: 'ATCs',         value: fAtcs.toLocaleString(),   accent: '#b45309', show: hasAtcs },
                    { label: 'Purchases',    value: fPurchases.toLocaleString(), accent: '#15803d', show: true },
                  ].filter((s) => s.show).map((step, i, arr) => (
                    <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{
                        background: 'var(--surface2)',
                        borderRadius: 10,
                        padding: '1rem 1.5rem',
                        border: '1px solid var(--border)',
                        textAlign: 'center',
                        minWidth: 110,
                      }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: step.accent, marginBottom: '0.4rem' }}>{step.label}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: step.accent }}>{step.value}</div>
                      </div>
                      {i < arr.length - 1 && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0.75rem' }}>
                          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>→</span>
                          {i === 0 && hasClicks && hasAtcs && fCtoA !== null && (
                            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#b45309', fontWeight: 600 }}>{(fCtoA * 100).toFixed(1)}%</span>
                          )}
                          {i === 1 && hasAtcs && fAtoP !== null && (
                            <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#15803d', fontWeight: 600 }}>{(fAtoP * 100).toFixed(1)}%</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', paddingLeft: '1.5rem' }}>
                    {[
                      { label: 'CPA (Meta)', value: fPurchases > 0 ? fmtDec(fSpend / fPurchases) : '—', accent: '#1d4ed8' },
                      { label: 'CPA (Blend)', value: (() => { const o = sliceSummary(sumRows, d6str, todayStr).reduce((s, r) => s + r.total_orders, 0); return fSpend > 0 && o > 0 ? fmtDec(fSpend / o) : '—'; })(), accent: '#6b7280' },
                    ].map(({ label, value, accent }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: accent, marginBottom: '0.3rem' }}>{label}</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: accent }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── DAY-OF-WEEK BREAKDOWN ────────────────────────────────────── */}
          <SectionLabel>Day-of-Week Performance — Last 30 Days</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            marginBottom: '2rem',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Day', 'Avg Spend', 'Avg Purchases', 'Avg CPA (Meta)', ''].map((h) => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem',
                      textAlign: h === 'Day' || h === '' ? 'left' : 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dowRows.map((r, i) => {
                  const isBest  = r.label === bestDow.label  && r.avgCpa !== null;
                  const isWorst = r.label === worstDow.label && r.avgCpa !== null;
                  return (
                    <tr key={r.label} style={{
                      borderBottom: i < dowRows.length - 1 ? '1px solid var(--border)' : 'none',
                      background: isBest ? 'rgba(29,158,117,0.06)' : isWorst ? 'rgba(229,62,62,0.04)' : i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
                    }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{r.label}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {r.days > 0 ? fmt(r.avgSpend) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {r.days > 0 ? r.avgPurch.toFixed(1) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: isBest ? '#1D9E75' : isWorst ? '#e53e3e' : 'var(--text)' }}>
                        {r.avgCpa !== null ? fmtDec(r.avgCpa) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {isBest  && <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', padding: '0.15rem 0.4rem', borderRadius: 5, background: '#dcfce7', color: '#15803d', fontWeight: 600 }}>BEST</span>}
                        {isWorst && <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', padding: '0.15rem 0.4rem', borderRadius: 5, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>WORST</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: '0.5rem 1rem', background: 'var(--surface2)', borderTop: '1px solid var(--border)', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              Based on {dow30.length} days of ad data in the past 30 days · Mon–Sun ordering
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
