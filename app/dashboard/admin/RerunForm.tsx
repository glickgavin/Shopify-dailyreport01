'use client';
import { useState } from 'react';
import { rerunPipeline } from './actions';

export default function RerunForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const res = await rerunPipeline(date);
    setResult(res);
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        style={{
          padding: '0.5rem 0.875rem',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: '0.875rem',
          background: 'var(--bg)',
          fontFamily: 'var(--font-mono)',
        }}
      />
      <button
        type="submit"
        disabled={loading}
        style={{
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '0.5rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? 'Running…' : 'Re-run'}
      </button>
      {result && (
        <span style={{
          fontSize: '0.82rem',
          fontFamily: 'var(--font-mono)',
          color: result.ok ? 'var(--nc-green-dark)' : '#e53e3e',
          padding: '0.4rem 0.75rem',
          background: result.ok ? 'var(--nc-green-light)' : '#fee2e2',
          borderRadius: 8,
        }}>
          {result.ok ? '✓ ' : '✗ '}{result.message}
        </span>
      )}
    </form>
  );
}
