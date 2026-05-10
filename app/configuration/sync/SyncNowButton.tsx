'use client';

import { useState } from 'react';

export default function SyncNowButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setStatus('loading');
    setResult(null);
    try {
      const res = await fetch('/api/sync/analytics', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setResult(`Synced ${data.rows ?? 0} rows (${data.inserted ?? 0} new)`);
        setStatus('ok');
      } else {
        setResult(data.error ?? 'Unknown error');
        setStatus('error');
      }
    } catch (e) {
      setResult(String(e));
      setStatus('error');
    }
    // Reload page to refresh tables
    setTimeout(() => window.location.reload(), 1500);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={handleClick}
        disabled={status === 'loading'}
        style={{
          padding: '0.5rem 1.25rem',
          borderRadius: 8,
          border: 'none',
          background: status === 'loading' ? '#94a3b8' : '#1a1a2e',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: status === 'loading' ? 'not-allowed' : 'pointer',
        }}
      >
        {status === 'loading' ? 'Syncing…' : 'Sync Now'}
      </button>
      {result && (
        <span style={{ fontSize: '0.82rem', color: status === 'error' ? '#991b1b' : '#166534' }}>
          {result}
        </span>
      )}
    </div>
  );
}
