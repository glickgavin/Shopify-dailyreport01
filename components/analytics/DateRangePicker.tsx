'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';

export type Preset = 'today' | 'yesterday' | '3d' | '7d' | '30d' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '3d', label: '3 Days' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'custom', label: 'Custom' },
];

interface Props {
  preset: Preset;
  from?: string;
  to?: string;
}

export default function DateRangePicker({ preset, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const navigate = useCallback((params: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    router.push(`${pathname}?${next.toString()}`);
  }, [router, pathname, sp]);

  const activeStyle = {
    background: '#1a1a2e',
    color: '#fff',
    fontWeight: 600,
    border: '1px solid #1a1a2e',
  };
  const baseStyle = {
    background: 'var(--surface)',
    color: 'var(--text)',
    fontWeight: 400,
    border: '1px solid var(--border)',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {PRESETS.map(p => (
        <button
          key={p.value}
          onClick={() => navigate({ preset: p.value, from: '', to: '' })}
          style={{
            padding: '0.35rem 0.75rem',
            borderRadius: 8,
            fontSize: '0.82rem',
            fontFamily: 'inherit',
            ...(preset === p.value ? activeStyle : baseStyle),
          }}
        >
          {p.label}
        </button>
      ))}
      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 4 }}>
          <input
            type="date"
            defaultValue={from}
            onChange={e => navigate({ preset: 'custom', from: e.target.value, to: to ?? '' })}
            style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.82rem' }}
          />
          <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>to</span>
          <input
            type="date"
            defaultValue={to}
            onChange={e => navigate({ preset: 'custom', from: from ?? '', to: e.target.value })}
            style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.82rem' }}
          />
        </div>
      )}
    </div>
  );
}
