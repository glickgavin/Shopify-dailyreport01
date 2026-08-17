'use client';

import { useCallback, useEffect, useState } from 'react';

// ── Admin: Stripe invoices → Shopify store credit ─────────────────────────────
// Config card (the kill switch + allocation rules), invoices / refunds tables,
// audit log, and a Retry-failed button. Read-only except the config card.

interface Config {
  allocation_enabled: boolean;
  allocation_percentage: number;
  min_amount_cents: number;
  max_amount_cents: number | null;
  eligible_currencies: string[];
  updated_at: string;
  updated_by: string | null;
}
interface InvoiceRow {
  id: string; stripe_invoice_id: string; customer_email: string | null;
  amount_paid: number; currency: string; billing_reason: string | null;
  allocation_status: string; allocation_error: string | null;
  credit_amount_cents: number | null; retry_count: number; created_at: string;
}
interface RefundRow {
  id: string; stripe_refund_id: string; customer_email: string | null;
  amount_refunded: number; currency: string; debit_status: string;
  debit_error: string | null; debit_amount_cents: number | null; created_at: string;
}
interface LogRow {
  id: string; transaction_type: string; customer_email: string | null;
  amount_cents: number; currency: string; success: boolean;
  error_message: string | null; shopify_response: unknown; created_at: string;
}

const usd = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
const dt = (iso: string) => new Date(iso).toLocaleString();

const card: React.CSSProperties = { background: 'var(--surface)', borderRadius: 24, padding: '22px 26px', marginBottom: 16 };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--neutral-600)' };
const inputStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface)', fontSize: 13, width: 110, fontVariantNumeric: 'tabular-nums',
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'success' ? { bg: 'var(--accent2-200)', fg: 'var(--accent2-900)' }
    : status === 'failed' ? { bg: 'var(--accent-200)', fg: 'var(--accent-900)' }
    : status === 'skipped' ? { bg: 'var(--neutral-200)', fg: 'var(--neutral-800)' }
    : { bg: '#fdf2dc', fg: '#7a5200' }; // pending / processing
  return (
    <span style={{ background: tone.bg, color: tone.fg, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  );
}

const th: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: 11, fontWeight: 600, color: 'var(--neutral-600)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '0.55rem 0.8rem', fontSize: 12.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', verticalAlign: 'top' };

export default function StripeCreditsClient() {
  const [config, setConfig] = useState<Config | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [openLog, setOpenLog] = useState<string | null>(null);

  // Config form state (strings so partial input doesn't fight the user)
  const [pct, setPct] = useState('100');
  const [minUsd, setMinUsd] = useState('0');
  const [maxUsd, setMaxUsd] = useState('');
  const [currencies, setCurrencies] = useState('USD');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/stripe-credits', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setConfig(j.config);
      setInvoices(j.invoices);
      setRefunds(j.refunds);
      setLogs(j.logs);
      if (j.config) {
        setPct(String(j.config.allocation_percentage));
        setMinUsd((j.config.min_amount_cents / 100).toFixed(2));
        setMaxUsd(j.config.max_amount_cents != null ? (j.config.max_amount_cents / 100).toFixed(2) : '');
        setCurrencies((j.config.eligible_currencies ?? []).join(', '));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async (overrides: Record<string, unknown> = {}) => {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      const body = {
        allocation_percentage: Math.round(Number(pct)),
        min_amount_cents: Math.round(Number(minUsd) * 100),
        max_amount_cents: maxUsd.trim() === '' ? null : Math.round(Number(maxUsd) * 100),
        eligible_currencies: currencies.split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
        ...overrides,
      };
      const r = await fetch('/api/admin/stripe-credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setConfig(j.config);
      setNotice('Config saved.');
    } catch (e) {
      setNotice(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const retryFailed = async () => {
    setRetrying(true);
    setNotice(null);
    try {
      const r = await fetch('/api/admin/stripe-credits/retry', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setNotice(`Retry: ${j.retried} retried · ${j.succeeded} succeeded · ${j.failed} failed · ${j.skipped} skipped`);
      await load();
    } catch (e) {
      setNotice(`Retry failed: ${(e as Error).message}`);
    } finally {
      setRetrying(false);
    }
  };

  const shownInvoices = invoices.filter(i =>
    (statusFilter === 'all' || i.allocation_status === statusFilter) &&
    (emailSearch.trim() === '' || (i.customer_email ?? '').includes(emailSearch.trim().toLowerCase())),
  );

  if (loading && !config) {
    return <div style={{ padding: 40, color: 'var(--neutral-600)', fontSize: 14 }}>Loading Stripe credit system…</div>;
  }
  if (error && !config) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: 'var(--accent-700)', fontSize: 14 }}>Failed to load: {error}</p>
        <button className="pill" onClick={load} style={{ marginTop: 12 }}>Retry</button>
      </div>
    );
  }
  if (!config) return null;

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '24px 32px 72px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 28, fontWeight: 400, margin: 0 }}>
          Stripe <span style={{ color: 'var(--accent)' }}>Store Credits</span>
        </h1>
        <button className="pill" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <button className="pill" onClick={retryFailed} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry failed allocations'}
        </button>
        {notice && <span style={{ fontSize: 13, color: 'var(--neutral-700)' }}>{notice}</span>}
      </div>

      {/* ── Config / kill switch ─────────────────────────────────────────── */}
      <div style={{ ...card, border: config.allocation_enabled ? '1px solid var(--accent2-400)' : '1px solid var(--accent-400)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <span style={label}>Allocation</span>
          <button
            onClick={() => saveConfig({ allocation_enabled: !config.allocation_enabled })}
            disabled={saving}
            style={{
              borderRadius: 999, padding: '8px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: 'none', color: '#fff',
              background: config.allocation_enabled ? 'var(--accent2-600)' : 'var(--accent-600)',
            }}
          >
            {config.allocation_enabled ? '● LIVE — click to disable' : '○ DISABLED — click to enable'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--neutral-600)' }}>
            Kill switch: while disabled, incoming invoices are recorded as skipped and the retry job no-ops.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Percentage</div>
            <input value={pct} onChange={e => setPct(e.target.value)} inputMode="numeric" style={inputStyle} />
          </div>
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Min (USD)</div>
            <input value={minUsd} onChange={e => setMinUsd(e.target.value)} inputMode="decimal" style={inputStyle} />
          </div>
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Max cap (USD, blank = none)</div>
            <input value={maxUsd} onChange={e => setMaxUsd(e.target.value)} inputMode="decimal" style={inputStyle} placeholder="none" />
          </div>
          <div>
            <div style={{ ...label, marginBottom: 6 }}>Currencies (comma-sep)</div>
            <input value={currencies} onChange={e => setCurrencies(e.target.value)} style={{ ...inputStyle, width: 160 }} />
          </div>
          <button className="pill" onClick={() => saveConfig()} disabled={saving}>{saving ? 'Saving…' : 'Save config'}</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--neutral-500)' }}>
          Last updated {dt(config.updated_at)}{config.updated_by ? ` by ${config.updated_by}` : ''}
        </div>
      </div>

      {/* ── Invoices ─────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={label}>Invoices ({shownInvoices.length})</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ ...inputStyle, width: 130, padding: '6px 10px' }}>
            {['all', 'pending', 'processing', 'success', 'failed', 'skipped'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={emailSearch} onChange={e => setEmailSearch(e.target.value)} placeholder="search email…"
            style={{ ...inputStyle, width: 200 }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Email</th><th style={th}>Paid</th><th style={th}>Credit</th>
              <th style={th}>Cur</th><th style={th}>Status</th><th style={th}>Reason</th><th style={th}>Retries</th><th style={th}>Error</th>
            </tr></thead>
            <tbody>
              {shownInvoices.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--neutral-500)' }} colSpan={9}>No invoices yet — rows appear as Stripe delivers invoice.paid webhooks.</td></tr>
              )}
              {shownInvoices.map(i => (
                <tr key={i.id}>
                  <td style={td}>{dt(i.created_at)}</td>
                  <td style={td}>{i.customer_email ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{usd(i.amount_paid)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{usd(i.credit_amount_cents)}</td>
                  <td style={td}>{i.currency}</td>
                  <td style={td}><StatusBadge status={i.allocation_status} /></td>
                  <td style={td}>{i.billing_reason ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{i.retry_count}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 260, color: 'var(--accent-800)', fontSize: 11.5 }}>{i.allocation_error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Refunds ──────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 14 }}>Refunds ({refunds.length})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Email</th><th style={th}>Refunded</th><th style={th}>Debited</th>
              <th style={th}>Status</th><th style={th}>Error</th>
            </tr></thead>
            <tbody>
              {refunds.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--neutral-500)' }} colSpan={6}>No refunds processed yet.</td></tr>
              )}
              {refunds.map(r => (
                <tr key={r.id}>
                  <td style={td}>{dt(r.created_at)}</td>
                  <td style={td}>{r.customer_email ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{usd(r.amount_refunded)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{usd(r.debit_amount_cents)}</td>
                  <td style={td}><StatusBadge status={r.debit_status} /></td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 300, color: 'var(--accent-800)', fontSize: 11.5 }}>{r.debit_error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Audit log ────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 14 }}>Audit log ({logs.length})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Type</th><th style={th}>Email</th><th style={th}>Amount</th>
              <th style={th}>Result</th><th style={th}>Detail</th>
            </tr></thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--neutral-500)' }} colSpan={6}>No allocation attempts logged yet.</td></tr>
              )}
              {logs.map(l => (
                <tr key={l.id} onClick={() => setOpenLog(openLog === l.id ? null : l.id)} style={{ cursor: 'pointer' }}>
                  <td style={td}>{dt(l.created_at)}</td>
                  <td style={td}>
                    <span className={l.transaction_type === 'credit' ? 'tag tag-accent-2' : 'tag tag-accent'}>{l.transaction_type}</span>
                  </td>
                  <td style={td}>{l.customer_email ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{usd(l.amount_cents)}</td>
                  <td style={td}><StatusBadge status={l.success ? 'success' : 'failed'} /></td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 380, fontSize: 11.5 }}>
                    {l.error_message ?? (openLog === l.id
                      ? <pre style={{ margin: 0, fontSize: 10.5, whiteSpace: 'pre-wrap' }}>{JSON.stringify(l.shopify_response, null, 1)}</pre>
                      : 'click to expand response')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--neutral-600)', margin: '4px 4px 0' }}>
        Webhook endpoint: <code>/api/webhooks/stripe-credit</code> (invoice.paid, charge.refunded) ·
        retry cron hourly at :25, max 10 rows × 5 attempts · credits use the same Shopify flow as PayPal
        (customer lookup by email → store-credit account → credit + member-active tag).
      </p>
    </div>
  );
}
