import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import {
  buildManAccounts, parseView, cell, varianceCell, pctChangeCell,
  INCOME_ROWS, CASHFLOW_ROWS, payoutRows, KPI_ROWS, type RowDef,
} from '@/lib/man-accounts';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// CSV of the full Man Accounts table — opens in Excel, imports into Google
// Sheets. Same data assembly as the page (lib/man-accounts.ts).

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export async function GET(req: NextRequest) {
  const view = parseView(req.nextUrl.searchParams.get('view'));
  const includeToday = req.nextUrl.searchParams.get('today') === '1';
  const { asOf, cols, totals, prevTotals, prevLabel, hasShopifyPayouts } =
    await buildManAccounts(view, includeToday);

  const lines: string[] = [];
  const header = ['', ...cols.map(c => c.label), 'Total'];
  if (prevTotals) header.push(prevLabel, 'Variance', 'Change %');
  lines.push(header.map(esc).join(','));

  const allRows: RowDef[] = [
    ...INCOME_ROWS, { kind: 'gap' },
    ...CASHFLOW_ROWS, { kind: 'gap' },
    ...payoutRows(hasShopifyPayouts), { kind: 'gap' },
    ...KPI_ROWS,
  ];
  for (const r of allRows) {
    if (r.kind === 'gap') { lines.push(''); continue; }
    if (r.kind === 'head') { lines.push(esc(r.label.toUpperCase())); continue; }
    const v = r.get(totals);
    const row = [r.label, ...cols.map(c => cell(r.get(c.m), r.neg, r.fmt)), cell(v, r.neg, r.fmt)];
    if (prevTotals) {
      const p = r.get(prevTotals);
      row.push(cell(p, r.neg, r.fmt), varianceCell(v, p, r.fmt), pctChangeCell(v, p));
    }
    lines.push(row.map(esc).join(','));
  }

  const filename = `man-accounts-${view}-${format(asOf, 'yyyy-MM-dd')}.csv`;
  // BOM so Excel detects UTF-8 (em dashes, Δ, −).
  return new NextResponse(`﻿${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
