'use client';

import { useCallback, useEffect, useState } from 'react';

// Review & approve duplicate-migration-credit reversals. Nothing is debited
// until rows are approved here AND the kill switch is armed; the worker then
// processes approved rows every 10 minutes.

interface WindowCredit {
  tx_id: string;
  occurred_at: string;
  amount_cents: number;
  remaining_cents: number | null;
  normal: boolean;
  duplicate: boolean;
}

interface ReviewRow {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  current_balance_cents: number;
  migration_credits: WindowCredit[];
  migration_credit_count: number;
  duplicate_cents: number;
  proposed_debit_cents: number;
  status: string;
  debit_reference: string | null;
  balance_after_cents: number | null;
  error: string | null;
  scanned_at: string | null;
}

interface ApiData {
  config: { reversal_enabled: boolean; scan_state: { cursor_customer_id?: string; done_at?: string } };
  counts: Record<string, number>;
  outstanding_duplicate_cents: number;
  outstanding_proposed_cents: number;
  rows: ReviewRow[];
}

const usd = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending_review: { bg: '#fdf2dc', fg: '#7a5200' },
  approved:       { bg: '#e8f0fe', fg: '#1a56db' },
  processing:     { bg: '#ede9fe', fg: '#5b21b6' },
  reversed:       { bg: '#dcfce7', fg: '#15803d' },
  no_duplicates:  { bg: 'var(--surface2)', fg: 'var(--muted)' },
  failed:         { bg: '#fee2e2', fg: '#991b1b' },
  skipped:        { bg: 'var(--surface2)', fg: 'var(--muted)' },
};

export default function CreditCorrectionClient() {
  const [data, setData] = useState<ApiData | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (status: string) => {
    const r = await fetch(`/api/admin/credit-correction?status=${status}`, { cache: 'no-store' });
    if (r.ok) setData(await r.json());
  }, []);

  useEffect(() => { load(statusFilter); }, [load, statusFilter]);
  useEffect(() => {
    const t = setInterval(() => load(statusFilter), 30_000);
    return () => clearInterval(t);
  }, [load, statusFilter]);

  const approveSelected = async () => {
    if (selected.size === 0 || !data) return;
    const rows = data.rows.filter(r => selected.has(r.customer_id));
    const total = rows.reduce((s, r) => s + r.proposed_debit_cents, 0);
    const typed = prompt(`Approve reversal of ${usd(total)} across ${rows.length} customer(s)?\n\nType REVERSE to confirm:`);
    if (typed !== 'REVERSE') return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/credit-correction/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: rows.map(x => x.customer_id), confirm: 'REVERSE' }),
      });
      const j = await r.json();
      setNotice(r.ok
        ? `${j.approved} row(s) approved — ${usd(j.total_cents)} queued. The worker reverses them once the kill switch is ARMED.`
        : `Error: ${j.error}`);
      setSelected(new Set());
      await load(statusFilter);
    } finally { setBusy(false); }
  };

  const toggleKillSwitch = async () => {
    if (!data) return;
    const enabling = !data.config.reversal_enabled;
    let confirm: string | undefined;
    if (enabling) {
      const typed = prompt('Arm the reversal worker? Approved rows will be DEBITED on the next 10-min tick.\n\nType ARM to confirm:');
      if (typed !== 'ARM') return;
      confirm = 'ARM';
    }
    setBusy(true);
    try {
      const r = await fetch('/api/admin/credit-correction/arm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: enabling, confirm }),
      });
      const j = await r.json();
      setNotice(r.ok ? `Reversal worker is now ${j.reversal_enabled ? 'ARMED' : 'OFF'}.` : `Error: ${j.error}`);
      await load(statusFilter);
    } finally { setBusy(false); }
  };

  if (!data) return <div style={{ padding: '3rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Loading…</div>;

  const scanDone = Boolean(data.config.scan_state?.done_at);
  const visible = data.rows;
  const allVisibleSelected = visible.length > 0 && visible.every(r => selected.has(r.customer_id));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            Store Credit <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Correction</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Duplicate migration credits · Mar–Apr 2026 · {scanDone ? 'scan complete' : 'scan in progress'}
          </div>
        </div>
        <button onClick={toggleKillSwitch} disabled={busy} style={{
          padding: '0.45rem 1rem', borderRadius: 8, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
          border: '1.5px solid', borderColor: data.config.reversal_enabled ? '#dc2626' : 'var(--border)',
          background: data.config.reversal_enabled ? '#fee2e2' : 'var(--surface)',
          color: data.config.reversal_enabled ? '#991b1b' : 'var(--text)',
        }}>
          {data.config.reversal_enabled ? '⛔ Worker ARMED — click to stop' : 'Worker OFF — click to arm'}
        </button>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {notice && (
          <div style={{ background: '#eef6f0', border: '1px solid #bcd9c5', color: '#1d5a33', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            {notice}
          </div>
        )}

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
          {[
            { label: 'Flagged for review', value: num(data.counts.pending_review ?? 0) },
            { label: 'Duplicate credit found', value: usd(data.outstanding_duplicate_cents) },
            { label: 'Reversible now', value: usd(data.outstanding_proposed_cents) },
            { label: 'Reversed', value: num(data.counts.reversed ?? 0) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {['pending_review', 'approved', 'reversed', 'failed', 'skipped', 'no_duplicates', 'all'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setSelected(new Set()); }} style={{
              padding: '0.3rem 0.7rem', borderRadius: 7, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              border: '1px solid var(--border)',
              background: statusFilter === s ? 'var(--accent-100)' : 'var(--surface)',
              color: statusFilter === s ? '#fff' : 'var(--neutral-600)',
            }}>
              {s.replace('_', ' ')}{data.counts[s] != null ? ` (${num(data.counts[s])})` : ''}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {statusFilter === 'pending_review' && (
            <button onClick={approveSelected} disabled={busy || selected.size === 0} style={{
              padding: '0.45rem 1rem', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: selected.size ? 'pointer' : 'default',
              border: 'none', background: selected.size ? 'var(--accent)' : 'var(--neutral-100)', color: selected.size ? '#fff' : 'var(--muted)',
            }}>
              Approve reversal of {num(selected.size)} selected
            </button>
          )}
        </div>

        {/* Table */}
        <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {statusFilter === 'pending_review' && (
                  <th style={{ padding: '0.5rem 0.6rem' }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={() => {
                      setSelected(allVisibleSelected ? new Set() : new Set(visible.map(r => r.customer_id)));
                    }} />
                  </th>
                )}
                {['Customer', 'Balance', 'Migration credits', 'Duplicate', 'To reverse', 'Status', 'Detail'].map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                  {scanDone ? 'No rows in this status.' : 'Scan in progress — rows appear as customers are checked (every 10 min).'}
                </td></tr>
              )}
              {visible.map((r, i) => {
                const sc = STATUS_COLORS[r.status] ?? STATUS_COLORS.skipped;
                return (
                  <tr key={r.customer_id} style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none', background: selected.has(r.customer_id) ? 'rgba(244,105,74,0.06)' : i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                    {statusFilter === 'pending_review' && (
                      <td style={{ padding: '0.5rem 0.6rem' }}>
                        <input type="checkbox" checked={selected.has(r.customer_id)} onChange={() => {
                          const next = new Set(selected);
                          if (next.has(r.customer_id)) next.delete(r.customer_id); else next.add(r.customer_id);
                          setSelected(next);
                        }} />
                      </td>
                    )}
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <div style={{ fontWeight: 500 }}>{r.display_name || r.email || r.customer_id.split('/').pop()}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{r.email}</div>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)' }}>{usd(r.current_balance_cents)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)' }}>{r.migration_credit_count}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', color: r.duplicate_cents > 0 ? '#b91c1c' : 'var(--muted)', fontWeight: 600 }}>{usd(r.duplicate_cents)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{usd(r.proposed_debit_cents)}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span style={{ background: sc.bg, color: sc.fg, padding: '0.15rem 0.5rem', borderRadius: 5, fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.status.replace('_', ' ')}</span>
                      {r.error && <div style={{ fontSize: '0.68rem', color: '#b91c1c', marginTop: 3 }}>{r.error}</div>}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          {(r.migration_credits ?? []).length} window credit(s)
                        </summary>
                        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {(r.migration_credits ?? []).map(c => (
                            <div key={c.tx_id} style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: c.duplicate ? '#b91c1c' : c.normal ? 'var(--muted)' : 'var(--text)' }}>
                              {c.occurred_at.slice(0, 10)} · {usd(c.amount_cents)}
                              {c.remaining_cents != null ? ` (${usd(c.remaining_cents)} left)` : ''}
                              {c.normal ? ' · monthly' : c.duplicate ? ' · DUPLICATE' : ' · migration'}
                            </div>
                          ))}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Flow: scan flags duplicates → you approve rows (REVERSE) → arm the worker (ARM) → debits post with a correction note on each customer. Showing up to 2,000 rows, biggest duplicates first.
        </div>
      </div>
    </div>
  );
}
