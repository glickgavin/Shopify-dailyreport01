'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import DateRangePicker, { type Preset } from './DateRangePicker';

const DEVICES = ['desktop', 'mobile', 'tablet'];

interface Props {
  preset: Preset;
  from?: string;
  to?: string;
  devices: string[];
  excludePreview: boolean;
}

export default function AnalyticsFilterBar({ preset, from, to, devices, excludePreview }: Props) {
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

  const toggleDevice = (d: string) => {
    const set = new Set(devices);
    if (set.has(d)) set.delete(d); else set.add(d);
    navigate({ devices: Array.from(set).join(',') });
  };

  const togglePreview = () => {
    navigate({ exclude_preview: excludePreview ? '' : 'true' });
  };

  const activeDevStyle = { background: '#1a1a2e', color: '#fff', border: '1px solid #1a1a2e', fontWeight: 600 };
  const baseDevStyle = { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 0' }}>
      <DateRangePicker preset={preset} from={from} to={to} />
      <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
      {DEVICES.map(d => (
        <button
          key={d}
          onClick={() => toggleDevice(d)}
          style={{
            padding: '0.35rem 0.65rem',
            borderRadius: 8,
            fontSize: '0.78rem',
            fontFamily: 'inherit',
            textTransform: 'capitalize',
            ...(devices.includes(d) ? activeDevStyle : baseDevStyle),
          }}
        >
          {d}
        </button>
      ))}
      <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={excludePreview} onChange={togglePreview} style={{ accentColor: '#1a1a2e' }} />
        Exclude preview
      </label>
    </div>
  );
}
