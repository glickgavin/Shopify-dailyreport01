import { fmt, fmtDec } from '../_components/cards';

// ── Highlights view (redesign signature) ─────────────────────────────────────
// KPI hero + cash collected + margin donut, revenue-by-channel stacked bar,
// profit waterfall + paid funnel, customer mix + unit economics. Pure
// presentation — every figure is computed in page.tsx and passed in.

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface, var(--surface))',
  borderRadius: 24,
  padding: '24px 28px',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--neutral-600)',
};
const tnum: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

function BarRow({
  label, width, fill, value, valueColor, height = 22, sep = false,
}: {
  label: string; width: number; fill: string; value: string; valueColor?: string; height?: number; sep?: boolean;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '110px 1fr 90px', alignItems: 'center', gap: 12,
      ...(sep ? { borderTop: '1px solid var(--border)', paddingTop: 12 } : {}),
    }}>
      <span style={{ color: 'var(--neutral-700)', fontWeight: sep ? 600 : 400 }}>{label}</span>
      <div style={{ height, borderRadius: 6, background: 'var(--neutral-200)' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, width))}%`, height: '100%', borderRadius: 6, background: fill }} />
      </div>
      <span style={{ textAlign: 'right', fontWeight: 700, color: valueColor, ...tnum }}>{value}</span>
    </div>
  );
}

function Legend({ items }: { items: { color: string; name: string; value: string; sub: string }[] }) {
  return (
    <div className="hl-legend" style={{ display: 'grid', gap: 14, ...tnum }}>
      {items.map(it => (
        <div key={it.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--neutral-700)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: it.color, flex: 'none' }} />{it.name}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{it.value}</span>
          <span style={{ fontSize: 11, color: 'var(--neutral-600)' }}>{it.sub}</span>
        </div>
      ))}
    </div>
  );
}

export interface HighlightsProps {
  rangeLabel: string;
  revenue: number;
  revDeltaPct: number | null;   // vs prior window of equal length
  orders: number;
  units: number;
  aov: number;
  cashIn: number;
  marginPct: number;            // 0–100
  grossProfit: number;
  channels: { name: string; color: string; value: number }[]; // non-zero, ordered
  cogs: number;
  adSpend: number;
  memberLtv: number;
  contribution: number;
  funnel: { clicks: number | null; atcs: number | null; purchases: number | null; cpa: number | null } | null;
  mix: { newRev: number; newOrders: number; newAov: number; retRev: number; retOrders: number; retAov: number } | null;
  cpaAd: number | null;
  cpaBlended: number | null;
  roasBlended: number | null;
  gpPerOrder: number | null;
}

export default function Highlights(p: HighlightsProps) {
  const CIRC = 2 * Math.PI * 29; // donut circumference
  const channelTotal = p.channels.reduce((s, c) => s + c.value, 0);
  const mixTotal = p.mix ? p.mix.newRev + p.mix.retRev : 0;
  const clickToAtc = p.funnel?.clicks && p.funnel.atcs != null && p.funnel.clicks > 0 ? p.funnel.atcs / p.funnel.clicks : null;
  const atcToPurchase = p.funnel?.atcs && p.funnel.purchases != null && p.funnel.atcs > 0 ? p.funnel.purchases / p.funnel.atcs : null;
  const clickToPurchase = p.funnel?.clicks && p.funnel.purchases != null && p.funnel.clicks > 0 ? p.funnel.purchases / p.funnel.clicks : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`
        .hl-hero { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 14px; }
        .hl-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .hl-legend { grid-template-columns: repeat(4, 1fr); }
        .hl-rev { font-size: 56px; }
        @media (max-width: 760px) {
          .hl-hero, .hl-pair { grid-template-columns: 1fr; }
          .hl-legend { grid-template-columns: 1fr 1fr; }
          .hl-rev { font-size: 44px; }
        }
      `}</style>

      {/* 1 — KPI hero row */}
      <div className="hl-hero">
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={labelStyle}>Net revenue</span>
            {p.revDeltaPct !== null && (
              <span style={{
                background: p.revDeltaPct >= 0 ? 'var(--accent2-200)' : 'var(--accent-200)',
                color: p.revDeltaPct >= 0 ? 'var(--accent2-900)' : 'var(--accent-900)',
                borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {p.revDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(p.revDeltaPct).toFixed(1)}% vs prior {p.rangeLabel.toLowerCase() === 'yesterday' || p.rangeLabel.toLowerCase() === 'today' ? 'day' : 'period'}
              </span>
            )}
          </div>
          <div className="hl-rev" style={{ fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', ...tnum }}>{fmt(p.revenue)}</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--neutral-700)', ...tnum }}>
            <span><strong>{p.orders}</strong> orders</span>
            <span><strong>{p.units}</strong> units</span>
            <span><strong>{fmtDec(p.aov)}</strong> AOV</span>
          </div>
        </div>
        <div style={{ ...cardStyle, background: 'var(--accent2-100)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <span style={{ ...labelStyle, color: 'var(--accent2-700)' }}>Cash collected</span>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: 'var(--accent2-900)', ...tnum }}>{fmt(p.cashIn)}</div>
          <div style={{ fontSize: 12, color: 'var(--accent2-800)' }}>Store + memberships + Stripe net, after refunds</div>
        </div>
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <span style={labelStyle}>Gross margin</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)', flex: 'none' }}>
              <circle cx="36" cy="36" r="29" fill="none" stroke="var(--neutral-200)" strokeWidth="10" />
              <circle
                cx="36" cy="36" r="29" fill="none" stroke="var(--accent2-500)" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${Math.max(0, Math.min(100, p.marginPct)) / 100 * CIRC} ${CIRC}`}
              />
            </svg>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, ...tnum }}>{p.marginPct.toFixed(1)}%</div>
              <div style={{ fontSize: 12, color: 'var(--neutral-600)', marginTop: 4 }}>{fmt(p.grossProfit)} gross profit</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2 — Revenue by channel */}
      {channelTotal > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <span style={labelStyle}>Revenue by channel</span>
            <span style={{ fontSize: 12, color: 'var(--neutral-600)' }}>{p.channels.length} channel{p.channels.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', height: 44, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            {p.channels.map(c => (
              <div key={c.name} style={{ width: `${(c.value / channelTotal) * 100}%`, background: c.color }} />
            ))}
          </div>
          <Legend items={p.channels.map(c => ({
            color: c.color, name: c.name, value: fmt(c.value),
            sub: `${((c.value / channelTotal) * 100).toFixed(1)}%`,
          }))} />
        </div>
      )}

      {/* 3 — Profit waterfall + paid funnel */}
      <div className="hl-pair">
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 18 }}>Profit waterfall</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, ...tnum }}>
            <BarRow label="Net revenue" width={100} fill="var(--accent2-500)" value={fmt(p.revenue)} />
            <BarRow label="COGS" width={p.revenue > 0 ? (p.cogs / p.revenue) * 100 : 0} fill="var(--accent-400)" value={`−${fmt(p.cogs)}`} valueColor="var(--accent-800)" />
            <BarRow label="Ad spend" width={p.revenue > 0 ? (p.adSpend / p.revenue) * 100 : 0} fill="var(--accent-400)" value={`−${fmt(p.adSpend)}`} valueColor="var(--accent-800)" />
            <BarRow label="Member LTV" width={p.revenue > 0 ? (p.memberLtv / p.revenue) * 100 : 0} fill="var(--accent2-400)" value={`+${fmt(p.memberLtv)}`} valueColor="var(--accent2-800)" />
            <BarRow label="Contribution" sep width={p.revenue > 0 ? Math.max(0, p.contribution / p.revenue) * 100 : 0} fill="var(--accent2-600)"
              value={p.contribution < 0 ? `−${fmt(Math.abs(p.contribution))}` : fmt(p.contribution)}
              valueColor={p.contribution < 0 ? 'var(--accent-800)' : undefined} />
          </div>
        </div>
        {p.funnel && p.funnel.clicks != null ? (
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <span style={labelStyle}>Paid funnel · Meta</span>
              <span style={{ fontSize: 12, color: 'var(--neutral-600)', ...tnum }}>
                {fmt(p.adSpend)} spend{p.funnel.cpa != null ? ` · ${fmtDec(p.funnel.cpa)} CPA` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, flex: 1, justifyContent: 'center', ...tnum }}>
              <BarRow label="Link clicks" height={26} width={100} fill="var(--accent2-300)" value={String(p.funnel.clicks)} />
              {p.funnel.atcs != null && (
                <BarRow label="Add to cart" height={26} width={clickToAtc != null ? clickToAtc * 100 : 0} fill="var(--accent2-400)"
                  value={`${p.funnel.atcs}${clickToAtc != null ? `  ·  ${(clickToAtc * 100).toFixed(1)}%` : ''}`} />
              )}
              {p.funnel.purchases != null && (
                <BarRow label="Purchases" height={26} width={clickToPurchase != null ? Math.max(clickToPurchase * 100, 1.5) : 0} fill="var(--accent2-600)"
                  value={`${p.funnel.purchases}${atcToPurchase != null ? `  ·  ${(atcToPurchase * 100).toFixed(1)}%` : ''}`} />
              )}
            </div>
            {clickToPurchase != null && (
              <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--neutral-600)' }}>
                Overall click-to-purchase conversion {(clickToPurchase * 100).toFixed(1)}%
              </p>
            )}
          </div>
        ) : (
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--neutral-600)', fontSize: 13 }}>
            No Meta ads data for this range
          </div>
        )}
      </div>

      {/* 4 — Customer mix + unit economics */}
      <div className="hl-pair">
        {p.mix && mixTotal > 0 ? (
          <div style={cardStyle}>
            <div style={{ ...labelStyle, marginBottom: 16 }}>Customer mix</div>
            <div style={{ display: 'flex', height: 36, borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${(p.mix.newRev / mixTotal) * 100}%`, background: 'var(--chart-green)' }} />
              <div style={{ width: `${(p.mix.retRev / mixTotal) * 100}%`, background: 'var(--chart-blue)' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, ...tnum }}>
              <Legend items={[{ color: 'var(--chart-green)', name: 'New', value: fmt(p.mix.newRev), sub: `${p.mix.newOrders} orders · ${fmtDec(p.mix.newAov)} AOV` }]} />
              <Legend items={[{ color: 'var(--chart-blue)', name: 'Returning', value: fmt(p.mix.retRev), sub: `${p.mix.retOrders} orders · ${fmtDec(p.mix.retAov)} AOV` }]} />
            </div>
            {p.mix.newAov > 0 && p.mix.retAov > p.mix.newAov && (
              <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--neutral-600)' }}>
                Returning customers spend {(p.mix.retAov / p.mix.newAov).toFixed(1)}× more per order.
              </p>
            )}
          </div>
        ) : (
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--neutral-600)', fontSize: 13 }}>
            No customer segment data
          </div>
        )}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={labelStyle}>Unit economics</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1, ...tnum }}>
            {[
              { v: p.cpaAd != null ? fmtDec(p.cpaAd) : '—',            l: 'CPA · attributed' },
              { v: p.cpaBlended != null ? fmtDec(p.cpaBlended) : '—',  l: 'CPA · blended' },
              { v: p.roasBlended != null ? `${p.roasBlended.toFixed(2)}×` : '—', l: 'ROAS · blended' },
              { v: p.gpPerOrder != null ? fmtDec(p.gpPerOrder) : '—',  l: 'gross profit / order' },
            ].map(t => (
              <div key={t.l} style={{ background: 'var(--neutral-100)', borderRadius: 14, padding: '14px 18px' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{t.v}</div>
                <div style={{ fontSize: 11, color: 'var(--neutral-600)' }}>{t.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
