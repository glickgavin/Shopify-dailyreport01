'use client';

import { useEffect, useRef, useState } from 'react';

// Small ⓘ toggle that reveals how a dashboard block is calculated.
// Kept as its own client component so the server-rendered cards stay static.
export default function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', marginLeft: 6, verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label="How is this calculated?"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        style={{
          width: 15, height: 15, borderRadius: '50%',
          border: '1px solid currentColor', background: 'transparent',
          color: 'inherit', opacity: open ? 0.9 : 0.45, cursor: 'pointer',
          fontSize: '0.6rem', lineHeight: 1, fontFamily: 'var(--font-mono)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}
      >
        i
      </button>
      {open && (
        <span style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)', zIndex: 100,
          width: 260, padding: '0.6rem 0.75rem',
          background: '#1a1a2e', color: 'rgba(255,255,255,0.92)',
          borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          fontSize: '0.72rem', lineHeight: 1.55, fontWeight: 400,
          fontFamily: 'var(--font-sans, inherit)', textTransform: 'none',
          letterSpacing: 'normal', whiteSpace: 'pre-line', textAlign: 'left',
        }}>
          {text}
        </span>
      )}
    </span>
  );
}
