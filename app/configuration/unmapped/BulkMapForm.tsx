'use client';
import { useState, useTransition } from 'react';
import { bulkSaveEventDefinitions } from './actions';

interface Category { id: number; name: string; color: string | null; icon: string | null }

interface Props {
  unmappedTypes: string[];
  categories: Category[];
}

interface Row {
  event_type: string;
  display_name: string;
  category_id: string;
  is_conversion: boolean;
  is_purchase: boolean;
  skip: boolean;
}

export default function BulkMapForm({ unmappedTypes, categories }: Props) {
  const [rows, setRows] = useState<Row[]>(
    unmappedTypes.map(t => ({
      event_type: t,
      display_name: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category_id: '',
      is_conversion: false,
      is_purchase: false,
      skip: false,
    }))
  );
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const handleSave = () => {
    const toSave = rows.filter(r => !r.skip && r.display_name.trim());
    if (!toSave.length) { setMsg('Nothing to save'); return; }
    startTransition(async () => {
      const result = await bulkSaveEventDefinitions(toSave.map(r => ({
        event_type: r.event_type,
        display_name: r.display_name.trim(),
        description: null,
        category_id: r.category_id ? parseInt(r.category_id) : null,
        is_conversion: r.is_conversion,
        is_purchase: r.is_purchase,
        revenue_property: null,
      })));
      setMsg(result.error ?? `Saved ${toSave.length} definitions!`);
      if (!result.error) setTimeout(() => window.location.reload(), 600);
    });
  };

  const inputSm = {
    padding: '0.3rem 0.45rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: '0.78rem', fontFamily: 'inherit',
  };

  return (
    <div>
      <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Skip', 'Event Type', 'Display Name', 'Category', 'Conv?', 'Purchase?'].map(h => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, background: 'var(--surface)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.event_type} style={{ borderBottom: '1px solid var(--border)', opacity: row.skip ? 0.4 : 1 }}>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <input type="checkbox" checked={row.skip} onChange={e => update(i, { skip: e.target.checked })} style={{ accentColor: '#6366f1' }} />
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>{row.event_type}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <input
                    value={row.display_name}
                    onChange={e => update(i, { display_name: e.target.value })}
                    disabled={row.skip}
                    style={{ ...inputSm, width: '100%', minWidth: 160 }}
                  />
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <select value={row.category_id} onChange={e => update(i, { category_id: e.target.value })} disabled={row.skip} style={inputSm}>
                    <option value="">—</option>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  <input type="checkbox" checked={row.is_conversion} onChange={e => update(i, { is_conversion: e.target.checked })} disabled={row.skip} style={{ accentColor: '#1a1a2e' }} />
                </td>
                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                  <input type="checkbox" checked={row.is_purchase} onChange={e => update(i, { is_purchase: e.target.checked })} disabled={row.skip} style={{ accentColor: '#1a1a2e' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={handleSave}
          disabled={isPending}
          style={{ padding: '0.5rem 1.25rem', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
        >
          {isPending ? 'Saving…' : `Save ${rows.filter(r => !r.skip).length} definitions`}
        </button>
        {msg && <span style={{ fontSize: '0.82rem', color: msg.includes('Saved') ? '#166534' : '#991b1b' }}>{msg}</span>}
      </div>
    </div>
  );
}
