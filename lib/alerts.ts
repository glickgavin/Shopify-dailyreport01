import type { Database } from '@/lib/types/database';

type SummaryRow = Database['public']['Tables']['daily_summary']['Row'];

export interface Alert {
  level: 'red' | 'yellow';
  rule: string;
  message: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function avg(rows: SummaryRow[], field: keyof SummaryRow): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (r[field] as number), 0) / rows.length;
}

export function checkAlerts(today: SummaryRow, history: SummaryRow[]): Alert[] {
  const alerts: Alert[] = [];

  const revDropPct  = parseFloat(process.env.ALERT_REVENUE_DROP_PCT  ?? '25') / 100;
  const marginMin   = parseFloat(process.env.ALERT_MARGIN_MIN_PCT    ?? '80');
  const aovDropPct  = parseFloat(process.env.ALERT_AOV_DROP_PCT      ?? '20') / 100;

  // Use up to 7 prior days (history should already be sorted desc, exclude today)
  const prior = history.filter((r) => r.date !== today.date).slice(0, 7);

  if (prior.length >= 3) {
    const avgRevenue = avg(prior, 'total_revenue');
    if (avgRevenue > 0) {
      const drop = (avgRevenue - today.total_revenue) / avgRevenue;
      if (drop > revDropPct) {
        alerts.push({
          level: 'red',
          rule: 'revenue_drop',
          message: `Revenue ${fmt(today.total_revenue)} is ▼${(drop * 100).toFixed(1)}% vs ${prior.length}-day avg ${fmt(avgRevenue)}`,
        });
      }
    }

    const avgCashAov = avg(prior, 'phys_cash_aov');
    if (avgCashAov > 0) {
      const drop = (avgCashAov - today.phys_cash_aov) / avgCashAov;
      if (drop > aovDropPct) {
        alerts.push({
          level: 'yellow',
          rule: 'aov_drop',
          message: `Cash AOV ${fmt(today.phys_cash_aov)} is ▼${(drop * 100).toFixed(1)}% vs avg ${fmt(avgCashAov)}`,
        });
      }
    }
  }

  if (today.total_margin < marginMin) {
    alerts.push({
      level: 'red',
      rule: 'low_margin',
      message: `Margin ${today.total_margin.toFixed(1)}% is below ${marginMin}% threshold`,
    });
  }

  if (today.mem_orders === 0) {
    alerts.push({
      level: 'yellow',
      rule: 'no_memberships',
      message: 'Zero membership orders today',
    });
  }

  return alerts;
}
