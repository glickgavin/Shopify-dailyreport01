'use client';
import { useState, useTransition } from 'react';
import { savePathDefinition } from './actions';

export default function PathDefinitionEditor() {
  const [pattern, setPattern] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const inputStyle = {
    width: '100%', padding: '0.35rem 0.5rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit',
    boxSizing: 'border-box' as const, marginBottom: 6,
  };

  const handleSave = () => {
    if (!pattern.trim() || !name.trim()) { setMsg('Pattern and name required'); return; }
    startTransition(async () => {
      const result = await savePathDefinition({ path_pattern: pattern.trim(), canonical_name: name.trim(), description: description || null });
      if (result.error) {
        setMsg(result.error);
      } else {
        setMsg('Saved!');
        setPattern(''); setName(''); setDescription('');
        setTimeout(() => window.location.reload(), 400);
      }
    });
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', alignSelf: 'flex-start' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>Add Path Pattern</div>
      <input value={pattern} onChange={e => setPattern(e.target.value)} placeholder="/products/* or /checkout" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Canonical name (e.g. Product Page)" style={inputStyle} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" style={inputStyle} />
      <button onClick={handleSave} disabled={isPending} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
        {isPending ? 'Saving…' : 'Save Path'}
      </button>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
