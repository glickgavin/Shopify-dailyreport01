'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard/admin`,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  return (
    <main style={{
      background: 'var(--bg)', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        border: '1px solid var(--border)', padding: '2.5rem',
        maxWidth: 400, width: '100%',
      }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
          Admin <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Sign In</em>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Enter your email to receive a magic link.
        </p>

        {sent ? (
          <div style={{
            background: 'var(--nc-green-light)', borderRadius: 10,
            padding: '1rem 1.25rem', color: 'var(--nc-green-dark)', fontSize: '0.9rem',
          }}>
            ✓ Magic link sent to <strong>{email}</strong>. Check your inbox.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              style={{
                padding: '0.75rem 1rem', borderRadius: 10,
                border: '1px solid var(--border)', fontSize: '0.9rem',
                fontFamily: 'var(--font-body)', background: 'var(--bg)',
                outline: 'none',
              }}
            />
            {error && (
              <div style={{ color: '#e53e3e', fontSize: '0.8rem' }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                background: '#1a1a2e', color: '#fff', border: 'none',
                borderRadius: 10, padding: '0.75rem 1rem',
                fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Sending…' : 'Send Magic Link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
