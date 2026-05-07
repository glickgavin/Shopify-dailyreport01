'use client';
import { useState, useTransition } from 'react';
import { saveFunnel, deleteFunnel } from './actions';

interface Step { event_type: string; label?: string }

interface Props {
  currentSteps: Step[];
  funnelId?: number;
  funnelName?: string;
}

export default function FunnelEditor({ currentSteps, funnelId, funnelName }: Props) {
  const [name, setName] = useState(funnelName ?? '');
  const [steps, setSteps] = useState<Step[]>(currentSteps.length ? currentSteps : [{ event_type: '' }]);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const addStep = () => setSteps(s => [...s, { event_type: '' }]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, key: keyof Step, value: string) =>
    setSteps(s => s.map((step, idx) => idx === i ? { ...step, [key]: value } : step));

  const handleSave = () => {
    if (!name.trim()) { setMsg('Name required'); return; }
    const validSteps = steps.filter(s => s.event_type.trim());
    if (!validSteps.length) { setMsg('At least one step required'); return; }
    startTransition(async () => {
      const result = await saveFunnel({ id: funnelId, name, steps: validSteps });
      setMsg(result.error ?? 'Saved!');
      if (!result.error) setTimeout(() => window.location.reload(), 500);
    });
  };

  const handleDelete = () => {
    if (!funnelId || !confirm('Delete this funnel?')) return;
    startTransition(async () => {
      await deleteFunnel(funnelId);
      window.location.href = '/analytics/funnel';
    });
  };

  const inputStyle = {
    width: '100%', padding: '0.35rem 0.5rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        {funnelId ? 'Edit Funnel' : 'New Funnel'}
      </div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Funnel name"
        style={{ ...inputStyle, marginBottom: 8 }}
      />
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', padding: '0.4rem 0', minWidth: 16 }}>{i + 1}.</span>
          <input
            value={step.event_type}
            onChange={e => updateStep(i, 'event_type', e.target.value)}
            placeholder="event_type"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
          <button
            onClick={() => removeStep(i)}
            style={{ padding: '0 0.4rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}
          >×</button>
        </div>
      ))}
      <button
        onClick={addStep}
        style={{ fontSize: '0.78rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0', marginBottom: 8 }}
      >
        + Add step
      </button>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSave}
          disabled={isPending}
          style={{ flex: 1, padding: '0.4rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {funnelId && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Delete
          </button>
        )}
      </div>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
