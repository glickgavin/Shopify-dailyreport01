import { supabaseAdmin } from '@/lib/supabase';
import MembershipCharts, { type MembershipChartsProps } from './_components/MembershipCharts';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

// ── Types for JSONB cohort_data (all fields optional — older rows may be missing cohort_sizes) ──
type CohortData = {
  cohort_triangle?:              Record<string, Record<string, number>>;
  cohort_sizes?:                 Record<string, number>;
  survival_curve?:               Array<{ month_index: number; survival_pct: number; conditional_retention: number | null; eligible_customers: number }>;
  billing_cycle_distribution?:   { billed_1: number; billed_2: number; billed_3: number; billed_4plus: number };
  realized_revenue_per_starter?: Record<string, number>;
  monthly_churn?:                Array<{ month: string; churn_rate: number; base: number }>;
  ltv_assumptions?:              { intro_price: number; recurring_price: number; tail_retention: number; tail_months: number };
  retention_after_first?:        { rate: number | null; eligible: number };
};

function fmtMonth(isoMonth: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [yr, mo] = isoMonth.split('-');
  return (months[parseInt(mo) - 1] ?? mo) + " '" + yr.slice(2);
}

export default async function MembershipPage() {
  const { data: latest } = await supabaseAdmin
    .from('membership_metrics_daily')
    .select('*')
    .order('metric_date', { ascending: false })
    .limit(1)
    .single();

  if (!latest) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊</div>
          No membership metrics yet. The daily sync will populate data.
        </div>
      </div>
    );
  }

  // ── Parse cohort_data ───────────────────────────────────────────────────────
  const cd = (latest.cohort_data ?? {}) as unknown as CohortData;
  const cohortTriangle        = cd.cohort_triangle              ?? {};
  const cohortSizes           = cd.cohort_sizes                 ?? {};
  const survivalCurve         = cd.survival_curve               ?? [];
  const billingCycleDist      = cd.billing_cycle_distribution   ?? { billed_1: 0, billed_2: 0, billed_3: 0, billed_4plus: 0 };
  const realizedRevPerStarter = cd.realized_revenue_per_starter ?? {};
  const monthlyChurn          = cd.monthly_churn                ?? [];
  const ltvAssumptions        = cd.ltv_assumptions              ?? { intro_price: 9.99, recurring_price: 39.99, tail_retention: 0, tail_months: 0 };
  // Retention among "real subscribers" — members who already got past the
  // one-and-done cliff (renewed at least once). Exact figure is computed by the
  // nightly metrics job; until it lands, fall back to the survival curve:
  // blended monthly retention from month 2 onward (weighted by survivors).
  let retentionAfterFirst = cd.retention_after_first?.rate ?? null;
  if (retentionAfterFirst === null && survivalCurve.length > 2) {
    let wSum = 0, w = 0;
    for (const s of survivalCurve) {
      if (s.month_index < 2 || s.conditional_retention === null) continue;
      const prev = survivalCurve.find(x => x.month_index === s.month_index - 1);
      const weight = (prev?.survival_pct ?? 0) * s.eligible_customers; // ≈ members billed in prior month
      wSum += s.conditional_retention * weight;
      w    += weight;
    }
    if (w > 0) retentionAfterFirst = wSum / w;
  }

  // ── Derive monthly MRR from cohort triangle ─────────────────────────────────
  const mrrByMonth: Record<string, number> = {};
  for (const [cohort, triangle] of Object.entries(cohortTriangle)) {
    const starters = cohortSizes[cohort] ?? 0;
    if (starters === 0) continue;
    const [yearStr, moStr] = cohort.split('-');
    const cohortAbsM = parseInt(yearStr) * 12 + (parseInt(moStr) - 1);
    for (const [kStr, pct] of Object.entries(triangle)) {
      const k     = parseInt(kStr);
      const price = k === 0 ? ltvAssumptions.intro_price : ltvAssumptions.recurring_price;
      const calM  = cohortAbsM + k;
      const yr    = Math.floor(calM / 12);
      const mo    = String((calM % 12) + 1).padStart(2, '0');
      const key   = `${yr}-${mo}`;
      mrrByMonth[key] = (mrrByMonth[key] ?? 0) + starters * (pct as number) * price;
    }
  }
  const sortedMonths = Object.keys(mrrByMonth).sort();
  const mrrData = sortedMonths.map(m => ({
    month: fmtMonth(m),
    mrr:   Math.round(mrrByMonth[m]),
  }));

  // ── Derive growth data: new signups + active members per month ──────────────
  const growthData = sortedMonths.map(m => {
    const signups = cohortSizes[m] ?? 0;
    const churnRow = monthlyChurn.find(x => x.month === m);
    return {
      month:   fmtMonth(m),
      signups,
      active: churnRow?.base ?? 0,
    };
  });
  // Patch current month's active to latest active_members (monthlyChurn omits current month)
  if (growthData.length > 0) {
    growthData[growthData.length - 1].active = latest.active_members;
  }

  // ── Derived KPIs ────────────────────────────────────────────────────────────
  const allTimeMembers = billingCycleDist.billed_1 + billingCycleDist.billed_2 +
                         billingCycleDist.billed_3 + billingCycleDist.billed_4plus;

  const fmtMrr = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;

  const chartProps: MembershipChartsProps = {
    mrrData,
    growthData,
    cohortTriangle,
    cohortSizes,
    survivalCurve,
    billingCycleDist,
    realizedRevPerStarter,
    monthlyChurn,
    ltvAssumptions,
    projectedLtv:    latest.projected_ltv,
    conservativeLtv: latest.conservative_ltv,
    avgMonthlyChurn: latest.avg_monthly_churn,
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            VIP Membership <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Subscription</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Recurring billing analytics · $9.99 intro → $39.99/mo
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--neutral-500)', lineHeight: 1.7 }}>
          <div>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#1D9E75', boxShadow: '0 0 0 3px rgba(29,158,117,0.25)', marginRight: 6, verticalAlign: 'middle' }} />
            <strong style={{ color: 'var(--text)' }}>{latest.active_members}</strong> active members
          </div>
          <div>Data as of <strong style={{ color: 'var(--text)' }}>{latest.metric_date}</strong></div>
        </div>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── KPI row ────────────────────────────────────────────────────────── */}
        <style>{`
          .mem-kpis { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; margin-bottom: 24px; }
          @media (max-width: 1080px) { .mem-kpis { grid-template-columns: repeat(3, 1fr); } }
          @media (max-width: 600px)  { .mem-kpis { grid-template-columns: repeat(2, 1fr); } }
        `}</style>

        <div className="mem-kpis">
          {[
            {
              label: 'Active Members',
              value: String(latest.active_members),
              sub: `${allTimeMembers} all-time`,
              alert: false,
            },
            {
              label: 'Monthly Revenue',
              value: fmtMrr(latest.mrr_net),
              sub: 'last complete month',
              alert: false,
            },
            {
              label: 'Members All-Time',
              value: String(allTimeMembers),
              sub: 'since launch',
              alert: false,
            },
            {
              label: 'Avg Monthly Churn',
              value: `${Math.round(latest.avg_monthly_churn * 100)}%`,
              sub: 'above healthy ~10%',
              alert: true,
            },
            {
              label: 'One-&-Done Rate',
              value: `${Math.round(latest.one_and_done_rate * 100)}%`,
              sub: 'never renew once',
              alert: true,
            },
            {
              label: 'Subscriber Retention',
              value: retentionAfterFirst !== null
                ? `${Math.round(retentionAfterFirst * 100)}%`
                : '—',
              sub: 'monthly · after 1st renewal',
              alert: false,
            },
            {
              label: 'Projected LTV',
              value: `$${Math.round(latest.projected_ltv)}`,
              sub: 'survival-based · actual churn',
              alert: false,
            },
          ].map(({ label, value, sub, alert }) => (
            <div key={label} style={{
              background: alert ? '#fff5f5' : 'var(--surface)',
              border: `1px solid ${alert ? 'rgba(220,38,38,0.3)' : 'var(--border)'}`,
              borderRadius: 14,
              padding: '18px 16px',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: alert ? '#b91c1c' : 'var(--muted)',
                marginBottom: 8,
              }}>{label}</div>
              <div style={{
                fontSize: '1.875rem', fontWeight: 600,
                lineHeight: 1.1, letterSpacing: '-0.02em', color: alert ? '#dc2626' : 'var(--text)',
              }}>{value}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: alert ? '#ef4444' : 'var(--muted)', marginTop: 8 }}>
                {sub}
              </div>
            </div>
          ))}
        </div>

        {/* ── Charts ─────────────────────────────────────────────────────────── */}
        <MembershipCharts {...chartProps} />

        {/* ── Insights ───────────────────────────────────────────────────────── */}
        <div style={{
          marginTop: 16,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '22px 24px',
        }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>
            What the data is telling you
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {[
              {
                accent: '#dc2626',
                icon: '🔻',
                title: 'The intro-price cliff',
                body: `${Math.round(latest.one_and_done_rate * 100)}% of members are billed once and vanish before the $9.99 → $39.99 step-up. The 4× jump is the prime suspect. Test a gentler ramp or longer intro.`,
              },
              {
                accent: '#d97706',
                icon: '⚠️',
                title: 'Thin long-term retention',
                body: `Only ~${Math.round((survivalCurve[3]?.survival_pct ?? 0) * 100)}% of the earliest cohort survived to month 3. Members rarely reach 3+ cycles — lifetime value is capped early.`,
              },
              {
                accent: '#1D9E75',
                icon: '✅',
                title: 'Acquisition & revenue are working',
                body: `LTV is $${Math.round(latest.projected_ltv)} on real churn — lift retention one cycle and it climbs fast, since each saved member adds $${Math.round(ltvAssumptions.recurring_price)}/mo.`,
              },
            ].map(({ accent, icon, title, body }) => (
              <div key={title} style={{ paddingLeft: 14, borderLeft: `2px solid ${accent}` }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{icon}</span> {title}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.55 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div style={{
          marginTop: 24, textAlign: 'center',
          color: 'var(--muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
        }}>
          Reconstructed from Shopify billing events · cancellation vs. failed-payment split lives in the Simplee app
        </div>

      </div>
    </div>
  );
}
