'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type CreditStatus = 'pending' | 'processing' | 'allocated' | 'skipped' | 'refunded' | 'failed' | 'all';

interface LedgerRow {
  id: string;
  paypal_transaction_id: string;
  initiated_at: string;
  pt_date: string;
  gross_cents: number;
  fee_cents: number;
  currency: string;
  transaction_event_code: string;
  subject: string | null;
  payer_email: string | null;
  payer_name: string | null;
  custom_field_email: string | null;
  custom_field_raw: string | null;
  credit_status: CreditStatus;
  credit_amount_cents: number | null;
  credit_email: string | null;
  credit_shopify_customer_id: string | null;
  credit_reference: string | null;
  credit_allocated_at: string | null;
  credit_allocated_by: string | null;
  credit_error: string | null;
  credit_notes: string | null;
}

interface SummaryBucket { count: number; total_cents: number; }
type Summary = Record<Exclude<CreditStatus, 'all' | 'processing'>, SummaryBucket>;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const shortId = (gid: string | null) => gid?.split('/').pop() ?? '—';

function statusColor(s: CreditStatus): string {
  switch (s) {
    case 'pending':    return '#f59e0b';
    case 'processing': return '#0ea5e9';
    case 'allocated':  return '#16a34a';
    case 'skipped':    return '#6b7280';
    case 'refunded':   return '#7c3aed';
    case 'failed':     return '#dc2626';
    default:           return '#6b7280';
  }
}

function todayPT(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 7);
  return d.toISOString().slice(0, 10);
}

export default function PaypalSubscriptionsClient() {
  const [status,   setStatus]   = useState<CreditStatus>('pending');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate,   setToDate]   = useState<string>(todayPT());
  const [emailQ,   setEmailQ]   = useState<string>('');
  const [rows,     setRows]     = useState<LedgerRow[]>([]);
  const [total,    setTotal]    = useState<number>(0);
  const [summary,  setSummary]  = useState<Summary | null>(null);
  const [loading,  setLoading]  = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy,     setBusy]     = useState<boolean>(false);
  const [flash,    setFlash]    = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (status)   p.set('status', status);
    if (fromDate) p.set('from', fromDate);
    if (toDate)   p.set('to', toDate);
    if (emailQ)   p.set('email', emailQ);
    return p.toString();
  }, [status, fromDate, toDate, emailQ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = buildQuery();
      const [rowsRes, sumRes] = await Promise.all([
        fetch(`/api/admin/paypal-subscriptions?${q}`).then(r => r.json()),
        fetch(`/api/admin/paypal-subscriptions?${q}&summary=true`).then(r => r.json()),
      ]);
      setRows(rowsRes.rows ?? []);
      setTotal(rowsRes.total ?? 0);
      setSummary(sumRes.summary ?? null);
      setSelected(new Set());
    } catch (err) {
      setFlash({ kind: 'err', text: `load failed: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const toggleOne = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected(s => {
    if (s.size === rows.length) return new Set();
    return new Set(rows.map(r => r.id));
  });

  const selectedCount = selected.size;
  const selectedTotalCents = useMemo(
    () => rows.filter(r => selected.has(r.id)).reduce((a, r) => a + r.gross_cents, 0),
    [rows, selected],
  );

  const allocate = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!confirm(`Allocate store credit for ${ids.length} row(s) totaling ${money(rows.filter(r => ids.includes(r.id)).reduce((a, r) => a + r.gross_cents, 0))}?`)) return;
    setBusy(true); setFlash(null);
    try {
      const r = await fetch('/api/admin/paypal-subscriptions/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'allocation failed');
      const ok = j.results.filter((x: { ok: boolean }) => x.ok).length;
      const bad = j.results.length - ok;
      setFlash({
        kind: bad === 0 ? 'ok' : 'err',
        text: `Allocated ${ok} · Failed ${bad}${bad ? ` (see error column)` : ''}`,
      });
      await load();
    } catch (err) {
      setFlash({ kind: 'err', text: `allocate failed: ${(err as Error).message}` });
    } finally { setBusy(false); }
  };

  const skip = async (ids: string[]) => {
    if (ids.length === 0) return;
    const reason = prompt('Skip reason (optional):') ?? '';
    if (reason === null) return;
    setBusy(true); setFlash(null);
    try {
      const r = await fetch('/api/admin/paypal-subscriptions/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, reason }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'skip failed');
      setFlash({ kind: 'ok', text: `Skipped ${j.updated}` });
      await load();
    } catch (err) {
      setFlash({ kind: 'err', text: `skip failed: ${(err as Error).message}` });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{
        background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            PayPal <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Subscriptions</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Log of T0002 subscription payments · allocate store credit via r_order
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {summary && <SummaryBar summary={summary} />}

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '0.85rem 1rem',
          display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as CreditStatus)} style={inputStyle}>
            <option value="pending">Pending</option>
            <option value="allocated">Allocated</option>
            <option value="skipped">Skipped</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
            <option value="all">All</option>
          </select>
          <label style={labelStyle}>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} />
          <label style={labelStyle}>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} />
          <label style={labelStyle}>Email</label>
          <input type="text" value={emailQ} onChange={e => setEmailQ(e.target.value)} placeholder="substring" style={{ ...inputStyle, minWidth: 180 }} />
          <button onClick={load} disabled={loading} style={btnPrimary}>Refresh</button>
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {total.toLocaleString()} rows
          </span>
        </div>

        {selectedCount > 0 && (
          <div style={{
            background: '#fef3c7', border: '1px solid #f59e0b',
            borderRadius: 10, padding: '0.7rem 1rem',
            display: 'flex', gap: '0.75rem', alignItems: 'center',
            fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
          }}>
            <strong>{selectedCount} selected</strong>
            <span style={{ color: '#78350f' }}>· total {money(selectedTotalCents)}</span>
            <button onClick={() => allocate(Array.from(selected))} disabled={busy} style={{ ...btnPrimary, marginLeft: 'auto' }}>
              Allocate credit ({selectedCount})
            </button>
            <button onClick={() => skip(Array.from(selected))} disabled={busy} style={btnSecondary}>
              Skip ({selectedCount})
            </button>
            <button onClick={() => setSelected(new Set())} style={btnGhost}>Clear</button>
          </div>
        )}

        {flash && (
          <div style={{
            padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
            background: flash.kind === 'ok' ? '#dcfce7' : '#fee2e2',
            color:      flash.kind === 'ok' ? '#166534' : '#991b1b',
            border:     `1px solid ${flash.kind === 'ok' ? '#86efac' : '#fecaca'}`,
          }}>
            {flash.text}
          </div>
        )}

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>No rows match these filters</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', textAlign: 'left' }}>
                  <th style={thStyle}><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Subject</th>
                  <th style={thStyle}>Customer email (custom_field)</th>
                  <th style={thStyle}>Payer email</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <RowLine
                    key={r.id}
                    row={r}
                    selected={selected.has(r.id)}
                    onToggle={() => toggleOne(r.id)}
                    onAllocate={() => allocate([r.id])}
                    onSkip={() => skip([r.id])}
                    busy={busy}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBar({ summary }: { summary: Summary }) {
  const buckets: Array<{ k: keyof Summary; label: string }> = [
    { k: 'pending',   label: 'Pending' },
    { k: 'allocated', label: 'Allocated' },
    { k: 'failed',    label: 'Failed' },
    { k: 'skipped',   label: 'Skipped' },
    { k: 'refunded',  label: 'Refunded' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
      {buckets.map(b => {
        const s = summary[b.k];
        const color = statusColor(b.k);
        return (
          <div key={b.k} style={{
            background: 'var(--surface)', border: `1px solid var(--border)`,
            borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '0.85rem 1rem',
          }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              {b.label}
            </div>
            <div style={{ fontSize: '1.4rem', fontFamily: 'var(--font-serif)', color, marginTop: 4 }}>
              {s.count.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginTop: 2 }}>
              {money(s.total_cents)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowLine({
  row, selected, onToggle, onAllocate, onSkip, busy,
}: {
  row: LedgerRow; selected: boolean;
  onToggle: () => void; onAllocate: () => void; onSkip: () => void;
  busy: boolean;
}) {
  const color = statusColor(row.credit_status);
  const emails = new Set([row.custom_field_email, row.payer_email].filter(Boolean));
  const emailsDiffer = emails.size > 1;
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={tdStyle}><input type="checkbox" checked={selected} onChange={onToggle} disabled={row.credit_status !== 'pending'} /></td>
      <td style={tdStyle}>
        <div>{row.pt_date}</div>
        <div style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>{new Date(row.initiated_at).toISOString().slice(11, 16)}Z</div>
      </td>
      <td style={{ ...tdStyle, fontWeight: 600 }}>{money(row.gross_cents)}</td>
      <td style={tdStyle}>{row.subject ?? '—'}</td>
      <td style={tdStyle}>
        {row.custom_field_email ?? <span style={{ color: 'var(--muted)' }}>—</span>}
        {emailsDiffer && <div style={{ fontSize: '0.6rem', color: '#f59e0b' }}>⚠ differs from payer</div>}
      </td>
      <td style={tdStyle}>{row.payer_email ?? '—'}</td>
      <td style={tdStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '0.15rem 0.5rem',
          background: color + '18', border: `1px solid ${color}44`, color,
          borderRadius: 4, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
          {row.credit_status}
        </span>
        {row.credit_status === 'allocated' && row.credit_reference && (
          <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: 3 }}>
            → {row.credit_email}<br />
            <span title={row.credit_reference}>ref {shortId(row.credit_reference)}</span>
          </div>
        )}
        {row.credit_status === 'failed' && row.credit_error && (
          <div style={{ fontSize: '0.6rem', color: '#dc2626', marginTop: 3 }}>{row.credit_error}</div>
        )}
        {row.credit_status === 'skipped' && row.credit_notes && (
          <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: 3 }}>{row.credit_notes}</div>
        )}
      </td>
      <td style={tdStyle}>
        {row.credit_status === 'pending' && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={onAllocate} disabled={busy} style={btnSmallPrimary}>Allocate</button>
            <button onClick={onSkip}     disabled={busy} style={btnSmallGhost}>Skip</button>
          </div>
        )}
        {row.credit_status === 'failed' && (
          <button onClick={onAllocate} disabled={busy} style={btnSmallPrimary}>Retry</button>
        )}
      </td>
    </tr>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.55rem', fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
};
const btnPrimary: React.CSSProperties = {
  padding: '0.4rem 0.9rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
  background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)', border: 'none', borderRadius: 6, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '0.4rem 0.9rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
  background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '0.4rem 0.7rem', fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
  background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
};
const btnSmallPrimary: React.CSSProperties = {
  padding: '0.25rem 0.55rem', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const btnSmallGhost: React.CSSProperties = {
  padding: '0.25rem 0.55rem', fontSize: '0.68rem', fontFamily: 'var(--font-mono)',
  background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
};
const thStyle: React.CSSProperties = {
  padding: '0.55rem 0.7rem', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
  color: 'var(--muted)', borderBottom: '1px solid var(--border)',
};
const tdStyle: React.CSSProperties = {
  padding: '0.55rem 0.7rem', verticalAlign: 'top',
};
