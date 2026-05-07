export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase';
import PathDefinitionEditor from './PathDefinitionEditor';

export default async function ConfigPathsPage() {
  const { data: definitions } = await supabaseAdmin
    .from('analytics_path_definitions')
    .select('*')
    .order('path_pattern');

  const defs = definitions ?? [];

  return (
    <div style={{ padding: '2rem', maxWidth: 960 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Path Configuration</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Map URL path patterns to human-readable names. Use * as wildcard (e.g. /products/*).
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        {/* Existing definitions */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            Path Patterns ({defs.length})
          </div>
          {defs.length === 0 ? (
            <p style={{ padding: '1.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>No paths defined yet.</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Pattern', 'Canonical Name', 'Description'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defs.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text)' }}>{d.path_pattern}</td>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 500 }}>{d.canonical_name}</td>
                    <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)' }}>{d.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PathDefinitionEditor />
      </div>
    </div>
  );
}
