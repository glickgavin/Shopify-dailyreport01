import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import HistoryChart from './HistoryChart';
import HistoryTable from './HistoryTable';

export const revalidate = 3600;

export default async function HistoryPage() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const { data: rows } = await supabaseAdmin
    .from('daily_summary')
    .select('date,total_revenue,total_net_sales,total_orders,total_margin,phys_cash_revenue,phys_non_cash_revenue,mem_revenue,mem_orders')
    .gte('date', startDate)
    .order('date', { ascending: false });

  const safeRows = (rows ?? []).map((r) => ({
    date: r.date,
    total_revenue: r.total_revenue ?? 0,
    total_net_sales: r.total_net_sales ?? 0,
    total_orders: r.total_orders ?? 0,
    total_margin: r.total_margin ?? 0,
    phys_cash_revenue: r.phys_cash_revenue ?? 0,
    phys_non_cash_revenue: r.phys_non_cash_revenue ?? 0,
    mem_revenue: r.mem_revenue ?? 0,
    mem_orders: r.mem_orders ?? 0,
  }));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
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
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
          Sales <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>History</em>
        </h1>
        <Link
          href="/dashboard"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '0.4rem 0.875rem',
            fontSize: '0.8rem',
            textDecoration: 'none',
            fontFamily: 'var(--font-mono)',
          }}
        >
          ← Dashboard
        </Link>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Chart */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '1rem' }}>
            Revenue — Last 30 Days
          </div>
          {safeRows.length > 0 ? (
            <HistoryChart rows={safeRows} />
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>
              No data yet. Run the backfill to populate history.
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          padding: '1.5rem',
        }}>
          <HistoryTable rows={safeRows} />
        </div>

      </div>
    </div>
  );
}
