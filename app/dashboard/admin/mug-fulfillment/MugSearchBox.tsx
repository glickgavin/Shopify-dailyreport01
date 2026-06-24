'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';

export default function MugSearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      const q = val.trim();
      if (q) params.set('q', q);
      else params.delete('q');
      params.delete('drawer');
      router.push(`/dashboard/admin/mug-fulfillment?${params.toString()}`);
    }, 350);
  }, [router, sp]);

  return (
    <input
      type="search"
      defaultValue={defaultValue}
      onChange={handleChange}
      placeholder="Search order # or customer…"
      style={{
        padding: '0.4rem 0.75rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        background: 'var(--surface2)',
        color: 'var(--text)',
        width: 240,
        outline: 'none',
      }}
    />
  );
}
