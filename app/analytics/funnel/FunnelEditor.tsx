'use client';
import { useState, useTransition } from 'react';
import { saveFunnel, deleteFunnel } from './actions';
import type { Predicate, PredicateKind, PredicateOp } from '@/lib/analytics/predicates';
import type { FunnelStep, AvailableDefinition } from './page';

const KINDS: PredicateKind[] = ['event_type', 'page_path', 'device_type', 'property'];
const OPS: PredicateOp[] = ['is', 'is_not', 'contains', 'not_contains', 'exists', 'not_exists'];

interface Props {
  currentSteps: FunnelStep[];
  funnelId?: number;
  funnelName?: string;
  availableDefinitions: AvailableDefinition[];
}

const inputStyle = {
  padding: '0.35rem 0.5rem', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
};

const selStyle = {
  padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem', fontFamily: 'inherit',
};

const needsValue = (op: PredicateOp) => op !== 'exists' && op !== 'not_exists';

function emptyStep(): FunnelStep {
  return { label: '', predicates: [{ kind: 'event_type', op: 'is', value: '' }] };
}

export default function FunnelEditor({ currentSteps, funnelId, funnelName, availableDefinitions }: Props) {
  const [name, setName] = useState(funnelName ?? '');
  const [steps, setSteps] = useState<FunnelStep[]>(currentSteps.length ? currentSteps : [emptyStep()]);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const updateStepLabel = (i: number, val: string) =>
    setSteps(ss => ss.map((s, idx) => idx === i ? { ...s, label: val } : s));

  const updatePredicate = (si: number, pi: number, patch: Partial<Predicate>) =>
    setSteps(ss => ss.map((s, idx) =>
      idx === si ? { ...s, predicates: s.predicates.map((p, pidx) => pidx === pi ? { ...p, ...patch } : p) } : s
    ));

  const addPredicate = (si: number) =>
    setSteps(ss => ss.map((s, idx) =>
      idx === si ? { ...s, predicates: [...s.predicates, { kind: 'event_type', op: 'is', value: '' }] } : s
    ));

  const removePredicate = (si: number, pi: number) =>
    setSteps(ss => ss.map((s, idx) =>
      idx === si ? { ...s, predicates: s.predicates.filter((_, pidx) => pidx !== pi) } : s
    ));

  const addStep = () => setSteps(ss => [...ss, emptyStep()]);
  const removeStep = (i: number) => setSteps(ss => ss.filter((_, idx) => idx !== i));

  const applyDefinition = (si: number, defLabel: string) => {
    const def = availableDefinitions.find(d => d.label === defLabel);
    if (!def) return;
    setSteps(ss => ss.map((s, idx) =>
      idx === si ? { label: def.label, predicates: def.predicates.map(p => ({ ...p })) } : s
    ));
  };

  const handleSave = () => {
    if (!name.trim()) { setMsg('Name required'); return; }
    const validSteps = steps.filter(s => s.predicates.some(p => (p.value ?? '').trim() || p.op === 'exists' || p.op === 'not_exists'));
    if (!validSteps.length) { setMsg('At least one step with a condition required'); return; }
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

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{funnelId ? 'Edit Funnel' : 'New Funnel'}</div>
        {funnelId && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            style={{ padding: '0.2rem 0.5rem', borderRadius: 5, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Delete
          </button>
        )}
      </div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Funnel name"
        style={{ ...inputStyle, width: '100%', marginBottom: 10 }}
      />

      {steps.map((step, si) => (
        <div key={si} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.75rem', background: 'var(--background)' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', minWidth: 16, fontWeight: 600 }}>{si + 1}.</span>
            <input
              value={step.label}
              onChange={e => updateStepLabel(si, e.target.value)}
              placeholder="Step label"
              style={{ ...inputStyle, flex: 1 }}
            />
            {availableDefinitions.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) applyDefinition(si, e.target.value); }}
                style={{ ...selStyle, width: 160 }}
                title="Fill this step from an event definition or recent event name"
              >
                <option value="">Use template…</option>
                {availableDefinitions.map(d => (
                  <option key={d.label} value={d.label}>{d.label}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => removeStep(si)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0 0.2rem' }}
            >×</button>
          </div>

          {/* Predicates */}
          {step.predicates.map((p, pi) => (
            <div key={pi} style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 20 }}>
              <select value={p.kind} onChange={e => updatePredicate(si, pi, { kind: e.target.value as PredicateKind })} style={selStyle}>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              {p.kind === 'property' && (
                <input
                  value={p.key ?? ''}
                  onChange={e => updatePredicate(si, pi, { key: e.target.value })}
                  placeholder="prop key"
                  style={{ width: 72, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
                />
              )}
              <select value={p.op} onChange={e => updatePredicate(si, pi, { op: e.target.value as PredicateOp })} style={selStyle}>
                {OPS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {needsValue(p.op) && (
                <input
                  value={p.value ?? ''}
                  onChange={e => updatePredicate(si, pi, { value: e.target.value })}
                  placeholder="value"
                  style={{ flex: 1, minWidth: 60, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
                />
              )}
              {step.predicates.length > 1 && (
                <button onClick={() => removePredicate(si, pi)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
              )}
            </div>
          ))}
          <button
            onClick={() => addPredicate(si)}
            style={{ fontSize: '0.72rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0 0 20px' }}
          >
            + AND condition
          </button>
        </div>
      ))}

      <button
        onClick={addStep}
        style={{ fontSize: '0.78rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0', marginBottom: 8 }}
      >
        + Add step
      </button>
      <button
        onClick={handleSave}
        disabled={isPending}
        style={{ width: '100%', padding: '0.4rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        {isPending ? 'Saving…' : 'Save'}
      </button>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
