import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 480, padding: '2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.25rem', marginBottom: '0.5rem' }}>
          Shopify Daily Report
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}> ·</em>
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '0.95rem' }}>
          Automated sales intelligence for Storyboards
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Link
            href="/dashboard"
            style={{
              background: '#1a1a2e',
              color: '#fff',
              padding: '0.875rem 1.5rem',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.95rem',
            }}
          >
            Today&apos;s Dashboard
          </Link>
          <Link
            href="/history"
            style={{
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '0.875rem 1.5rem',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.95rem',
              border: '1px solid var(--border)',
            }}
          >
            History
          </Link>
          <Link
            href="/admin"
            style={{
              background: 'var(--surface)',
              color: 'var(--muted)',
              padding: '0.875rem 1.5rem',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 400,
              fontSize: '0.95rem',
              border: '1px solid var(--border)',
            }}
          >
            Admin
          </Link>
        </div>
      </div>
    </main>
  );
}
