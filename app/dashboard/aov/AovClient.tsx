'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ── AOV analysis client ───────────────────────────────────────────────────────
// Four rule sections (AOV by segment / product / discount code, plus order
// size in Magic Portrait tiles by discount code). Each lets you select/
// deselect options; the combined figure and its daily trend recompute
// instantly from the pre-fetched rows.

export interface SegmentDay {
  date: string;
  totalRev: number; totalOrd: number;
  cashRev: number; cashOrd: number;
  noncashRev: number; noncashOrd: number;
  memRev: number; memOrd: number;
  amazonRev: number; amazonOrd: number;
}

/** One (day, dimension-key) cell: distinct orders, their full order value,
 *  and their Magic Portrait tile count (units_primary). */
export interface DimRow {
  date: string;
  key: string;
  orders: number;
  value: number;
  units: number;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtUsd0 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const cardStyle: React.CSSProperties = { background: 'var(--surface)', borderRadius: 24, padding: '24px 28px' };
const labelStyle: React.CSSProperties = { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--neutral-600)' };

function shortDate(d: string) {
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

function AovTooltip({ active, payload, label, money = true }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#282c28', borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 12 }}>
      <div style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name}><strong>{money ? fmtUsd(p.value) : p.value.toFixed(1)}</strong> {p.name}</div>
      ))}
    </div>
  );
}

function TrendChart({ data, overallByDate, money = true }: {
  data: { date: string; aov: number | null }[];
  overallByDate: Map<string, number | null>;
  money?: boolean;
}) {
  const rows = data.map(d => ({
    date: shortDate(d.date),
    Selection: d.aov,
    Overall: overallByDate.get(d.date) ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--neutral-200)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#747c74' }} tickLine={false} axisLine={{ stroke: 'var(--neutral-300)' }} />
        <YAxis tick={{ fontSize: 11, fill: '#747c74' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => money ? `$${Math.round(v)}` : String(Math.round(v * 10) / 10)} width={48} />
        <Tooltip content={<AovTooltip money={money} />} />
        <Line type="monotone" dataKey="Overall" stroke="#b8beb8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="Selection" stroke="#17a97b" strokeWidth={2.5} dot={{ r: 3, fill: '#17a97b', strokeWidth: 0 }} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SelectPill({ label, sub, on, onClick }: { label: string; sub?: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 999, padding: '7px 15px', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
        fontFamily: 'var(--font-body)', display: 'inline-flex', alignItems: 'baseline', gap: 6,
        background: on ? 'var(--accent2-200)' : 'var(--surface)',
        border: on ? '1px solid var(--accent2-400)' : '1px solid var(--border)',
        color: on ? 'var(--accent2-900)' : 'var(--neutral-600)',
        fontWeight: on ? 600 : 400,
      }}
    >
      <span>{on ? '✓ ' : ''}{label}</span>
      {sub && <span style={{ fontSize: 10.5, color: on ? 'var(--accent2-700)' : 'var(--neutral-500)', fontWeight: 400 }}>{sub}</span>}
    </button>
  );
}

function SectionCard({
  title, note, pills, headline, children,
}: {
  title: string; note: string;
  pills: React.ReactNode; headline: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ ...labelStyle, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--neutral-600)', marginBottom: 16 }}>{note}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>{pills}</div>
      {headline}
      {children}
    </div>
  );
}

function Headline({ aov, orders, value, overallAov }: { aov: number | null; orders: number; value: number; overallAov: number | null }) {
  const deltaPct = aov !== null && overallAov ? ((aov - overallAov) / overallAov) * 100 : null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{aov !== null ? fmtUsd(aov) : '—'}</span>
      {deltaPct !== null && Math.abs(deltaPct) >= 0.05 && (
        <span style={{
          background: deltaPct >= 0 ? 'var(--accent2-200)' : 'var(--accent-200)',
          color: deltaPct >= 0 ? 'var(--accent2-900)' : 'var(--accent-900)',
          borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}% vs overall
        </span>
      )}
      <span style={{ fontSize: 13, color: 'var(--neutral-600)' }}>
        {orders} orders · {fmtUsd0(value)} order value
      </span>
    </div>
  );
}

export default function AovClient({
  segments, products, codes, blendedTiles, days,
}: {
  segments: SegmentDay[];
  products: DimRow[];
  codes: DimRow[];
  /** code=ALL rows: overall orders + Magic Portrait tiles per day. */
  blendedTiles: { date: string; orders: number; units: number }[];
  days: number;
}) {
  // ── Overall AOV (reference in every chart) ─────────────────────────────────
  const overall = useMemo(() => {
    const rev = segments.reduce((s, d) => s + d.totalRev, 0);
    const ord = segments.reduce((s, d) => s + d.totalOrd, 0);
    const byDate = new Map<string, number | null>(
      segments.map(d => [d.date, d.totalOrd > 0 ? d.totalRev / d.totalOrd : null]),
    );
    return { aov: ord > 0 ? rev / ord : null, rev, ord, byDate };
  }, [segments]);

  // ── 1. By segment (disjoint → exact) ───────────────────────────────────────
  const SEGS = [
    { id: 'cash',    label: 'Cash',       rev: (d: SegmentDay) => d.cashRev,    ord: (d: SegmentDay) => d.cashOrd },
    { id: 'noncash', label: 'Non-Cash',   rev: (d: SegmentDay) => d.noncashRev, ord: (d: SegmentDay) => d.noncashOrd },
    { id: 'mem',     label: 'Membership', rev: (d: SegmentDay) => d.memRev,     ord: (d: SegmentDay) => d.memOrd },
    { id: 'amazon',  label: 'Amazon',     rev: (d: SegmentDay) => d.amazonRev,  ord: (d: SegmentDay) => d.amazonOrd },
  ] as const;
  const [segOn, setSegOn] = useState<Set<string>>(new Set(['cash']));
  const segCalc = useMemo(() => {
    const sel = SEGS.filter(s => segOn.has(s.id));
    let rev = 0, ord = 0;
    const daily = segments.map(d => {
      const r = sel.reduce((s, x) => s + x.rev(d), 0);
      const o = sel.reduce((s, x) => s + x.ord(d), 0);
      rev += r; ord += o;
      return { date: d.date, aov: o > 0 ? r / o : null };
    });
    return { aov: ord > 0 ? rev / ord : null, rev, ord, daily };
  }, [segments, segOn]);

  // ── generic dimension calc (products, codes) ───────────────────────────────
  const dimOptions = (rows: DimRow[]) => {
    const m = new Map<string, { orders: number; value: number; units: number }>();
    for (const r of rows) {
      const e = m.get(r.key) ?? { orders: 0, value: 0, units: 0 };
      e.orders += r.orders; e.value += r.value; e.units += r.units;
      m.set(r.key, e);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].orders - a[1].orders);
  };
  const dimCalc = (rows: DimRow[], on: Set<string>, dates: string[]) => {
    let orders = 0, value = 0;
    const byDate = new Map<string, { o: number; v: number }>();
    for (const r of rows) {
      if (!on.has(r.key)) continue;
      orders += r.orders; value += r.value;
      const e = byDate.get(r.date) ?? { o: 0, v: 0 };
      e.o += r.orders; e.v += r.value;
      byDate.set(r.date, e);
    }
    const daily = dates.map(date => {
      const e = byDate.get(date);
      return { date, aov: e && e.o > 0 ? e.v / e.o : null };
    });
    return { aov: orders > 0 ? value / orders : null, orders, value, daily };
  };

  const dates = segments.map(d => d.date);

  const productOptions = useMemo(() => dimOptions(products), [products]);
  const [prodOn, setProdOn] = useState<Set<string>>(() => new Set(productOptions.map(([k]) => k)));
  const prodCalc = useMemo(() => dimCalc(products, prodOn, dates), [products, prodOn, segments]);

  const codeOptions = useMemo(() => dimOptions(codes), [codes]);
  const [codeOn, setCodeOn] = useState<Set<string>>(() => new Set(codeOptions.map(([k]) => k)));
  const codeCalc = useMemo(() => dimCalc(codes, codeOn, dates), [codes, codeOn, segments]);

  // ── Order size (Magic Portrait tiles per order) by discount code ───────────
  const [tilesOn, setTilesOn] = useState<Set<string>>(() => new Set(codeOptions.map(([k]) => k)));
  const tilesCalc = useMemo(() => {
    let orders = 0, units = 0;
    const byDate = new Map<string, { o: number; u: number }>();
    for (const r of codes) {
      if (!tilesOn.has(r.key)) continue;
      orders += r.orders; units += r.units;
      const e = byDate.get(r.date) ?? { o: 0, u: 0 };
      e.o += r.orders; e.u += r.units;
      byDate.set(r.date, e);
    }
    const daily = dates.map(date => {
      const e = byDate.get(date);
      return { date, aov: e && e.o > 0 ? e.u / e.o : null };
    });
    return { avg: orders > 0 ? units / orders : null, orders, units, daily };
  }, [codes, tilesOn, segments]);
  // ── Order size by product ──────────────────────────────────────────────────
  // Note: each product row's units count that product's OWN line quantity in
  // orders containing it — for Magic Portrait products that is tiles, so the
  // default selection is the portrait products.
  const [prodTilesOn, setProdTilesOn] = useState<Set<string>>(() => {
    const portraits = productOptions.filter(([k]) => /magic portrait/i.test(k)).map(([k]) => k);
    return new Set(portraits.length > 0 ? portraits : productOptions.map(([k]) => k));
  });
  const prodTilesCalc = useMemo(() => {
    let orders = 0, units = 0;
    const byDate = new Map<string, { o: number; u: number }>();
    for (const r of products) {
      if (!prodTilesOn.has(r.key)) continue;
      orders += r.orders; units += r.units;
      const e = byDate.get(r.date) ?? { o: 0, u: 0 };
      e.o += r.orders; e.u += r.units;
      byDate.set(r.date, e);
    }
    const daily = dates.map(date => {
      const e = byDate.get(date);
      return { date, aov: e && e.o > 0 ? e.u / e.o : null };
    });
    return { avg: orders > 0 ? units / orders : null, orders, units, daily };
  }, [products, prodTilesOn, segments]);

  const tilesOverall = useMemo(() => {
    const orders = blendedTiles.reduce((s, d) => s + d.orders, 0);
    const units  = blendedTiles.reduce((s, d) => s + d.units, 0);
    const byDate = new Map<string, number | null>(
      blendedTiles.map(d => [d.date, d.orders > 0 ? d.units / d.orders : null]),
    );
    return { avg: orders > 0 ? units / orders : null, byDate };
  }, [blendedTiles]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };
  const allNone = (opts: [string, { orders: number; value: number; units: number }][], set: Set<string>, setter: (s: Set<string>) => void) => (
    <button
      onClick={() => setter(set.size === opts.length ? new Set() : new Set(opts.map(([k]) => k)))}
      className="pill pill--sm"
      style={{ fontSize: 11 }}
    >
      {set.size === opts.length ? 'Clear all' : 'Select all'}
    </button>
  );

  const trim = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Overall AOV hero ──────────────────────────────────────────────── */}
      <div className="aov-hero" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
        <style>{`@media (max-width: 860px) { .aov-hero { grid-template-columns: 1fr !important; } }`}</style>
        <div style={{ ...cardStyle, background: 'var(--accent2-100)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          <span style={{ ...labelStyle, color: 'var(--accent2-700)' }}>Overall AOV · last {days} days</span>
          <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, color: 'var(--accent2-900)', fontVariantNumeric: 'tabular-nums' }}>
            {overall.aov !== null ? fmtUsd(overall.aov) : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--accent2-800)' }}>
            {overall.ord} orders · {fmtUsd0(overall.rev)} revenue · all segments
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 12 }}>Overall AOV by day</div>
          <TrendChart
            data={segments.map(d => ({ date: d.date, aov: d.totalOrd > 0 ? d.totalRev / d.totalOrd : null }))}
            overallByDate={new Map()}
          />
        </div>
      </div>

      {/* ── 1. AOV by segment ─────────────────────────────────────────────── */}
      <SectionCard
        title="AOV by segment"
        note="Select the segments to include; AOV = their combined revenue ÷ combined orders. Segments are disjoint, so this mix is exact."
        pills={SEGS.map(s => {
          const rev = segments.reduce((sum, d) => sum + s.rev(d), 0);
          const ord = segments.reduce((sum, d) => sum + s.ord(d), 0);
          return (
            <SelectPill
              key={s.id}
              label={s.label}
              sub={ord > 0 ? `${ord} ord · ${fmtUsd(rev / ord)}` : 'no orders'}
              on={segOn.has(s.id)}
              onClick={() => toggle(segOn, setSegOn, s.id)}
            />
          );
        })}
        headline={<Headline aov={segCalc.aov} orders={segCalc.ord} value={segCalc.rev} overallAov={overall.aov} />}
      >
        <TrendChart data={segCalc.daily} overallByDate={overall.byDate} />
      </SectionCard>

      {/* ── 2. AOV by product ─────────────────────────────────────────────── */}
      <SectionCard
        title="AOV by product"
        note="Select the products in the mix; AOV = full value of orders containing them ÷ those orders. Orders holding two selected products count under each."
        pills={
          <>
            {allNone(productOptions, prodOn, setProdOn)}
            {productOptions.map(([key, agg]) => (
              <SelectPill
                key={key}
                label={trim(key)}
                sub={`${agg.orders} ord · ${fmtUsd(agg.orders > 0 ? agg.value / agg.orders : 0)}`}
                on={prodOn.has(key)}
                onClick={() => toggle(prodOn, setProdOn, key)}
              />
            ))}
          </>
        }
        headline={<Headline aov={prodCalc.aov} orders={prodCalc.orders} value={prodCalc.value} overallAov={overall.aov} />}
      >
        <TrendChart data={prodCalc.daily} overallByDate={overall.byDate} />
      </SectionCard>

      {/* ── 3. AOV by discount code ───────────────────────────────────────── */}
      <SectionCard
        title="AOV by discount code"
        note="Select the discount codes in the mix; AOV = full value of orders using them ÷ those orders. Orders carrying two selected codes count under each."
        pills={
          <>
            {allNone(codeOptions, codeOn, setCodeOn)}
            {codeOptions.map(([key, agg]) => (
              <SelectPill
                key={key || 'none'}
                label={key === '' ? 'No discount' : trim(key)}
                sub={`${agg.orders} ord · ${fmtUsd(agg.orders > 0 ? agg.value / agg.orders : 0)}`}
                on={codeOn.has(key)}
                onClick={() => toggle(codeOn, setCodeOn, key)}
              />
            ))}
          </>
        }
        headline={<Headline aov={codeCalc.aov} orders={codeCalc.orders} value={codeCalc.value} overallAov={overall.aov} />}
      >
        <TrendChart data={codeCalc.daily} overallByDate={overall.byDate} />
      </SectionCard>

      {/* ── 4. Order size (Magic Portrait tiles) by discount code ─────────── */}
      <SectionCard
        title="Order size — Magic Portrait tiles per order, by discount code"
        note="Select the discount codes in the mix; order size = Magic Portrait tiles in the matching orders ÷ those orders. Only Magic Portrait line items count — mugs, downloads, memberships etc. are excluded."
        pills={
          <>
            {allNone(codeOptions, tilesOn, setTilesOn)}
            {codeOptions.map(([key, agg]) => (
              <SelectPill
                key={key || 'none'}
                label={key === '' ? 'No discount' : trim(key)}
                sub={`${agg.orders} ord · ${agg.orders > 0 ? (agg.units / agg.orders).toFixed(1) : '—'} tiles/ord`}
                on={tilesOn.has(key)}
                onClick={() => toggle(tilesOn, setTilesOn, key)}
              />
            ))}
          </>
        }
        headline={
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
              {tilesCalc.avg !== null ? `${tilesCalc.avg.toFixed(1)} tiles` : '—'}
            </span>
            {tilesCalc.avg !== null && tilesOverall.avg != null && tilesOverall.avg > 0 && Math.abs((tilesCalc.avg - tilesOverall.avg) / tilesOverall.avg) * 100 >= 0.05 && (
              <span style={{
                background: tilesCalc.avg >= tilesOverall.avg ? 'var(--accent2-200)' : 'var(--accent-200)',
                color: tilesCalc.avg >= tilesOverall.avg ? 'var(--accent2-900)' : 'var(--accent-900)',
                borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {tilesCalc.avg >= tilesOverall.avg ? '▲' : '▼'} {(Math.abs(tilesCalc.avg - tilesOverall.avg) / tilesOverall.avg * 100).toFixed(1)}% vs overall
              </span>
            )}
            <span style={{ fontSize: 13, color: 'var(--neutral-600)' }}>
              {tilesCalc.orders} orders · {tilesCalc.units} tiles
            </span>
          </div>
        }
      >
        <TrendChart data={tilesCalc.daily} overallByDate={tilesOverall.byDate} money={false} />
      </SectionCard>

      {/* ── 5. Order size by product ──────────────────────────────────────── */}
      <SectionCard
        title="Order size — units per order, by product"
        note="Select products; order size = the selected products' own units in the orders containing them ÷ those orders. For Magic Portrait products (selected by default) units are tiles; other products count their own items."
        pills={
          <>
            {allNone(productOptions, prodTilesOn, setProdTilesOn)}
            {productOptions.map(([key, agg]) => (
              <SelectPill
                key={key}
                label={trim(key)}
                sub={`${agg.orders} ord · ${agg.orders > 0 ? (agg.units / agg.orders).toFixed(1) : '—'} u/ord`}
                on={prodTilesOn.has(key)}
                onClick={() => toggle(prodTilesOn, setProdTilesOn, key)}
              />
            ))}
          </>
        }
        headline={
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
              {prodTilesCalc.avg !== null ? `${prodTilesCalc.avg.toFixed(1)} units` : '—'}
            </span>
            {prodTilesCalc.avg !== null && tilesOverall.avg != null && tilesOverall.avg > 0 && Math.abs((prodTilesCalc.avg - tilesOverall.avg) / tilesOverall.avg) * 100 >= 0.05 && (
              <span style={{
                background: prodTilesCalc.avg >= tilesOverall.avg ? 'var(--accent2-200)' : 'var(--accent-200)',
                color: prodTilesCalc.avg >= tilesOverall.avg ? 'var(--accent2-900)' : 'var(--accent-900)',
                borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {prodTilesCalc.avg >= tilesOverall.avg ? '▲' : '▼'} {(Math.abs(prodTilesCalc.avg - tilesOverall.avg) / tilesOverall.avg * 100).toFixed(1)}% vs overall tiles/order
              </span>
            )}
            <span style={{ fontSize: 13, color: 'var(--neutral-600)' }}>
              {prodTilesCalc.orders} orders · {prodTilesCalc.units} units
            </span>
          </div>
        }
      >
        <TrendChart data={prodTilesCalc.daily} overallByDate={tilesOverall.byDate} money={false} />
      </SectionCard>

      <p style={{ margin: '4px 4px 0', fontSize: 12, color: 'var(--neutral-600)' }}>
        AOV = full order value (net sales + shipping) ÷ distinct orders, from the same daily rollups as the rest of the dashboard ·
        Order size by code counts Magic Portrait tiles only; by product it counts the selected products&apos; own units ·
        dashed line = overall per day · PT days, no partial days.
      </p>
    </div>
  );
}
