import Link from 'next/link';
import { format } from 'date-fns';
import {
  buildManAccounts, parseView, cell, varianceCell, pctChangeCell, fmtUsd,
  INCOME_ROWS, CASHFLOW_ROWS, payoutRows, KPI_ROWS, type RowDef,
} from '@/lib/man-accounts';

export const dynamic = 'force-dynamic';

// Man Accounts — pro-forma management accounts as a columnar grid.
// Data assembly lives in lib/man-accounts.ts (shared with the CSV/PDF
// exports). MTD adds a prev-month-to-date comparison plus Variance and Δ%.

export default async function ManAccountsPage({
  searchParams,
}: {
  searchParams: { view?: string; today?: string };
}) {
  const view = parseView(searchParams.view);
  const includeToday = searchParams.today === '1';
  const { asOf, cols, totals, prevTotals, prevLabel, hasShopifyPayouts } =
    await buildManAccounts(view, includeToday);

  const extraCols = prevTotals ? 3 : 0; // prev MTD + Variance + Δ%
  const nCols = cols.length + 2 + extraCols;
  const qs = `view=${view}${includeToday ? '&today=1' : ''}`;

  const renderRows = (rows: RowDef[]) => rows.map((r, i) => {
    if (r.kind === 'gap') return <tr key={`gap-${i}`}><td colSpan={nCols} style={{ height: 14 }} /></tr>;
    if (r.kind === 'head') {
      return (
        <tr key={r.label}>
          <td colSpan={nCols} style={{ padding: '1.1rem 0 0.45rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--accent)' }}>
            {r.label}
          </td>
        </tr>
      );
    }
    const strong = r.kind === 'total' || r.kind === 'subtotal';
    const tdBase: React.CSSProperties = {
      padding: '0.32rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: '0.8rem',
      fontWeight: r.kind === 'total' ? 700 : strong ? 600 : 400,
      borderTop: r.kind === 'total' ? '2px solid var(--text)' : r.kind === 'subtotal' ? '1px solid var(--border)' : undefined,
    };
    const v = r.get(totals);
    const p = prevTotals ? r.get(prevTotals) : null;
    // Direction color for variance: more is good, unless the row is a cost
    // (neg), where more is bad.
    const diff = v !== null && p !== null ? v - p : null;
    const varColor = diff === null || diff === 0 ? 'var(--muted)'
      : (diff > 0) !== Boolean(r.neg) ? 'var(--accent2-900)' : '#b91c1c';
    return (
      <tr key={r.label} style={{ background: strong ? 'rgba(0,0,0,0.02)' : undefined }}>
        <td style={{
          padding: '0.32rem 0.6rem', paddingLeft: r.kind === 'sub' ? '1.4rem' : '0.6rem',
          whiteSpace: 'nowrap', fontWeight: strong ? 600 : 400, fontSize: '0.84rem',
          position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1,
          borderTop: r.kind === 'total' ? '2px solid var(--text)' : r.kind === 'subtotal' ? '1px solid var(--border)' : undefined,
        }}>
          {r.label}
        </td>
        {cols.map(c => {
          const cv = r.get(c.m);
          return <td key={c.key} style={{ ...tdBase, color: cv !== null && r.neg && cv !== 0 ? '#b91c1c' : cv !== null && r.kind === 'total' && cv < 0 ? '#b91c1c' : 'var(--text)' }}>{cell(cv, r.neg, r.fmt)}</td>;
        })}
        <td style={{ ...tdBase, fontWeight: 700, background: 'rgba(23,169,123,0.06)', color: r.neg && (v ?? 0) !== 0 ? '#b91c1c' : r.kind === 'total' && (v ?? 0) < 0 ? '#b91c1c' : 'var(--text)' }}>
          {cell(v, r.neg, r.fmt)}
        </td>
        {prevTotals && (
          <>
            <td style={{ ...tdBase, background: 'rgba(0,0,0,0.03)', color: r.neg && (p ?? 0) !== 0 ? '#b91c1c' : r.kind === 'total' && (p ?? 0) < 0 ? '#b91c1c' : 'var(--muted)' }}>
              {cell(p, r.neg, r.fmt)}
            </td>
            <td style={{ ...tdBase, color: varColor }}>{varianceCell(v, p, r.fmt)}</td>
            <td style={{ ...tdBase, color: varColor }}>{pctChangeCell(v, p)}</td>
          </>
        )}
      </tr>
    );
  });

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
              Man <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Accounts</em>
            </h1>
            <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              Pro-forma management accounts · {view === 'day' ? 'last 7 days' : view === 'mtd' ? `month to date (${format(asOf, 'MMMM yyyy')})` : `monthly since Jan 2026 (incl. current month)`}
            </div>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {([['month', 'By Month'], ['day', 'By Day'], ['mtd', 'MTD']] as const).map(([k, l]) => (
              <Link key={k} href={`/dashboard/man-accounts${k === 'month' ? '' : `?view=${k}`}`} style={{
                padding: '0.3rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
                textDecoration: 'none',
                border: view === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: view === k ? 'var(--accent)' : 'var(--neutral-100)',
                color: view === k ? '#fff' : 'var(--neutral-600)',
                fontWeight: view === k ? 600 : 400,
              }}>{l}</Link>
            ))}
            {view !== 'month' && (
              <Link
                href={`/dashboard/man-accounts?view=${view}${includeToday ? '' : '&today=1'}`}
                style={{
                  padding: '0.3rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
                  textDecoration: 'none', border: '1px dashed var(--border)', marginLeft: '0.5rem',
                  background: 'var(--neutral-100)', color: 'var(--neutral-600)',
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                <span aria-hidden style={{ fontSize: '0.9em' }}>{includeToday ? '☑' : '☐'}</span>
                include today
              </Link>
            )}
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 0.35rem' }} />
            {([['pdf', 'PDF'], ['csv', 'Excel/Sheets (CSV)']] as const).map(([k, l]) => (
              <a key={k} href={`/api/export/man-accounts/${k}?${qs}`} style={{
                padding: '0.3rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
                textDecoration: 'none', border: '1px solid var(--border)',
                background: 'var(--neutral-100)', color: 'var(--neutral-600)',
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              }}>
                <span aria-hidden style={{ fontSize: '0.9em' }}>{'⤓'}</span>
                {l}
              </a>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--neutral-500)' }}>
          Net cash (total): <strong style={{ color: totals.netCash >= 0 ? 'var(--accent2-900)' : '#b91c1c' }}>{totals.netCash >= 0 ? fmtUsd(totals.netCash) : `(${fmtUsd(Math.abs(totals.netCash))})`}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1rem', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.4rem 0.6rem', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }} />
                {cols.map(c => (
                  <th key={c.key} style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.label}</th>
                ))}
                <th style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent2-900)', whiteSpace: 'nowrap', background: 'rgba(23,169,123,0.06)' }}>Total</th>
                {prevTotals && (
                  <>
                    <th style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap', background: 'rgba(0,0,0,0.03)' }}>{prevLabel}</th>
                    <th style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Variance</th>
                    <th style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{'Δ'}%</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {renderRows(INCOME_ROWS)}
              {renderRows([{ kind: 'gap' }, ...CASHFLOW_ROWS])}
              {renderRows([{ kind: 'gap' }, ...payoutRows(hasShopifyPayouts)])}
              {renderRows([{ kind: 'gap' }, ...KPI_ROWS])}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Accrual (Income Statement) vs cash (Cash Flow): the gap is mostly credit sales ({fmtUsd(totals.creditSales)} total), which book revenue without new cash, and membership cash received ahead of earned revenue. COGS shown as billed; processor fees and payout lag not modelled. {view === 'mtd' ? `Variance and Δ% compare the MTD total against ${prevLabel}.` : ''} Actual cash received = money that landed at the bank (Stripe payouts are net of fees).
        </div>
      </div>
    </div>
  );
}
