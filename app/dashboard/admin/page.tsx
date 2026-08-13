import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import RerunForm from './RerunForm';
import BackfillForm from './BackfillForm';

export const revalidate = 0;

export default async function AdminPage() {
  // Verify session
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/dashboard/admin/login');

  const [{ data: logs }, { data: rawData }] = await Promise.all([
    supabaseAdmin
      .from('job_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('raw_data')
      .select('id,date,fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(10),
  ]);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
          Admin <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Panel</em>
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)' }}>{user.email}</span>
          <Link
            href="/dashboard"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-700)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* Re-run section */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem' }}>
          <SectionLabel>Re-run Pipeline</SectionLabel>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
            Fetch Shopify data for a specific date, reprocess, and save to Supabase.
          </p>
          <RerunForm />
        </div>

        {/* Backfill section */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem' }}>
          <SectionLabel>Backfill Date Range</SectionLabel>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
            Sequentially re-process a range of dates. Slack notifications are suppressed.
          </p>
          <BackfillForm />
        </div>

        {/* Job logs */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem' }}>
          <SectionLabel>Job Logs (last 50)</SectionLabel>
          {(logs ?? []).length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No logs yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    {['Time', 'Date', 'Job', 'Status', 'Message'].map((h) => (
                      <th key={h} style={{
                        padding: '0.6rem 0.875rem',
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: 'var(--muted)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(logs ?? []).map((log, i) => (
                    <tr key={log.id} style={{ borderBottom: i < (logs ?? []).length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                      <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{log.date ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{log.job_type}</td>
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontFamily: 'var(--font-mono)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 6,
                          background: log.status === 'success' ? 'var(--nc-green-light)' : log.status === 'error' ? '#fee2e2' : 'var(--surface2)',
                          color: log.status === 'success' ? 'var(--nc-green-dark)' : log.status === 'error' ? '#991b1b' : 'var(--muted)',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.875rem', color: 'var(--muted)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Raw data inspector */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem' }}>
          <SectionLabel>Raw Data Store (last 10 fetches)</SectionLabel>
          {(rawData ?? []).length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No raw data records.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(rawData ?? []).map((r) => (
                <div key={r.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.6rem 0.875rem',
                  background: 'var(--surface2)',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  fontFamily: 'var(--font-mono)',
                }}>
                  <span style={{ fontWeight: 600 }}>{r.date}</span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                    fetched {new Date(r.fetched_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Link
                    href={`/dashboard/${r.date}`}
                    style={{ marginLeft: 'auto', color: 'var(--cash-blue)', textDecoration: 'none', fontSize: '0.75rem' }}
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'var(--muted)',
      marginBottom: '0.75rem',
    }}>
      {children}
    </div>
  );
}
