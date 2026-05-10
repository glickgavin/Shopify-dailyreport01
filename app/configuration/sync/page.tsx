export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase';
import SyncNowButton from './SyncNowButton';

interface SyncState {
  id: number;
  last_synced_created_at: string | null;
  backfill_complete: boolean;
  backfill_oldest_synced_at: string | null;
  backfill_target_at: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_rows: number | null;
  last_run_error: string | null;
  updated_at: string;
}

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  kind: string;
  rows_fetched: number;
  rows_inserted: number;
  pages_fetched: number;
  http_status: number | null;
  error: string | null;
}

function lagColor(lagMs: number): string {
  if (lagMs < 10 * 60 * 1000) return '#166534';
  if (lagMs < 30 * 60 * 1000) return '#92400e';
  return '#991b1b';
}

function lagBg(lagMs: number): string {
  if (lagMs < 10 * 60 * 1000) return '#f0fdf4';
  if (lagMs < 30 * 60 * 1000) return '#fffbeb';
  return '#fee2e2';
}

function fmtLag(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function SyncStatusPage() {
  const [{ data: stateRow }, { data: runs }] = await Promise.all([
    supabaseAdmin.from('analytics_sync_state').select('*').eq('id', 1).single(),
    supabaseAdmin.from('analytics_sync_runs').select('*').order('started_at', { ascending: false }).limit(20),
  ]);

  const state = stateRow as SyncState | null;
  const runList = (runs ?? []) as SyncRun[];

  const now = Date.now();
  const lagMs = state?.last_synced_created_at
    ? now - new Date(state.last_synced_created_at).getTime()
    : null;

  // Backfill progress: how far back we've reached vs target
  let backfillPct = 0;
  if (state && !state.backfill_complete && state.backfill_target_at && state.backfill_oldest_synced_at) {
    const start = now;
    const target = new Date(state.backfill_target_at).getTime();
    const oldest = new Date(state.backfill_oldest_synced_at).getTime();
    const total = start - target;
    const done = start - oldest;
    backfillPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  }

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '120px 80px 70px 70px 70px 80px 1fr',
    gap: 8,
    padding: '0.5rem 0.75rem',
    fontSize: '0.78rem',
    fontFamily: 'var(--font-mono)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Analytics Sync Status</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Events mirror from remote API into local Supabase. Syncs hourly via Vercel cron.
        </p>
      </div>

      {/* Lag + last run */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Lag card */}
        <div style={{
          background: lagMs !== null ? lagBg(lagMs) : 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem',
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>Data lag</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: lagMs !== null ? lagColor(lagMs) : 'var(--muted)' }}>
            {lagMs !== null ? fmtLag(lagMs) : 'Never synced'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>
            Last event: {fmtDate(state?.last_synced_created_at ?? null)}
          </div>
        </div>

        {/* Last run card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>Last run</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: state?.last_run_status === 'ok' ? '#166534' : '#991b1b' }}>
            {state?.last_run_status ?? '—'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>
            {fmtDate(state?.last_run_at ?? null)} · {(state?.last_run_rows ?? 0).toLocaleString()} rows
          </div>
          {state?.last_run_error && (
            <div style={{ fontSize: '0.72rem', color: '#991b1b', marginTop: 4, wordBreak: 'break-all' }}>
              {state.last_run_error}
            </div>
          )}
        </div>
      </div>

      {/* Backfill progress */}
      {state && !state.backfill_complete && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: 16 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Backfill in progress</div>
          <div style={{ height: 12, borderRadius: 6, background: '#e2e8f0', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: 12, borderRadius: 6, background: '#1a1a2e', width: `${backfillPct}%`, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Oldest synced: {fmtDate(state.backfill_oldest_synced_at)}</span>
            <span>{backfillPct}% complete</span>
            <span>Target: {fmtDate(state.backfill_target_at)}</span>
          </div>
        </div>
      )}

      {state?.backfill_complete && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '0.75rem 1.25rem', marginBottom: 16, fontSize: '0.85rem', color: '#166534' }}>
          90-day backfill complete
        </div>
      )}

      {/* Sync Now */}
      <div style={{ marginBottom: 24 }}>
        <SyncNowButton />
      </div>

      {/* Recent runs table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
          Recent runs (last 20)
        </div>
        <div style={{ ...rowStyle, background: 'rgba(0,0,0,0.03)', color: 'var(--muted)', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600 }}>
          <span>Started</span>
          <span>Kind</span>
          <span>Status</span>
          <span>Fetched</span>
          <span>Inserted</span>
          <span>HTTP</span>
          <span>Error</span>
        </div>
        {runList.length === 0 ? (
          <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>No runs yet.</p>
        ) : runList.map(r => (
          <div key={r.id} style={rowStyle}>
            <span>{fmtDate(r.started_at)}</span>
            <span style={{ textTransform: 'capitalize' }}>{r.kind}</span>
            <span style={{ color: r.error ? '#991b1b' : '#166534', fontWeight: 600 }}>{r.error ? 'error' : 'ok'}</span>
            <span>{r.rows_fetched.toLocaleString()}</span>
            <span>{r.rows_inserted.toLocaleString()}</span>
            <span style={{ color: (r.http_status ?? 200) >= 400 ? '#991b1b' : 'var(--text)' }}>{r.http_status ?? '—'}</span>
            <span style={{ color: '#991b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
