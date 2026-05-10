export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase';
import { fetchDistinctEventTypes } from '@/lib/analytics/client';
import EventDefinitionEditor from './EventDefinitionEditor';

export default async function ConfigEventsPage() {
  const [{ data: categories }, { data: definitions }] = await Promise.all([
    supabaseAdmin.from('analytics_event_categories').select('*').order('name'),
    supabaseAdmin.from('analytics_event_definitions').select('id,event_type,display_name,description,category_id,is_conversion,is_purchase,revenue_property,predicates').order('event_type'),
  ]);

  const cats = categories ?? [];
  const defs = definitions ?? [];

  // Discover live event types
  let liveTypes: string[] = [];
  try {
    liveTypes = await fetchDistinctEventTypes({});
  } catch {
    // non-fatal
  }

  const mappedTypes = new Set(defs.map(d => d.event_type));
  const unmappedTypes = liveTypes.filter(t => !mappedTypes.has(t));

  return (
    <div style={{ padding: '2rem', maxWidth: 960 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Event Configuration</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            {defs.length} defined · {unmappedTypes.length} unmapped live types
          </p>
        </div>
        {unmappedTypes.length > 0 && (
          <a href="/configuration/unmapped" style={{
            padding: '0.4rem 0.9rem', borderRadius: 8,
            background: '#fef3c7', color: '#92400e',
            border: '1px solid #fcd34d', textDecoration: 'none',
            fontSize: '0.82rem', fontWeight: 600,
          }}>
            ⚠ {unmappedTypes.length} unmapped
          </a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Existing definitions */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            Defined Events ({defs.length})
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {defs.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>None yet.</p>
            ) : (
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Event Type', 'Display Name', 'Category', 'Conditions', 'Flags'].map(h => (
                      <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, background: 'var(--surface)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {defs.map(d => {
                    const cat = cats.find(c => c.id === d.category_id);
                    return (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{d.event_type}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{d.display_name}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{cat?.name ?? '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                          {Array.isArray(d.predicates) && (d.predicates as unknown[]).length > 0
                            ? `${(d.predicates as unknown[]).length} cond.`
                            : '—'}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {d.is_purchase && <span style={{ marginRight: 4, fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>purchase</span>}
                          {d.is_conversion && <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: '#dbeafe', color: '#1e40af' }}>conversion</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Create / Edit */}
        <div>
          <EventDefinitionEditor categories={cats} />
          {/* Categories section */}
          <div style={{ marginTop: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>Categories ({cats.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cats.map(c => (
                <span key={c.id} style={{ padding: '0.2rem 0.55rem', borderRadius: 6, background: c.color ?? '#e2e8f0', color: '#1a1a1a', fontSize: '0.75rem', fontWeight: 500 }}>
                  {c.icon && `${c.icon} `}{c.name}
                </span>
              ))}
              {cats.length === 0 && <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No categories</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
