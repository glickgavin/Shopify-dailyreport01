'use client';

// Error boundary: surfaces render errors instead of a blank page.
export default function CreditError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: '1.5rem 2rem', maxWidth: 560 }}>
        <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>Store Credit page failed to load</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#7f1d1d', marginBottom: 12 }}>{error.message}</div>
        <button onClick={reset} style={{ padding: '0.4rem 1rem', borderRadius: 8, border: 'none', background: '#991b1b', color: '#fff', cursor: 'pointer' }}>Retry</button>
      </div>
    </div>
  );
}
