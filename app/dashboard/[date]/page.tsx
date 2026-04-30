import { notFound } from 'next/navigation';
import Link from 'next/link';
import { addDays, subDays, parseISO, isValid, format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import RevenueChart from './RevenueChart';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtDec = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmtPct = (n: number) => `${Number(n).toFixed(1)}%`;

// ── sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      padding: '1.25rem 1.5rem',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.5rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{
      background: highlight ? (color ?? 'var(--cash-blue-light)') : 'transparent',
      borderRadius: highlight ? 8 : 0,
      padding: highlight ? '0.5rem 0.75rem' : '0.25rem 0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: '0.8rem', color: highlight ? 'inherit' : 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontWeight: highlight ? 700 : 500 }}>{value}</span>
    </div>
  );
}

function SegmentCard({
  title,
  revenue,
  orders,
  qty,
  netSales,
  shipping,
  cogs,
  profit,
  margin,
  aov,
  theme,
}: {
  title: string;
  revenue: number;
  orders: number;
  qty: number;
  netSales: number;
  shipping: number;
  cogs: number;
  profit: number;
  margin: number;
  aov: number;
  theme: 'cash' | 'noncash';
}) {
  const isCash = theme === 'cash';
  const accent = isCash ? 'var(--cash-blue)' : 'var(--nc-green)';
  const accentLight = isCash ? 'var(--cash-blue-light)' : 'var(--nc-green-light)';
  const accentDark = isCash ? 'var(--cash-blue-dark)' : 'var(--nc-green-dark)';

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 14,
      border: `1.5px solid ${accent}`,
      padding: '1.5rem',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: accentDark, fontWeight: 500 }}>
          {title}
        </span>
      </div>

      <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '0.25rem', color: accentDark }}>
        {fmt(revenue)}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
        {orders} orders · {qty} units
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <MiniStat label="Net Sales" value={fmtDec(netSales)} />
        <MiniStat label="Shipping" value={fmtDec(shipping)} />
        <MiniStat label="COGS" value={fmtDec(cogs)} />
        <MiniStat label="Gross Profit" value={fmtDec(profit)} />
        <MiniStat label="Margin" value={fmtPct(margin)} />
        <MiniStat label="AOV" value={fmtDec(aov)} highlight color={accentLight} />
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({ params }: { params: { date: string } }) {
  const { date } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValid(parseISO(date))) {
    notFound();
  }

  const [{ data: summary }, { data: products }, { data: memOrders }] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    supabaseAdmin.from('daily_products').select('*').eq('date', date).order('revenue', { ascending: false }),
    supabaseAdmin.from('daily_membership_orders').select('*').eq('date', date).order('order_name'),
  ]);

  if (!summary) notFound();

  const prevDate = format(subDays(parseISO(date), 1), 'yyyy-MM-dd');
  const nextDate = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy');

  const physProducts = (products ?? []).filter((p) => p.item_type === 'Physical' && p.revenue > 0);
  const chartData = physProducts.map((p) => ({
    name: p.variant ? `${p.title.replace('Magic Portrait', 'Portrait')} ${p.variant}` : p.title,
    revenue: Number(p.revenue),
    netSales: Number(p.net_sales),
  }));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#1a1a2e',
        color: '#fff',
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
            Daily Sales <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Dashboard</em>
          </h1>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link href={`/dashboard/${prevDate}`} style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.5rem', borderRadius: 6, transition: 'background 0.15s' }} title="Previous day">‹</Link>
            <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)', fontWeight: 500, minWidth: 210, textAlign: 'center' }}>{displayDate}</span>
            <Link href={`/dashboard/${nextDate}`} style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.5rem', borderRadius: 6 }} title="Next day">›</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a
            href={`/api/dashboard/${date}`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            JSON
          </a>
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── SECTION LABEL HELPER ─ */}
        {/* ── TOTAL KPIs ──────────────────────────────────────────────────── */}
        <SectionLabel>Total Business</SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1rem',
          marginBottom: '2rem',
        }}>
          <KpiCard label="Net Sales" value={fmt(summary.total_net_sales)} sub={`${summary.total_orders} orders · ${summary.total_qty} units`} />
          <KpiCard label="Shipping" value={fmt(summary.total_shipping)} />
          <KpiCard label="Total Revenue" value={fmt(summary.total_revenue)} />
          <KpiCard label="COGS" value={fmt(summary.total_cogs)} />
          <KpiCard label="Gross Profit" value={fmt(summary.total_profit)} />
          <KpiCard label="Margin" value={fmtPct(summary.total_margin)} sub={`AOV ${fmtDec(summary.total_aov)}`} />
        </div>

        {/* ── PHYSICAL SEGMENTS ───────────────────────────────────────────── */}
        <SectionLabel>Physical Sales</SectionLabel>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          <SegmentCard
            title="Physical Cash"
            theme="cash"
            revenue={summary.phys_cash_revenue}
            orders={summary.phys_cash_orders}
            qty={summary.phys_cash_qty}
            netSales={summary.phys_cash_net_sales}
            shipping={summary.phys_cash_shipping}
            cogs={summary.phys_cash_cogs}
            profit={summary.phys_cash_profit}
            margin={summary.phys_cash_margin}
            aov={summary.phys_cash_aov}
          />
          <SegmentCard
            title="Physical Non-Cash"
            theme="noncash"
            revenue={summary.phys_non_cash_revenue}
            orders={summary.phys_non_cash_orders}
            qty={summary.phys_non_cash_qty}
            netSales={summary.phys_non_cash_net_sales}
            shipping={summary.phys_non_cash_shipping}
            cogs={summary.phys_non_cash_cogs}
            profit={summary.phys_non_cash_profit}
            margin={summary.phys_non_cash_margin}
            aov={summary.phys_non_cash_aov}
          />
        </div>

        {/* ── PRODUCTS TABLE ──────────────────────────────────────────────── */}
        <SectionLabel>Products</SectionLabel>
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
                {['Product', 'Variant', 'Type', 'Qty', 'Orders', 'Net Sales', 'Shipping', 'COGS', 'Revenue'].map((h) => (
                  <th key={h} style={{
                    padding: '0.75rem 1rem',
                    textAlign: h === 'Product' || h === 'Variant' || h === 'Type' ? 'left' : 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.68rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: 'var(--muted)',
                    fontWeight: 500,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p, i) => (
                <tr
                  key={`${p.title}-${p.variant}`}
                  style={{
                    borderBottom: i < (products ?? []).length - 1 ? '1px solid var(--border)' : 'none',
                    background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{p.title}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>{p.variant || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 6,
                      background: p.item_type === 'Membership' ? 'var(--nc-green-light)' : 'var(--cash-blue-light)',
                      color: p.item_type === 'Membership' ? 'var(--nc-green-dark)' : 'var(--cash-blue-dark)',
                      fontWeight: 500,
                    }}>
                      {p.item_type === 'Membership' ? 'MEM' : 'PHY'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{p.qty}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{p.orders}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.net_sales)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.shipping)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.cogs)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{fmtDec(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                <td colSpan={3} style={{ padding: '0.75rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>Total</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{summary.total_qty}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{summary.total_orders}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(summary.total_net_sales)}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(summary.total_shipping)}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(summary.total_cogs)}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(summary.total_revenue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── MEMBERSHIP ──────────────────────────────────────────────────── */}
        <SectionLabel>Membership</SectionLabel>
        <div style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1.5px solid var(--nc-green)',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Revenue', value: fmt(summary.mem_revenue) },
              { label: 'Net Sales', value: fmtDec(summary.mem_net_sales) },
              { label: 'Orders', value: String(summary.mem_orders) },
              { label: 'Units', value: String(summary.mem_qty) },
              { label: 'Margin', value: fmtPct(summary.mem_margin) },
              { label: 'AOV', value: fmtDec(summary.mem_aov) },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--nc-green-dark)', marginBottom: '0.25rem' }}>{label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--nc-green-dark)' }}>{value}</div>
              </div>
            ))}
          </div>

          {(memOrders ?? []).length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Order', 'Type', 'Net Sales', 'Shipping', 'Revenue'].map((h) => (
                    <th key={h} style={{
                      padding: '0.5rem 0.75rem',
                      textAlign: h === 'Order' || h === 'Type' ? 'left' : 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--nc-green-dark)',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(memOrders ?? []).map((m, i) => (
                  <tr
                    key={m.order_name}
                    style={{ borderBottom: i < (memOrders ?? []).length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}
                  >
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{m.order_name}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{
                        fontSize: '0.65rem',
                        fontFamily: 'var(--font-mono)',
                        padding: '0.15rem 0.4rem',
                        borderRadius: 5,
                        background: m.membership_type === 'recurring' ? 'var(--nc-green-light)' : 'var(--surface2)',
                        color: m.membership_type === 'recurring' ? 'var(--nc-green-dark)' : 'var(--muted)',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        {m.membership_type}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{fmtDec(m.net_sales)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{fmtDec(m.shipping)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{fmtDec(m.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── CHART ───────────────────────────────────────────────────────── */}
        {chartData.length > 0 && (
          <>
            <SectionLabel>Revenue by Product</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1px solid var(--border)',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <RevenueChart data={chartData} />
            </div>
          </>
        )}

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'var(--muted)',
      marginBottom: '0.75rem',
    }}>
      {children}
    </div>
  );
}
