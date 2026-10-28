import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import CreditTrendChart, { type CreditMonth } from './CreditTrendChart';

export const dynamic = 'force-dynamic';

// Store Credit — every customer holding credit, searchable, with monthly
// change tracking. Data: credit_monthly_history (one snapshot per month from
// the monthly bulk export); the latest month is "current", the prior month
// feeds the Δ column. Server-side search + pagination (≈47k rows).

const PAGE_SIZE = 100;

const usd = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

function fmtMonthLabel(iso: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m] = iso.split('-');
  return `${months[parseInt(m) - 1]} '${y.slice(2)}`;
}

interface Row {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  credit_cents: number;
  in_segment: boolean;
  prev_cents: number | null;
}

export default async function CreditPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; scope?: string; sort?: string };
}) {
  const q = (searchParams.q ?? '').trim();
  const page = Math.max(0, parseInt(searchParams.page ?? '0', 10) || 0);
  const scope = searchParams.scope === 'members' ? 'members' : 'all';
  const sort = searchParams.sort === 'change' ? 'change' : 'credit';

  // Which months exist?
  const { data: monthRows } = await (supabaseAdmin as any)
    .from('credit_monthly_history')
    .select('month, credit_cents.sum(), customer_id.count()')
    .order('month', { ascending: true });

  const monthAgg = ((monthRows ?? []) as { month: string; sum: number; count: number }[]);
  const months: CreditMonth[] = monthAgg.map(m => ({
    month: fmtMonthLabel(m.month.slice(0, 7)),
    total_usd: Math.round(m.sum / 100),
    holders: m.count,
  }));
  const latestMonth = monthAgg.length > 0 ? monthAgg[monthAgg.length - 1].month : null;
  const priorMonth  = monthAgg.length > 1 ? monthAgg[monthAgg.length - 2].month : null;

  let rows: Row[] = [];
  let totalCount = 0;
  let latestTotalCents = 0;
  let priorTotalCents: number | null = null;

  if (latestMonth) {
    latestTotalCents = monthAgg[monthAgg.length - 1].sum;
    if (priorMonth) priorTotalCents = monthAgg[monthAgg.length - 2].sum;

    let query = (supabaseAdmin as any)
      .from('credit_monthly_history')
      .select('customer_id, email, display_name, credit_cents, in_segment', { count: 'exact' })
      .eq('month', latestMonth);
    if (scope === 'members') query = query.eq('in_segment', true);
    if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%,customer_id.ilike.%${q}%`);
    query = query.order('credit_cents', { ascending: false }).order('customer_id', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (!error) {
      totalCount = count ?? 0;
      const pageRows = (data ?? []) as Omit<Row, 'prev_cents'>[];

      // Prior-month balances for just the visible rows (Δ column).
      const prevMap = new Map<string, number>();
      if (priorMonth && pageRows.length > 0) {
        const { data: prev } = await (supabaseAdmin as any)
          .from('credit_monthly_history')
          .select('customer_id, credit_cents')
          .eq('month', priorMonth)
          .in('customer_id', pageRows.map(r => r.customer_id));
        for (const p of (prev ?? []) as { customer_id: string; credit_cents: number }[]) {
          prevMap.set(p.customer_id, p.credit_cents);
        }
      }
      rows = pageRows.map(r => ({ ...r, prev_cents: priorMonth ? (prevMap.get(r.customer_id) ?? 0) : null }));
      if (sort === 'change' && priorMonth) {
        rows = [...rows].sort((a, b) => Math.abs((b.credit_cents - (b.prev_cents ?? 0))) - Math.abs((a.credit_cents - (a.prev_cents ?? 0))));
      }
    }
  }

  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const urlFor = (p: { q?: string; page?: number; scope?: string }) => {
    const sp = new URLSearchParams();
    const qq = p.q ?? q; if (qq) sp.set('q', qq);
    const sc = p.scope ?? scope; if (sc !== 'all') sp.set('scope', sc);
    const pg = p.page ?? 0; if (pg > 0) sp.set('page', String(pg));
    const s = sp.toString();
    return `/dashboard/credit${s ? `?${s}` : ''}`;
  };

  const deltaTotal = priorTotalCents !== null ? latestTotalCents - priorTotalCents : null;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            Store <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Credit</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Every customer holding credit · monthly snapshots{latestMonth ? ` · latest: ${fmtMonthLabel(latestMonth.slice(0, 7))}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--neutral-500)' }}>
          {latestMonth ? `${num(totalCount)} holders in view · ${usd(latestTotalCents)} total` : 'first snapshot pending'}
        </div>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {!latestMonth && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '2.5rem', textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            The first monthly snapshot is being captured (a store-wide export — allow about an hour after deploy). This page fills in automatically.
          </div>
        )}

        {latestMonth && (
          <>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
              {[
                { label: 'Credit Holders', value: num(monthAgg[monthAgg.length - 1].count), sub: fmtMonthLabel(latestMonth.slice(0, 7)) },
                { label: 'Total Credit Held', value: usd(latestTotalCents), sub: 'all customers' },
                { label: 'Change vs Prior Month', value: deltaTotal !== null ? `${deltaTotal >= 0 ? '+' : '−'}${usd(Math.abs(deltaTotal))}` : '—', sub: priorMonth ? `vs ${fmtMonthLabel(priorMonth.slice(0, 7))}` : 'from next month' },
              ].map(({ label, value, sub }) => (
                <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8 }}>{label}</div>
                  <div style={{ fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{value}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: 8 }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Trend */}
            <CreditTrendChart months={months} />

            {/* Controls */}
            <form action="/dashboard/credit" method="get" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {scope !== 'all' && <input type="hidden" name="scope" value={scope} />}
              <input
                name="q"
                defaultValue={q}
                placeholder="Search name, email or customer ID…"
                style={{ flex: 1, minWidth: 240, padding: '0.6rem 0.9rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.85rem', color: 'var(--text)' }}
              />
              <button type="submit" style={{ padding: '0.55rem 1rem', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Search</button>
              {q && (
                <Link href={urlFor({ q: '', page: 0 })} style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>clear</Link>
              )}
              <div style={{ flex: 1 }} />
              {[
                { key: 'all', label: 'All credit holders' },
                { key: 'members', label: 'Active members' },
              ].map(t => (
                <Link key={t.key} href={urlFor({ scope: t.key, page: 0 })} style={{
                  padding: '0.35rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textDecoration: 'none',
                  border: '1px solid var(--border)',
                  background: scope === t.key ? 'var(--accent-100)' : 'var(--neutral-100)',
                  color: scope === t.key ? '#fff' : 'var(--neutral-600)',
                  fontWeight: scope === t.key ? 600 : 400,
                }}>{t.label}</Link>
              ))}
            </form>

            {/* Table */}
            <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    {['Customer', 'Email', 'Credit', priorMonth ? `Δ vs ${fmtMonthLabel(priorMonth.slice(0, 7))}` : 'Δ (from next month)', 'Member', 'ID'].map((h, hi) => (
                      <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: hi >= 2 && hi <= 3 ? 'right' : hi >= 4 ? 'right' : 'left', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No customers match.</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const delta = r.prev_cents !== null ? r.credit_cents - r.prev_cents : null;
                    return (
                      <tr key={r.customer_id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                        <td style={{ padding: '0.55rem 0.875rem', fontWeight: 500 }}>{r.display_name || '—'}</td>
                        <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--neutral-600)' }}>{r.email ?? '—'}</td>
                        <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{usd(r.credit_cents)}</td>
                        <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: delta === null ? 'var(--muted)' : delta > 0 ? '#15803d' : delta < 0 ? '#b91c1c' : 'var(--muted)' }}>
                          {delta === null ? '—' : delta === 0 ? '±$0' : `${delta > 0 ? '+' : '−'}${usd(Math.abs(delta))}`}
                        </td>
                        <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right' }}>
                          {r.in_segment ? <span style={{ background: '#dcfce7', color: '#15803d', padding: '0.1rem 0.45rem', borderRadius: 5, fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>member</span> : <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>}
                        </td>
                        <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>{r.customer_id.split('/').pop()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', justifyContent: 'flex-end', marginTop: '0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
              {page > 0
                ? <Link href={urlFor({ page: page - 1 })} style={{ padding: '0.3rem 0.8rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none' }}>‹ Prev</Link>
                : <span style={{ padding: '0.3rem 0.8rem', color: 'var(--muted)' }}>‹ Prev</span>}
              <span style={{ color: 'var(--muted)' }}>page {page + 1} / {pages} · {num(totalCount)} customers</span>
              {page < pages - 1
                ? <Link href={urlFor({ page: page + 1 })} style={{ padding: '0.3rem 0.8rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none' }}>Next ›</Link>
                : <span style={{ padding: '0.3rem 0.8rem', color: 'var(--muted)' }}>Next ›</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
