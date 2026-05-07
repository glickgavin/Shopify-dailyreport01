'use client';
import { useState, useTransition } from 'react';
import { savePropertyDefinition } from './actions';

export default function PropertyDefinitionEditor() {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataType, setDataType] = useState('string');
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const inputStyle = {
    width: '100%', padding: '0.35rem 0.5rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit',
    boxSizing: 'border-box' as const, marginBottom: 6,
  };

  const handleSave = () => {
    if (!key.trim() || !name.trim()) { setMsg('Key and name required'); return; }
    startTransition(async () => {
      const result = await savePropertyDefinition({ property_key: key.trim(), display_name: name.trim(), description: description || null, data_type: dataType });
      if (result.error) {
        setMsg(result.error);
      } else {
        setMsg('Saved!');
        setKey(''); setName(''); setDescription(''); setDataType('string');
        setTimeout(() => window.location.reload(), 400);
      }
    });
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', alignSelf: 'flex-start' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>Add Property</div>
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="property_key (e.g. product_id)" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Display Name" style={inputStyle} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" style={inputStyle} />
      <select value={dataType} onChange={e => setDataType(e.target.value)} style={{ ...inputStyle }}>
        {['string', 'number', 'boolean', 'json'].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button onClick={handleSave} disabled={isPending} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
        {isPending ? 'Saving…' : 'Save Property'}
      </button>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
