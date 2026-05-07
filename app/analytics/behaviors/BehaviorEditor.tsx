'use client';
import { useState, useTransition } from 'react';
import { saveBehavior, deleteBehavior } from './actions';
import type { Predicate, PredicateKind, PredicateOp } from '@/lib/analytics/predicates';

const KINDS: PredicateKind[] = ['event_type', 'page_path', 'device_type', 'property'];
const OPS: PredicateOp[] = ['is', 'is_not', 'contains', 'not_contains', 'exists', 'not_exists'];

interface Props {
  currentPredicates: Predicate[];
  behaviorId?: number;
  behaviorName?: string;
}

export default function BehaviorEditor({ currentPredicates, behaviorId, behaviorName }: Props) {
  const [name, setName] = useState(behaviorName ?? '');
  const [predicates, setPredicates] = useState<Predicate[]>(
    currentPredicates.length ? currentPredicates : [{ kind: 'event_type', op: 'is', value: '' }]
  );
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const update = (i: number, patch: Partial<Predicate>) =>
    setPredicates(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p));

  const add = () => setPredicates(ps => [...ps, { kind: 'event_type', op: 'is', value: '' }]);
  const remove = (i: number) => setPredicates(ps => ps.filter((_, idx) => idx !== i));

  const needsValue = (op: PredicateOp) => op !== 'exists' && op !== 'not_exists';

  const sel = (value: string, onChange: (v: string) => void, options: string[]) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem', fontFamily: 'inherit' }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const handleSave = () => {
    if (!name.trim()) { setMsg('Name required'); return; }
    startTransition(async () => {
      const result = await saveBehavior({ id: behaviorId, name, predicates });
      setMsg(result.error ?? 'Saved!');
      if (!result.error) setTimeout(() => window.location.reload(), 500);
    });
  };

  const handleDelete = () => {
    if (!behaviorId || !confirm('Delete this behavior?')) return;
    startTransition(async () => {
      await deleteBehavior(behaviorId);
      window.location.href = '/analytics/behaviors';
    });
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>
        {behaviorId ? 'Edit Behavior' : 'New Behavior'}
      </div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Behavior name"
        style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8 }}
      />
      {predicates.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {sel(p.kind, (v) => update(i, { kind: v as PredicateKind }), KINDS)}
          {p.kind === 'property' && (
            <input
              value={p.key ?? ''}
              onChange={e => update(i, { key: e.target.value })}
              placeholder="prop key"
              style={{ width: 80, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
            />
          )}
          {sel(p.op, (v) => update(i, { op: v as PredicateOp }), OPS)}
          {needsValue(p.op) && (
            <input
              value={p.value ?? ''}
              onChange={e => update(i, { value: e.target.value })}
              placeholder="value"
              style={{ flex: 1, minWidth: 60, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
            />
          )}
          <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
        </div>
      ))}
      <button onClick={add} style={{ fontSize: '0.78rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0', marginBottom: 8 }}>+ Add predicate</button>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSave} disabled={isPending} style={{ flex: 1, padding: '0.4rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {behaviorId && (
          <button onClick={handleDelete} disabled={isPending} style={{ padding: '0.4rem 0.6rem', borderRadius: 6, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Delete
          </button>
        )}
      </div>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
