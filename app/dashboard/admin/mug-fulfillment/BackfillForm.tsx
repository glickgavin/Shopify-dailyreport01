'use client';

import { useFormState } from 'react-dom';
import { backfillSingleOrder } from './actions';

const initial = { ok: false, message: '' };

export default function BackfillForm() {
  const [state, action] = useFormState(backfillSingleOrder, initial);

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '0.875rem 1rem',
      marginBottom: '1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
        Backfill order
      </span>
      <form action={action} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
        <input
          type="text"
          name="shopify_order_id"
          placeholder="Shopify order ID or URL  (e.g. 6956296143044)"
          required
          style={{
            flex: 1, minWidth: 260, padding: '0.4rem 0.6rem',
            border: '1px solid var(--border)', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
            background: 'var(--surface2)', color: 'var(--text)',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#1a1a2e', color: '#fff', border: 'none',
            borderRadius: 6, padding: '0.4rem 0.875rem',
            fontSize: '0.8rem', fontFamily: 'var(--font-mono)', cursor: 'pointer',
          }}
        >
          Backfill
        </button>
      </form>
      {state.message && (
        <span style={{
          fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
          color: state.ok ? '#166534' : '#991b1b',
          background: state.ok ? '#dcfce7' : '#fee2e2',
          padding: '0.25rem 0.6rem', borderRadius: 4,
        }}>
          {state.message}
        </span>
      )}
    </div>
  );
}
