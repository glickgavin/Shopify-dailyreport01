'use client';

import { type ReactNode } from 'react';
import {
  BarChart, Bar, ComposedChart, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

// ── colour palette (matches project + mockup intent) ─────────────────────────
const BLUE   = '#185FA5';
const GREEN  = '#1D9E75';
const AMBER  = '#d97706';
const RED    = '#dc2626';
const VIOLET = '#7c3aed';
const MUTED  = '#6b6b6b';
const GRID   = 'rgba(0,0,0,0.06)';

// ── shared helpers ────────────────────────────────────────────────────────────
const fmtDollar = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function DarkTooltip({
  active, payload, label,
  valueFormatter = (v: number) => String(v),
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
  valueFormatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1a1a2e', borderRadius: 10, padding: '0.65rem 0.9rem',
      fontSize: '0.78rem', color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    }}>
      {label && <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{label}</div>}
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color ?? 'rgba(255,255,255,0.8)', display: 'flex', gap: '0.4rem' }}>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{p.name}:</span>
          <strong>{valueFormatter(p.value, p.name)}</strong>
        </div>
      ))}
    </div>
  );
}

const axisStyle = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: MUTED };

// ── prop types ────────────────────────────────────────────────────────────────
export interface SurvivalPoint {
  month_index: number;
  survival_pct: number;
  conditional_retention: number | null;
  eligible_customers: number;
}

export interface MembershipChartsProps {
  mrrData:               { month: string; mrr: number }[];
  growthData:            { month: string; signups: number; active: number }[];
  cohortTriangle:        Record<string, Record<string, number>>;
  cohortSizes:           Record<string, number>;
  survivalCurve:         SurvivalPoint[];
  billingCycleDist:      { billed_1: number; billed_2: number; billed_3: number; billed_4plus: number };
  realizedRevPerStarter: Record<string, number>;
  monthlyChurn:          { month: string; churn_rate: number; base: number }[];
  ltvAssumptions:        { intro_price: number; recurring_price: number; tail_retention: number; tail_months: number };
  projectedLtv:          number;
  conservativeLtv:       number;
  avgMonthlyChurn:       number;
}

// ── heatmap colour helper ─────────────────────────────────────────────────────
function heatColor(pct: number): string {
  const a = [220, 38, 38];
  const b = [217, 119, 6];
  const c = [22, 163, 74];
  let x: number[];
  if (pct <= 50) {
    const t = pct / 50;
    x = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  } else {
    const t = (pct - 50) / 50;
    x = b.map((v, i) => Math.round(v + (c[i] - v) * t));
  }
  return `rgb(${x[0]},${x[1]},${x[2]})`;
}

function fmtCohortKey(key: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [yr, mo] = key.split('-');
  return (months[parseInt(mo) - 1] ?? mo) + " '" + yr.slice(2);
}

// ── shared card wrapper ───────────────────────────────────────────────────────
function ChartCard({
  title, desc, flag, flagColor = RED, children,
}: {
  title: string; desc: string; flag?: string; flagColor?: string; children: ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: '20px 22px 16px', position: 'relative', display: 'flex', flexDirection: 'column',
    }}>
      {flag && (
        <span style={{
          position: 'absolute', top: 16, right: 16,
          fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase',
          color: flagColor, background: `${flagColor}18`, border: `1px solid ${flagColor}50`,
          padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center',
        }}>
          {flag}
        </span>
      )}
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: '0.77rem', color: MUTED, marginBottom: 14, lineHeight: 1.45, paddingRight: flag ? 110 : 0 }}>{desc}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function MembershipCharts({
  mrrData, growthData, cohortTriangle, cohortSizes, survivalCurve,
  billingCycleDist, realizedRevPerStarter, monthlyChurn, ltvAssumptions,
  projectedLtv, conservativeLtv, avgMonthlyChurn,
}: MembershipChartsProps) {

  // ── LTV chart data ──────────────────────────────────────────────────────────
  let cum = 0;
  const ltvData = [
    ...survivalCurve.map(s => {
      const price = s.month_index === 0 ? ltvAssumptions.intro_price : ltvAssumptions.recurring_price;
      const contrib = Math.round(price * s.survival_pct * 100) / 100;
      cum += contrib;
      return { label: `Mo ${s.month_index}`, contrib, cumulative: Math.round(cum * 100) / 100 };
    }),
    ...(projectedLtv > conservativeLtv ? [{
      label: 'Tail',
      contrib: Math.round((projectedLtv - conservativeLtv) * 100) / 100,
      cumulative: Math.round(projectedLtv * 100) / 100,
    }] : []),
  ];
  const classicalLtv = avgMonthlyChurn > 0
    ? Math.round(ltvAssumptions.recurring_price / avgMonthlyChurn)
    : 117;
  const ltvYMax = Math.max(classicalLtv + 20, projectedLtv + 20);

  // ── Realized revenue chart data ─────────────────────────────────────────────
  const realizedData = Object.entries(realizedRevPerStarter)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v], i, arr) => ({
      cohort: fmtCohortKey(k),
      realized: Math.round(v * 100) / 100,
      fill: i === 0 ? GREEN : i === arr.length - 1 ? RED : AMBER,
    }));

  // ── Cohort retention curves ─────────────────────────────────────────────────
  const cohortColors = [AMBER, GREEN, BLUE, VIOLET, RED];
  const cohortKeys = Object.keys(cohortTriangle).sort();
  const maxK = Math.max(...cohortKeys.map(k => Object.keys(cohortTriangle[k]).length));
  const curveLabels = Array.from({ length: maxK }, (_, i) => `Mo ${i}`);
  const curveDatasets = cohortKeys.map((ck, idx) => ({
    key: ck,
    label: fmtCohortKey(ck),
    color: cohortColors[idx % cohortColors.length],
    data: curveLabels.map((_, i) => {
      const v = cohortTriangle[ck]?.[String(i)];
      return v !== undefined ? Math.round(v * 1000) / 10 : null;
    }),
  }));
  const curveChartData = curveLabels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    curveDatasets.forEach(ds => { row[ds.key] = ds.data[i]; });
    return row;
  });

  // ── Billing cycle data ──────────────────────────────────────────────────────
  const cycleData = [
    { label: '4+ months', count: billingCycleDist.billed_4plus, fill: GREEN },
    { label: '3 months',  count: billingCycleDist.billed_3,     fill: '#059669' },
    { label: '2 months',  count: billingCycleDist.billed_2,     fill: AMBER },
    { label: '1 month',   count: billingCycleDist.billed_1,     fill: RED },
  ];

  // ── Churn chart data ────────────────────────────────────────────────────────
  const churnData = monthlyChurn.map(m => ({
    month: fmtCohortKey(m.month),
    churn: Math.round(m.churn_rate * 1000) / 10,
  }));

  // ── Heatmap cohort order ────────────────────────────────────────────────────
  const heatCohorts = cohortKeys;
  const maxHeatK = Math.max(
    ...heatCohorts.map(k => Object.keys(cohortTriangle[k]).length),
    0,
  );

  return (
    <>
      {/* ── Charts grid ─────────────────────────────────────────────────────── */}
      <style>{`
        .mem-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
        .mem-span7 { grid-column: span 7; }
        .mem-span5 { grid-column: span 5; }
        .mem-span6 { grid-column: span 6; }
        .mem-span12 { grid-column: span 12; }
        @media (max-width: 1100px) {
          .mem-span7, .mem-span5, .mem-span6 { grid-column: span 12; }
        }
      `}</style>

      <div className="mem-grid">

        {/* 1. MRR */}
        <div className="mem-span7">
          <ChartCard title="Monthly Recurring Revenue" desc="Net membership revenue collected each month. Climbing fast on new acquisition.">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={mrrData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={axisStyle} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<DarkTooltip valueFormatter={v => fmtDollar(v)} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="mrr" name="MRR" radius={[6, 6, 0, 0]} maxBarSize={64}>
                  {mrrData.map((_, i) => (
                    <Cell key={i} fill={`rgba(200,168,138,${0.6 + (i / Math.max(mrrData.length - 1, 1)) * 0.4})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 2. Member Growth */}
        <div className="mem-span5">
          <ChartCard title="Member Growth" desc="New signups (bars) vs. total active paying base (line).">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={growthData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: MUTED }} iconType="circle" iconSize={8} />
                <Bar dataKey="signups" name="New signups" fill={`${BLUE}88`} radius={[4, 4, 0, 0]} maxBarSize={42} />
                <Line dataKey="active" name="Active members" type="monotone" stroke={GREEN} strokeWidth={2.5} dot={{ fill: GREEN, r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 3. Cohort Heatmap */}
        <div className="mem-span7">
          <ChartCard
            title="Cohort Retention"
            desc="Share of each joining cohort still being billed in later months. Retention decays steeply after the first cycle."
            flag="Core Challenge"
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 5, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: '0.65rem', color: MUTED, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 4, textAlign: 'left' }}>Cohort</th>
                    {Array.from({ length: maxHeatK }, (_, k) => (
                      <th key={k} style={{ fontSize: '0.65rem', color: MUTED, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 4, textAlign: 'center' }}>
                        Month {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatCohorts.map(ck => {
                    const size = cohortSizes[ck] ?? 0;
                    return (
                      <tr key={ck}>
                        <td style={{ padding: '10px 4px', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          {fmtCohortKey(ck)}
                          {size > 0 && (
                            <span style={{ display: 'block', color: MUTED, fontWeight: 400, fontSize: '0.68rem', marginTop: 1 }}>
                              {size} joined
                            </span>
                          )}
                        </td>
                        {Array.from({ length: maxHeatK }, (_, k) => {
                          const v = cohortTriangle[ck]?.[String(k)];
                          if (v === undefined) {
                            return (
                              <td key={k} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 8, background: 'var(--surface2)', color: MUTED, fontSize: '0.78rem' }}>—</td>
                            );
                          }
                          const pct = Math.round(v * 100);
                          const bgColor = heatColor(pct);
                          const cnt = size > 0 ? Math.round(size * v) : null;
                          return (
                            <td key={k} style={{
                              textAlign: 'center', padding: '10px 6px', borderRadius: 8,
                              background: bgColor, color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                            }}>
                              {pct}%
                              {cnt !== null && (
                                <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 400, opacity: 0.85, marginTop: 1 }}>{cnt} mbrs</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.7rem', color: MUTED, fontFamily: 'var(--font-mono)' }}>
              <span>Low</span>
              <div style={{ height: 8, width: 120, borderRadius: 4, background: `linear-gradient(90deg, ${RED}, ${AMBER}, ${GREEN})` }} />
              <span>High retention</span>
            </div>
          </ChartCard>
        </div>

        {/* 4. Retention Curves */}
        <div className="mem-span5">
          <ChartCard title="Retention Curves" desc="Same cohorts, plotted by months since joining. Every curve falls off the intro-to-full-price cliff.">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={curveChartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  content={<DarkTooltip valueFormatter={(v) => `${v}%`} />}
                  cursor={{ stroke: 'rgba(0,0,0,0.1)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: MUTED }} iconType="circle" iconSize={8} />
                {curveDatasets.map(ds => (
                  <Line
                    key={ds.key}
                    dataKey={ds.key}
                    name={ds.label}
                    type="monotone"
                    stroke={ds.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: ds.color }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 5. Monthly Churn */}
        <div className="mem-span6">
          <ChartCard
            title="Monthly Churn Rate"
            desc="% of active members lost month-over-month. Dashed line marks a healthy ~10% ceiling for a consumer sub."
            flag="Watch"
            flagColor={AMBER}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={churnData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 55]} tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                <Tooltip content={<DarkTooltip valueFormatter={v => `${v}% of members lost`} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <ReferenceLine
                  y={10}
                  stroke={GREEN}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: 'healthy ~10%', position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)', fill: GREEN, dy: -4 }}
                />
                <Bar dataKey="churn" name="Churn" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {churnData.map((d, i) => (
                    <Cell key={i} fill={`rgba(220,38,38,${0.5 + (i / Math.max(churnData.length - 1, 1)) * 0.45})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 6. Billing Cycles */}
        <div className="mem-span6">
          <ChartCard
            title="Billing Cycles per Member"
            desc="How many months each member has paid. Majority pay once and leave before the full-price charge."
            flag="Revenue Leak"
            flagColor={AMBER}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cycleData} layout="vertical" margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis dataKey="label" type="category" tick={axisStyle} axisLine={false} tickLine={false} width={72} />
                <Tooltip content={<DarkTooltip valueFormatter={v => `${v} members`} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" name="Members" radius={[0, 6, 6, 0]} maxBarSize={40}>
                  {cycleData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 7. LTV Build-up */}
        <div className="mem-span7">
          <ChartCard
            title="Subscriber LTV — built from actual churn"
            desc={`Each month pays its real price ($${ltvAssumptions.intro_price} intro, then $${ltvAssumptions.recurring_price}) weighted by the share still subscribed. Dashed line = classical ARPU÷churn — overstated because it ignores intro price and month‑1 cliff.`}
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={ltvData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis domain={[0, ltvYMax]} tickFormatter={v => `$${v}`} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<DarkTooltip valueFormatter={v => `$${v.toFixed(2)}`} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: MUTED }} iconType="circle" iconSize={8} />
                <ReferenceLine
                  y={classicalLtv}
                  stroke={`${RED}cc`}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: `classical ARPU÷churn $${classicalLtv} (overstated)`, position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)', fill: RED, dy: -4 }}
                />
                <Bar dataKey="contrib" name="Revenue this month" radius={[4, 4, 0, 0]} maxBarSize={54}>
                  {ltvData.map((_, i) => {
                    const fills = [`${BLUE}dd`, `${GREEN}dd`, `${GREEN}99`, `${AMBER}bb`, `${AMBER}77`];
                    return <Cell key={i} fill={fills[Math.min(i, fills.length - 1)]} />;
                  })}
                </Bar>
                <Line dataKey="cumulative" name="Cumulative LTV" type="monotone" stroke={AMBER} strokeWidth={2.5} dot={{ r: 4, fill: AMBER }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* 8. Realized Revenue per Cohort Starter */}
        <div className="mem-span5">
          <ChartCard
            title="Realized $ per Cohort Starter"
            desc="Total billings ÷ starters — pure actuals, no modeling. Older cohorts have banked more simply from more months billed."
            flag="Floor of LTV"
            flagColor={AMBER}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={realizedData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="cohort" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis domain={[0, Math.max(projectedLtv + 20, 90)]} tickFormatter={v => `$${v}`} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<DarkTooltip valueFormatter={v => `$${v.toFixed(2)} per starter`} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <ReferenceLine
                  y={projectedLtv}
                  stroke={`${AMBER}cc`}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: `projected LTV $${projectedLtv.toFixed(0)}`, position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)', fill: AMBER, dy: -4 }}
                />
                <Bar dataKey="realized" name="Realized $" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {realizedData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

      </div>
    </>
  );
}
