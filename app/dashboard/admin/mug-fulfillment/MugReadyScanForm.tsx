'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { scanMugReady } from './actions';

type Result = { ok: boolean; message: string } | null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        background: '#166534', color: '#fff', border: 'none',
        borderRadius: 6, padding: '0.4rem 0.875rem',
        fontSize: '0.8rem', fontFamily: 'var(--font-mono)', cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.7 : 1,
      }}
    >
      {pending ? 'Scanning…' : 'Scan'}
    </button>
  );
}

export default function MugReadyScanForm({
  action,
}: {
  action: typeof scanMugReady;
}) {
  const [result, dispatch] = useFormState<Result, FormData>(
    action as (prev: Result, fd: FormData) => Promise<Result>,
    null,
  );

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '0.875rem 1rem',
      marginBottom: '1rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
        Scan mug:ready
      </span>
      <form action={dispatch} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
        <input
          type="number"
          name="days"
          defaultValue={18}
          min={1}
          max={90}
          style={{
            width: 60, padding: '0.4rem 0.6rem',
            border: '1px solid var(--border)', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
            background: 'var(--surface2)', color: 'var(--text)',
          }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>days back</span>
        <SubmitButton />
      </form>
      {result && (
        <span style={{
          fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
          color: result.ok ? '#166534' : '#991b1b',
        }}>
          {result.message}
        </span>
      )}
    </div>
  );
}
