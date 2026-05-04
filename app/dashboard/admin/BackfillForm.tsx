'use client';
import { useRef, useState } from 'react';
import { rerunPipeline } from './actions';

type RowStatus = 'pending' | 'running' | 'done' | 'error';

interface ProgressRow {
  date: string;
  status: RowStatus;
  message: string;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function defaultDates() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: yesterday.toISOString().slice(0, 10),
  };
}

const STATUS_BADGE: Record<RowStatus, { label: string; bg: string; color: string }> = {
  pending:  { label: 'pending', bg: 'var(--surface2)',       color: 'var(--muted)' },
  running:  { label: 'running', bg: '#dbeafe',               color: '#1d4ed8' },
  done:     { label: 'done',    bg: 'var(--nc-green-light)', color: 'var(--nc-green-dark)' },
  error:    { label: 'error',   bg: '#fee2e2',               color: '#991b1b' },
};

export default function BackfillForm() {
  const defaults = defaultDates();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);

  const completed = rows.filter((r) => r.status === 'done' || r.status === 'error').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  function updateRow(date: string, status: RowStatus, message = '') {
    setRows((prev) => prev.map((r) => r.date === date ? { ...r, status, message } : r));
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate || startDate > endDate) return;

    const dates = datesInRange(startDate, endDate);
    if (dates.length === 0) return;

    abortRef.current = false;
    setRows(dates.map((d) => ({ date: d, status: 'pending', message: '' })));
    setRunning(true);

    for (const date of dates) {
      if (abortRef.current) break;
      updateRow(date, 'running');
      const res = await rerunPipeline(date, { silent: true });
      updateRow(date, res.ok ? 'done' : 'error', res.message);
      if (!abortRef.current) await sleep(800);
    }

    setRunning(false);
  }

  function handleCancel() {
    abortRef.current = true;
  }

  const inputStyle: React.CSSProperties = {
    padding: '0.5rem 0.875rem',
    borderRadius: 8,
    border: '1px solid var(--border)',
    fontSize: '0.875rem',
    background: 'var(--bg)',
    fontFamily: 'var(--font-mono)',
  };

  const btnStyle = (disabled: boolean, variant: 'primary' | 'danger' = 'primary'): React.CSSProperties => ({
    background: variant === 'danger' ? '#991b1b' : '#1a1a2e',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '0.5rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  });

  return (
    <div>
      <form onSubmit={handleStart} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: rows.length ? '1.5rem' : 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
          From
          <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} required style={inputStyle} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
          To
          <input type="date" value={endDate} min={startDate} max={defaults.end} onChange={(e) => setEndDate(e.target.value)} required style={inputStyle} />
        </label>
        {startDate && endDate && startDate <= endDate && (
          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
            {datesInRange(startDate, endDate).length} days
          </span>
        )}
        <button type="submit" disabled={running} style={btnStyle(running)}>
          {running ? 'Running…' : 'Start Backfill'}
        </button>
        {running && (
          <button type="button" onClick={handleCancel} style={btnStyle(false, 'danger')}>
            Cancel
          </button>
        )}
      </form>

      {rows.length > 0 && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: 360, overflowY: 'auto' }}>
            {rows.map((row) => {
              const badge = STATUS_BADGE[row.status];
              return (
                <div key={row.date} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.45rem 0.75rem',
                  background: 'var(--surface2)',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-mono)',
                }}>
                  <span style={{ minWidth: 90 }}>{row.date}</span>
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '0.15rem 0.45rem',
                    borderRadius: 5,
                    background: badge.bg,
                    color: badge.color,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    minWidth: 56,
                    textAlign: 'center',
                  }}>
                    {row.status === 'running' ? '⟳ running' : badge.label}
                  </span>
                  {row.message && (
                    <span style={{ color: 'var(--muted)', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.message}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
            {completed} / {rows.length} completed
            {errorCount > 0 && <span style={{ color: '#991b1b', marginLeft: '0.5rem' }}>— {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
            {!running && completed === rows.length && errorCount === 0 && <span style={{ color: 'var(--nc-green-dark)', marginLeft: '0.5rem' }}>— all done</span>}
          </div>
        </div>
      )}
    </div>
  );
}
