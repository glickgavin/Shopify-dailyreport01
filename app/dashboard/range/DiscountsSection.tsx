import { supabaseAdmin } from '@/lib/supabase';
import { SectionLabel, fmt, fmtDec } from '../_components/cards';

// ── Range Discounts section ───────────────────────────────────────────────────
// Renders discount-code performance over the selected range from the
// daily_discounts rollup (same pipeline & rules as the rest of the dashboard):
//   1. BLENDED daily table (all orders)
//   2. One daily table per discount code, ordered by order volume, heading
//      showing its share of blended orders; NEW badge when the code was never
//      seen before the window start
//   3. NO DISCOUNT daily table
// Product/variant filters via GET form (URL params d_product / d_variant).
// Net $ = net sales of matching lines · AOV = full order value ÷ orders.

interface DRow {
  date: string;
  discount_code: string;
  orders: number;
  units: number;
  net_sales: number;
  order_value: number;
}

const td = (right = true, extra: React.CSSProperties = {}): React.CSSProperties => ({
  padding: '0.5rem 0.9rem', textAlign: right ? 'right' : 'left',
  fontFamily: 'var(--font-mono)', fontSize: '0.78rem', whiteSpace: 'nowrap', ...extra,
});
const th = (right = true): React.CSSProperties => ({
  padding: '0.55rem 0.9rem', textAlign: right ? 'right' : 'left',
  fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--muted)', whiteSpace: 'nowrap',
});

function DailyTable({ title, badge, rows }: { title: string; badge?: string; rows: DRow[] }) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const tOrders = sorted.reduce((s, r) => s + r.orders, 0);
  const tUnits  = sorted.reduce((s, r) => s + r.units, 0);
  const tNet    = sorted.reduce((s, r) => s + r.net_sales, 0);
  const tValue  = sorted.reduce((s, r) => s + r.order_value, 0);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: '1rem', overflow: 'hidden' }}>
      <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
        {badge && (
          <span style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 5, padding: '0.1rem 0.45rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em' }}>
            {badge}
          </span>
        )}
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: '1rem', fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>No orders in window</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={th(false)}>Date</th>
                <th style={th()}>Orders</th>
                <th style={th()}>Units</th>
                <th style={th()}>U/O</th>
                <th style={th()}>Net $</th>
                <th style={th()}>AOV</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.date} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={td(false)}>{r.date}</td>
                  <td style={td()}>{r.orders}</td>
                  <td style={td()}>{r.units}</td>
                  <td style={td()}>{r.orders > 0 ? (r.units / r.orders).toFixed(1) : '—'}</td>
                  <td style={td(true, { fontWeight: 600 })}>{fmt(r.net_sales)}</td>
                  <td style={td()}>{r.orders > 0 ? fmtDec(r.order_value / r.orders) : '—'}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface2)' }}>
                <td style={td(false, { fontWeight: 700 })}>TOTAL</td>
                <td style={td(true, { fontWeight: 700 })}>{tOrders}</td>
                <td style={td(true, { fontWeight: 700 })}>{tUnits}</td>
                <td style={td(true, { fontWeight: 700 })}>{tOrders > 0 ? (tUnits / tOrders).toFixed(1) : '—'}</td>
                <td style={td(true, { fontWeight: 700 })}>{fmt(tNet)}</td>
                <td style={td(true, { fontWeight: 700 })}>{tOrders > 0 ? fmtDec(tValue / tOrders) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function DiscountsSection({
  startDate, endDate, preset, from, to, dProduct, dVariant,
}: {
  startDate: string;
  endDate: string;
  preset?: string;
  from?: string;
  to?: string;
  dProduct?: string;
  dVariant?: string;
}) {
  const product = dProduct && dProduct !== 'ALL' ? dProduct : 'ALL';
  const variant = product !== 'ALL' && dVariant && dVariant !== 'ALL' ? dVariant : 'ALL';

  const [{ data: filteredRows }, { data: allLevelRows }, { data: optionRows }, { data: priorRows }] = await Promise.all([
    // Rows at the selected filter level, for the tables
    supabaseAdmin.from('daily_discounts').select('date,discount_code,orders,units,net_sales,order_value')
      .gte('date', startDate).lte('date', endDate)
      .eq('product_title', product).eq('variant_title', variant),
    // ALL-level rows, to enumerate codes + compute share of blended orders
    supabaseAdmin.from('daily_discounts').select('date,discount_code,orders')
      .gte('date', startDate).lte('date', endDate)
      .eq('product_title', 'ALL').eq('variant_title', 'ALL'),
    // Filter options: products (and their variants) present in the window
    supabaseAdmin.from('daily_discounts').select('product_title,variant_title')
      .gte('date', startDate).lte('date', endDate)
      .eq('discount_code', 'ALL'),
    // Codes seen BEFORE the window → anything not in this set is NEW
    supabaseAdmin.from('daily_discounts').select('discount_code')
      .lt('date', startDate)
      .eq('product_title', 'ALL').eq('variant_title', 'ALL'),
  ]);

  const rows = (filteredRows ?? []) as DRow[];
  if ((allLevelRows ?? []).length === 0) return null; // no discount data yet for this range

  // Enumerate codes from ALL level (so zero-row filtered codes still render)
  const codeOrders = new Map<string, number>();
  let blendedOrders = 0;
  for (const r of allLevelRows ?? []) {
    if (r.discount_code === 'ALL') { blendedOrders += r.orders; continue; }
    codeOrders.set(r.discount_code, (codeOrders.get(r.discount_code) ?? 0) + r.orders);
  }
  const codes = Array.from(codeOrders.entries())
    .filter(([c]) => c !== '')
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  const seenBefore = new Set((priorRows ?? []).map(r => r.discount_code));

  const byCode = (code: string) => rows.filter(r => r.discount_code === code);

  // Filter options
  const products = Array.from(new Set((optionRows ?? []).map(r => r.product_title).filter(t => t !== 'ALL'))).sort();
  const variants = product !== 'ALL'
    ? Array.from(new Set((optionRows ?? []).filter(r => r.product_title === product).map(r => r.variant_title).filter(v => v !== 'ALL'))).sort()
    : [];

  // ── Commentary ──────────────────────────────────────────────────────────────
  const bullets: string[] = [];
  const blendedRows = byCode('ALL').sort((a, b) => a.date.localeCompare(b.date));
  if (blendedRows.length > 1) {
    const best  = [...blendedRows].sort((a, b) => b.net_sales - a.net_sales)[0];
    const worst = [...blendedRows].sort((a, b) => a.net_sales - b.net_sales)[0];
    bullets.push(`Best day ${best.date} (${fmt(best.net_sales)} net) · worst day ${worst.date} (${fmt(worst.net_sales)} net).`);
  }
  for (const code of codes.slice(0, 3)) {
    const cr = byCode(code).sort((a, b) => a.date.localeCompare(b.date));
    if (cr.length >= 8) {
      const firstW = cr.slice(0, 7), lastW = cr.slice(-7);
      const aov = (xs: DRow[]) => { const o = xs.reduce((s, r) => s + r.orders, 0); return o > 0 ? xs.reduce((s, r) => s + r.order_value, 0) / o : 0; };
      const a1 = aov(firstW), a2 = aov(lastW);
      if (a1 > 0) {
        const chg = ((a2 - a1) / a1) * 100;
        if (Math.abs(chg) >= 1) bullets.push(`${code}: AOV ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}% (first-week ${fmtDec(a1)} → last-week ${fmtDec(a2)}).`);
      }
    }
  }
  const newCodes = codes.filter(c => !seenBefore.has(c));
  if (newCodes.length > 0) bullets.push(`NEW code${newCodes.length > 1 ? 's' : ''} this window: ${newCodes.join(', ')}.`);
  // Share shift: first half vs second half of the window
  {
    const dates = Array.from(new Set((allLevelRows ?? []).map(r => r.date))).sort();
    if (dates.length >= 4) {
      const mid = dates[Math.floor(dates.length / 2)];
      const share = (code: string, half: (d: string) => boolean) => {
        const tot  = (allLevelRows ?? []).filter(r => r.discount_code === 'ALL' && half(r.date)).reduce((s, r) => s + r.orders, 0);
        const c    = (allLevelRows ?? []).filter(r => r.discount_code === code && half(r.date)).reduce((s, r) => s + r.orders, 0);
        return tot > 0 ? (c / tot) * 100 : 0;
      };
      for (const code of codes.slice(0, 5)) {
        const s1 = share(code, d => d < mid), s2 = share(code, d => d >= mid);
        if (Math.abs(s2 - s1) >= 10) {
          bullets.push(`${code}: share of orders shifted ${s1.toFixed(0)}% → ${s2.toFixed(0)}% (first vs second half of window).`);
        }
      }
    }
  }

  return (
    <>
      <SectionLabel>Discounts</SectionLabel>

      {/* Filter form (GET — preserves the date range via hidden fields) */}
      <form method="get" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
        {preset && <input type="hidden" name="preset" value={preset} />}
        {from && <input type="hidden" name="from" value={from} />}
        {to && <input type="hidden" name="to" value={to} />}
        <label style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.06em' }}>Product</label>
        <select name="d_product" defaultValue={product} style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.78rem' }}>
          <option value="ALL">All products</option>
          {products.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {product !== 'ALL' && (
          <>
            <label style={{ color: 'var(--muted)', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.06em' }}>Variant</label>
            <select name="d_variant" defaultValue={variant} style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.78rem' }}>
              <option value="ALL">All variants</option>
              {variants.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </>
        )}
        <button type="submit" style={{ padding: '0.32rem 0.8rem', borderRadius: 6, border: '1px solid var(--border)', background: '#1a1a2e', color: '#fff', fontFamily: 'inherit', fontSize: '0.75rem', cursor: 'pointer' }}>Apply</button>
        {product !== 'ALL' && (
          <span style={{ color: 'var(--muted)' }}>filtering: {product}{variant !== 'ALL' ? ` · ${variant}` : ''}</span>
        )}
      </form>

      {/* Commentary */}
      {bullets.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.85rem 1.1rem', marginBottom: '1rem' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} style={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.5 }}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* (a) Blended */}
      <DailyTable title="BLENDED — all orders" rows={byCode('ALL')} />

      {/* (b) One table per code, ordered by volume */}
      {codes.map(code => {
        const share = blendedOrders > 0 ? Math.round((codeOrders.get(code)! / blendedOrders) * 100) : 0;
        return (
          <DailyTable
            key={code}
            title={`${code} (${share}% of orders)`}
            badge={!seenBefore.has(code) ? 'NEW' : undefined}
            rows={byCode(code)}
          />
        );
      })}

      {/* (c) No discount */}
      <DailyTable title="NO DISCOUNT" rows={byCode('')} />

      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: '2rem' }}>
        Orders may carry multiple codes, so code tables can overlap · Orders = orders containing ≥1 matching line · Net $ = net sales of matching lines · AOV = full order value ÷ orders · PT days, no partial days
      </div>
    </>
  );
}
