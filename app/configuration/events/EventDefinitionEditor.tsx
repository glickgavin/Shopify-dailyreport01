'use client';
import { useState, useTransition } from 'react';
import { saveEventDefinition } from './actions';
import type { Predicate, PredicateKind, PredicateOp } from '@/lib/analytics/predicates';

const KINDS: PredicateKind[] = ['event_type', 'page_path', 'device_type', 'property'];
const OPS: PredicateOp[] = ['is', 'is_not', 'contains', 'not_contains', 'exists', 'not_exists'];

interface Category { id: number; name: string; color: string | null; icon: string | null }

interface Props {
  categories: Category[];
  defaultEventType?: string;
}

export default function EventDefinitionEditor({ categories, defaultEventType }: Props) {
  const [eventType, setEventType] = useState(defaultEventType ?? '');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isConversion, setIsConversion] = useState(false);
  const [isPurchase, setIsPurchase] = useState(false);
  const [revenueProperty, setRevenueProperty] = useState('');
  const [predicates, setPredicates] = useState<Predicate[]>([{ kind: 'event_type', op: 'is', value: '' }]);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  const inputStyle = {
    width: '100%', padding: '0.35rem 0.5rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'inherit',
    boxSizing: 'border-box' as const, marginBottom: 6,
  };

  const selStyle = {
    padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem', fontFamily: 'inherit',
  };

  const updatePredicate = (i: number, patch: Partial<Predicate>) =>
    setPredicates(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p));

  const addPredicate = () => setPredicates(ps => [...ps, { kind: 'event_type', op: 'is', value: '' }]);
  const removePredicate = (i: number) => setPredicates(ps => ps.filter((_, idx) => idx !== i));

  const needsValue = (op: PredicateOp) => op !== 'exists' && op !== 'not_exists';

  const handleSave = () => {
    if (!eventType.trim() || !displayName.trim()) { setMsg('Event type and display name required'); return; }
    startTransition(async () => {
      const result = await saveEventDefinition({
        event_type: eventType.trim(),
        display_name: displayName.trim(),
        description: description || null,
        category_id: categoryId ? parseInt(categoryId) : null,
        is_conversion: isConversion,
        is_purchase: isPurchase,
        revenue_property: revenueProperty || null,
        predicates,
      });
      if (result.error) {
        setMsg(result.error);
      } else {
        setMsg('Saved!');
        setEventType(''); setDisplayName(''); setDescription('');
        setCategoryId(''); setIsConversion(false); setIsPurchase(false); setRevenueProperty('');
        setPredicates([{ kind: 'event_type', op: 'is', value: '' }]);
        setTimeout(() => window.location.reload(), 400);
      }
    });
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.75rem' }}>Define Event</div>
      <input value={eventType} onChange={e => setEventType(e.target.value)} placeholder="event_type (e.g. add_to_cart)" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display Name" style={inputStyle} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" style={inputStyle} />
      <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
        <option value="">— No Category —</option>
        {categories.map(c => <option key={c.id} value={String(c.id)}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={isConversion} onChange={e => setIsConversion(e.target.checked)} style={{ accentColor: '#1a1a2e' }} />
          Conversion
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={isPurchase} onChange={e => setIsPurchase(e.target.checked)} style={{ accentColor: '#1a1a2e' }} />
          Purchase
        </label>
      </div>
      {isPurchase && (
        <input value={revenueProperty} onChange={e => setRevenueProperty(e.target.value)} placeholder="Revenue property key (e.g. total)" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      )}

      {/* Compound predicate builder */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8, marginBottom: 6 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
          Match conditions (AND)
          <span style={{ fontWeight: 400, marginLeft: 6 }}>— all must be true for an event to match</span>
        </div>
        {predicates.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={p.kind} onChange={e => updatePredicate(i, { kind: e.target.value as PredicateKind })} style={selStyle}>
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            {p.kind === 'property' && (
              <input
                value={p.key ?? ''}
                onChange={e => updatePredicate(i, { key: e.target.value })}
                placeholder="prop key"
                style={{ width: 80, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
              />
            )}
            <select value={p.op} onChange={e => updatePredicate(i, { op: e.target.value as PredicateOp })} style={selStyle}>
              {OPS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {needsValue(p.op) && (
              <input
                value={p.value ?? ''}
                onChange={e => updatePredicate(i, { value: e.target.value })}
                placeholder="value"
                style={{ flex: 1, minWidth: 60, padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.78rem' }}
              />
            )}
            <button onClick={() => removePredicate(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
          </div>
        ))}
        <button onClick={addPredicate} style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0' }}>
          + Add condition
        </button>
      </div>

      <button onClick={handleSave} disabled={isPending} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
        {isPending ? 'Saving…' : 'Save Event Definition'}
      </button>
      {msg && <p style={{ fontSize: '0.75rem', color: msg === 'Saved!' ? '#166534' : '#991b1b', marginTop: 4 }}>{msg}</p>}
    </div>
  );
}
