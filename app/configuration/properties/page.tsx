export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase';
import PropertyDefinitionEditor from './PropertyDefinitionEditor';

export default async function ConfigPropertiesPage() {
  const { data: definitions } = await supabaseAdmin
    .from('analytics_property_definitions')
    .select('*')
    .order('property_key');

  const defs = definitions ?? [];

  const typeColors: Record<string, string> = {
    string: '#dbeafe',
    number: '#dcfce7',
    boolean: '#fef3c7',
    json: '#f3e8ff',
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 960 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Property Configuration</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Define custom event property keys with human-readable names and types.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            Properties ({defs.length})
          </div>
          {defs.length === 0 ? (
            <p style={{ padding: '1.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>No properties defined.</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Property Key', 'Display Name', 'Type', 'Description'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defs.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{d.property_key}</td>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: 500 }}>{d.display_name}</td>
                    <td style={{ padding: '0.6rem 1rem' }}>
                      <span style={{ padding: '0.15rem 0.45rem', borderRadius: 4, background: typeColors[d.data_type] ?? '#e2e8f0', fontSize: '0.72rem', fontWeight: 600 }}>
                        {d.data_type}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)' }}>{d.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <PropertyDefinitionEditor />
      </div>
    </div>
  );
}
