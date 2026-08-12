import { supabaseAdmin } from '@/lib/supabase';
import { SectionLabel, fmt, fmtDec } from '../_components/cards';

// ── Range Country of Purchase section ────────────────────────────────────────
// Aggregates the daily_countries rollup (same pipeline & rules as the daily
// report's section) over the selected range: one row per country with share of
// orders, orders, portrait units, U/O, net sales and AOV, plus an ALL
// COUNTRIES blended row and a No-address row. Orders/AOV are summed across
// days, so a customer ordering on two days counts twice — consistent with the
// rest of the range report.

interface CRow {
  date: string;
  country: string;
  orders: number;
  units: number;
  units_primary: number;
  net_sales: number;
  order_value: number;
}

interface Agg {
  orders: number;
  unitsPrimary: number;
  netSales: number;
  orderValue: number;
}

export default async function CountriesSection({
  startDate, endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data } = await (supabaseAdmin as any)
    .from('daily_countries')
    .select('date,country,orders,units,units_primary,net_sales,order_value')
    .gte('date', startDate).lte('date', endDate);

  const rows = (data ?? []) as CRow[];
  if (rows.length === 0) return null; // no country data yet for this range

  const agg = new Map<string, Agg>();
  for (const r of rows) {
    let a = agg.get(r.country);
    if (!a) { a = { orders: 0, unitsPrimary: 0, netSales: 0, orderValue: 0 }; agg.set(r.country, a); }
    a.orders       += r.orders;
    a.unitsPrimary += r.units_primary;
    a.netSales     += Number(r.net_sales);
    a.orderValue   += Number(r.order_value);
  }

  const blended = agg.get('ALL') ?? null;
  const unknown = agg.get('') ?? null;
  const list = Array.from(agg.entries())
    .filter(([c]) => c !== 'ALL' && c !== '')
    .sort((a, b) => b[1].orders - a[1].orders || b[1].netSales - a[1].netSales);
  if (!blended) return null;

  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const countryLabel = (code: string) => {
    try { return `${regionNames.of(code) ?? code} (${code})`; } catch { return code; }
  };

  // Coverage note: days with country data vs days in the window (older days
  // may still be backfilling).
  const daysCovered = new Set(rows.map(r => r.date)).size;
  const daysInRange = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;

  return (
    <>
      <SectionLabel>Country of Purchase</SectionLabel>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: '2rem', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Country', '% of Orders', 'Orders', 'Units', 'U/O', 'Net $', 'AOV'].map((h, i) => (
                <th key={h} style={{ padding: '0.7rem 1rem', textAlign: i === 0 ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'ALL COUNTRIES', a: blended, bold: true },
              ...list.map(([c, a]) => ({ label: countryLabel(c), a, bold: false })),
              ...(unknown ? [{ label: 'No address', a: unknown, bold: false }] : []),
            ].map(({ label, a, bold }, i, arr) => {
              const share = blended.orders > 0 ? (a.orders / blended.orders) * 100 : 0;
              const uo    = a.orders > 0 ? a.unitsPrimary / a.orders : 0;
              const aov   = a.orders > 0 ? a.orderValue / a.orders : 0;
              return (
                <tr key={label} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: bold ? 'var(--surface2)' : 'transparent' }}>
                  <td style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 500 }}>{label}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{bold ? '100%' : `${share.toFixed(share >= 10 ? 0 : 1)}%`}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 400 }}>{a.orders}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{a.unitsPrimary}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{uo.toFixed(1)}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{fmt(a.netSales)}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{fmtDec(aov)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border)', fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Country = shipping address (billing as fallback) · Units counts Magic Portrait items only · Net $ = net sales of the country&apos;s lines · AOV = full order value ÷ orders · PT days, no partial days
          {daysCovered < daysInRange ? ` · country data covers ${daysCovered} of ${daysInRange} days (older days still backfilling)` : ''}
        </div>
      </div>
    </>
  );
}
