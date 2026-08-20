'use client';

import { useCallback, useEffect, useState } from 'react';

// ── Admin: Magic Portraits product cleanup ────────────────────────────────────
// Monitors the sync (candidates + sold ledger + batches) and controls the
// deletion worker. Nothing deletes without: kill switch ON + a batch
// explicitly approved with a typed confirmation.

interface Config {
  deletion_enabled: boolean;
  window_start: string;
  window_end: string;
  title_pattern: string;
  protected_product_ids: string[];
  batch_size: number;
  sync_state: { phase?: string; last_error?: string; last_completed_at?: string; counts?: Record<string, number> };
  updated_by: string | null;
}
interface Stats { total: number; portraits: number; sold: number; eligible: number; queued: number; deleted: number; errors: number; protected: number }
interface Batch {
  id: string; batch_number: number; month_label: string | null; size: number;
  status: string; approved_by: string | null; approved_at: string | null;
  deleted_count: number; error_count: number; completed_at: string | null;
}
interface LogRow {
  id: string; product_id: string; title: string | null; batch_number: number | null;
  result: string; error: string | null; created_at: string;
}
interface SearchRow {
  product_id: string; title: string | null; handle: string | null;
  shopify_created_at: string | null; status: string; sold: boolean; error: string | null;
}

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const num = (n: number) => n.toLocaleString('en-US');

const card: React.CSSProperties = { background: 'var(--surface)', borderRadius: 24, padding: '22px 26px', marginBottom: 16 };
const label: React.CSSProperties = { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--neutral-600)' };
const th: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: 11, fontWeight: 600, color: 'var(--neutral-600)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '0.55rem 0.8rem', fontSize: 12.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', verticalAlign: 'top' };

function Badge({ s }: { s: string }) {
  const tone =
    s === 'done' || s === 'deleted' ? { bg: 'var(--accent2-200)', fg: 'var(--accent2-900)' }
    : s === 'error' || s === 'deleting' ? { bg: 'var(--accent-200)', fg: 'var(--accent-900)' }
    : s === 'approved' ? { bg: '#fdf2dc', fg: '#7a5200' }
    : s === 'protected' ? { bg: 'var(--chart-blue)', fg: '#fff' }
    : { bg: 'var(--neutral-200)', fg: 'var(--neutral-800)' };
  return <span style={{ background: tone.bg, color: tone.fg, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>{s}</span>;
}

export default function ProductCleanupClient() {
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [search, setSearch] = useState<SearchRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/product-cleanup${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setConfig(j.config); setStats(j.stats); setBatches(j.batches); setLog(j.log); setSearch(j.search ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleKillSwitch = async () => {
    if (!config) return;
    if (!config.deletion_enabled) {
      const t = window.prompt('Arming the deletion worker. Approved batches WILL start deleting.\nType ARM to confirm:');
      if (t !== 'ARM') return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/admin/product-cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_enabled: !config.deletion_enabled }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setConfig(j.config);
      setNotice(j.config.deletion_enabled ? 'Deletion worker ARMED.' : 'Deletion worker disarmed.');
    } catch (e) { setNotice(`Failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const approveBatch = async (b: Batch) => {
    const t = window.prompt(`Approve batch #${b.batch_number} (${num(b.size)} products, ${b.month_label ?? ''}) for PERMANENT deletion?\nType DELETE to confirm:`);
    if (t !== 'DELETE') return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/product-cleanup/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: b.id, confirm: 'DELETE' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setNotice(`Batch #${j.batch_number} approved (${num(j.size)} products). The worker starts on its next 5-min tick${config?.deletion_enabled ? '' : ' — once the kill switch is armed'}.`);
      await load();
    } catch (e) { setNotice(`Approve failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  if (loading && !config) return <div style={{ padding: 40, color: 'var(--neutral-600)', fontSize: 14 }}>Loading product cleanup…</div>;
  if (error && !config) return <div style={{ padding: 40, color: 'var(--accent-700)', fontSize: 14 }}>Failed to load: {error}</div>;
  if (!config || !stats) return null;

  const phase = config.sync_state?.phase ?? 'idle';
  const numericId = (gid: string) => gid.split('/').pop();

  return (
    <div style={{ maxWidth: 1520, margin: '0 auto', padding: '24px 32px 72px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 28, fontWeight: 400, margin: 0 }}>
          Product <span style={{ color: 'var(--accent)' }}>Cleanup</span>
        </h1>
        <button className="pill" onClick={() => load(q)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        {notice && <span style={{ fontSize: 13, color: 'var(--neutral-700)' }}>{notice}</span>}
      </div>

      {/* ── Kill switch + sync status ─────────────────────────────────────── */}
      <div style={{ ...card, border: config.deletion_enabled ? '2px solid var(--accent-500)' : '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={label}>Deletion worker</span>
          <button
            onClick={toggleKillSwitch}
            disabled={busy}
            style={{
              borderRadius: 999, padding: '8px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: 'none', color: '#fff',
              background: config.deletion_enabled ? 'var(--accent-600)' : 'var(--neutral-500)',
            }}
          >
            {config.deletion_enabled ? '⚠ ARMED — click to disarm' : '○ DISARMED — click to arm'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--neutral-600)' }}>
            Window {config.window_start} → {config.window_end} · pattern “{config.title_pattern}” · batches of {num(config.batch_size)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--neutral-600)' }}>
            Sync: <strong>{phase}</strong>{config.sync_state?.last_completed_at ? ` · last complete ${dt(config.sync_state.last_completed_at)}` : ''}
            {config.sync_state?.last_error ? ` · last error: ${config.sync_state.last_error}` : ''}
          </span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent2-800)', background: 'var(--accent2-100)', borderRadius: 10, padding: '8px 12px', display: 'inline-block' }}>
          🔒 Master product <strong>{numericId('gid://shopify/Product/8471707222212')}</strong> is permanently protected — hard-coded in the worker, listed in config, re-checked at delete time.
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['Scanned', stats.total], ['Magic Portraits', stats.portraits], ['Sold (protected)', stats.sold],
          ['Eligible (unbatched)', stats.eligible], ['Queued in batches', stats.queued],
          ['Deleted', stats.deleted], ['Errors', stats.errors],
        ].map(([l, v]) => (
          <div key={String(l)} style={{ background: 'var(--surface)', borderRadius: 18, padding: '16px 18px' }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{num(Number(v))}</div>
            <div style={{ fontSize: 11, color: 'var(--neutral-600)' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── Batches ───────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 14 }}>Batches</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th style={th}>#</th><th style={th}>Window</th><th style={th}>Size</th><th style={th}>Status</th>
              <th style={th}>Progress</th><th style={th}>Errors</th><th style={th}>Approved</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {batches.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--neutral-500)' }} colSpan={8}>
                  No batches yet — they appear once the sync finishes scanning products and the sold ledger.
                </td></tr>
              )}
              {batches.map(b => (
                <tr key={b.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{b.batch_number}</td>
                  <td style={td}>{b.month_label ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{num(b.size)}</td>
                  <td style={td}><Badge s={b.status} /></td>
                  <td style={{ ...td, minWidth: 160 }}>
                    <div style={{ height: 10, borderRadius: 999, background: 'var(--neutral-200)' }}>
                      <div style={{ width: `${b.size > 0 ? Math.min(100, (b.deleted_count / b.size) * 100) : 0}%`, height: '100%', borderRadius: 999, background: 'var(--accent2-500)' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--neutral-600)' }}>{num(b.deleted_count)} / {num(b.size)}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: b.error_count > 0 ? 'var(--accent-700)' : undefined }}>{num(b.error_count)}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>{b.approved_by ? `${b.approved_by} · ${dt(b.approved_at)}` : '—'}</td>
                  <td style={td}>
                    {b.status === 'ready' && (
                      <button className="pill pill--sm" style={{ borderColor: 'var(--accent-400)', color: 'var(--accent-700)' }}
                        onClick={() => approveBatch(b)} disabled={busy}>
                        Approve & delete…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Candidate search ──────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={label}>Candidate lookup</span>
          <form onSubmit={e => { e.preventDefault(); load(q); }} style={{ display: 'flex', gap: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="title, handle or product id…"
              style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, width: 280 }} />
            <button type="submit" className="pill pill--sm">Search</button>
          </form>
        </div>
        {search.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Product</th><th style={th}>Created</th><th style={th}>Status</th><th style={th}>Sold</th><th style={th}>Note</th></tr></thead>
              <tbody>
                {search.map(r => (
                  <tr key={r.product_id}>
                    <td style={td}>
                      <a href={`https://admin.shopify.com/store/storyboards/products/${numericId(r.product_id)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-700)' }}>
                        {r.title ?? r.product_id}
                      </a>
                    </td>
                    <td style={td}>{r.shopify_created_at?.slice(0, 10) ?? '—'}</td>
                    <td style={td}><Badge s={r.status} /></td>
                    <td style={td}>{r.sold ? 'yes' : 'no'}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 280, fontSize: 11.5 }}>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Deletion log ──────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 14 }}>Deletion log (latest 60)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>When</th><th style={th}>Product</th><th style={th}>Batch</th><th style={th}>Result</th><th style={th}>Detail</th></tr></thead>
            <tbody>
              {log.length === 0 && (
                <tr><td style={{ ...td, color: 'var(--neutral-500)' }} colSpan={5}>Nothing deleted yet.</td></tr>
              )}
              {log.map(l => (
                <tr key={l.id}>
                  <td style={td}>{dt(l.created_at)}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 340 }}>{l.title ?? l.product_id}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.batch_number ?? '—'}</td>
                  <td style={td}><Badge s={l.result} /></td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 300, fontSize: 11.5, color: 'var(--accent-800)' }}>{l.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--neutral-600)', margin: '4px 4px 0' }}>
        Sync cron every 10 min (Shopify bulk exports, read-only) · delete worker every 5 min, approved batches only,
        ~150 products/run (a 5,000 batch ≈ 3 h) · every deletion is snapshotted to the log before removal ·
        sold products and the master product are excluded and re-checked at delete time.
      </p>
    </div>
  );
}
