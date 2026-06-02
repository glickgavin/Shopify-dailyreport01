import type { PeriodEntry, PeriodStats } from './page';

const fmtRev = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function Delta({ current, prior, type }: {
  current: number;
  prior: number;
  type: 'pct' | 'pp';
}) {
  if (prior === 0) return <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>—</span>;
  const raw = type === 'pct'
    ? ((current - prior) / prior) * 100
    : current - prior;
  const up = raw >= 0;
  const label = type === 'pct'
    ? `${Math.abs(raw).toFixed(1)}%`
    : `${Math.abs(raw).toFixed(1)}pp`;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: '0.72rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
      color: up ? '#15803d' : '#dc2626',
    }}>
      {up ? '▲' : '▼'} {label}
    </span>
  );
}

const METRICS: Array<{
  key: keyof PeriodStats;
  label: string;
  fmt: (n: number) => string;
  deltaType: 'pct' | 'pp';
  higherIsBetter: boolean;
}> = [
  { key: 'revenue', label: 'Revenue',  fmt: fmtRev,                            deltaType: 'pct', higherIsBetter: true  },
  { key: 'orders',  label: 'Orders',   fmt: (n) => n.toLocaleString(),          deltaType: 'pct', higherIsBetter: true  },
  { key: 'aov',     label: 'AOV',      fmt: (n) => fmtRev(n),                  deltaType: 'pct', higherIsBetter: true  },
  { key: 'margin',  label: 'Margin',   fmt: (n) => `${n.toFixed(1)}%`,         deltaType: 'pp',  higherIsBetter: true  },
  { key: 'gp',      label: 'GP − Ads',    fmt: fmtRev,                         deltaType: 'pct', higherIsBetter: true  },
];

const PERIOD_LABELS: Record<string, string> = {
  '1D': 'vs prev day',
  '3D': 'vs prior 3D',
  '7D': 'vs prior 7D',
  '30D': 'vs prior 30D',
};

export default function HistoryPeriodTable({ periods }: { periods: PeriodEntry[] }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* Card header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
          Period Summary
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{
                padding: '0.75rem 1.5rem', textAlign: 'left',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--muted)', fontWeight: 500, width: 120,
              }}>
                Metric
              </th>
              {periods.map((p) => (
                <th key={p.label} style={{
                  padding: '0.75rem 1.5rem', textAlign: 'right',
                  fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: 'var(--muted)', fontWeight: 500,
                }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em', marginBottom: 2 }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                    {p.days === 1 ? 'yesterday' : `last ${p.days} days`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m, mi) => (
              <tr key={m.key} style={{
                borderBottom: mi < METRICS.length - 1 ? '1px solid var(--border)' : 'none',
                background: mi % 2 === 1 ? 'var(--surface2)' : 'transparent',
              }}>
                <td style={{
                  padding: '1rem 1.5rem',
                  fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--muted)', fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}>
                  {m.label}
                </td>
                {periods.map((p) => {
                  const curr = p.current[m.key];
                  const prev = p.prior?.[m.key] ?? null;
                  return (
                    <td key={p.label} style={{
                      padding: '1rem 1.5rem', textAlign: 'right',
                      verticalAlign: 'middle',
                    }}>
                      <div style={{
                        fontSize: '1.15rem', fontWeight: 600, letterSpacing: '-0.02em',
                        color: 'var(--text)', lineHeight: 1.2, marginBottom: 4,
                      }}>
                        {m.fmt(curr)}
                      </div>
                      {prev !== null && (
                        <div>
                          <Delta current={curr} prior={prev} type={m.deltaType} />
                          <span style={{ color: 'var(--muted)', fontSize: '0.62rem', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
                            {PERIOD_LABELS[p.label]}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
