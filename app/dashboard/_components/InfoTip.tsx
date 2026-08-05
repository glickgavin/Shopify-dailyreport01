'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Small ⓘ toggle that reveals how a dashboard block is calculated.
// The popover renders in a document.body portal at a fixed position so it
// is never clipped by card containers with overflow:hidden.
const POP_WIDTH = 280;

export default function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(
        Math.max(8, r.left + r.width / 2 - POP_WIDTH / 2),
        window.innerWidth - POP_WIDTH - 8,
      );
      setPos({ top: r.bottom + 8, left });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="How is this calculated?"
        onClick={toggle}
        style={{
          width: 15, height: 15, borderRadius: '50%',
          border: '1px solid currentColor', background: 'transparent',
          color: 'inherit', opacity: open ? 0.9 : 0.45, cursor: 'pointer',
          fontSize: '0.6rem', lineHeight: 1, fontFamily: 'var(--font-mono)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, marginLeft: 6, verticalAlign: 'middle',
        }}
      >
        i
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
            width: POP_WIDTH, padding: '0.65rem 0.8rem',
            background: '#1a1a2e', color: 'rgba(255,255,255,0.92)',
            borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
            fontSize: '0.74rem', lineHeight: 1.55, fontWeight: 400,
            fontFamily: 'var(--font-sans, inherit)', textTransform: 'none',
            letterSpacing: 'normal', whiteSpace: 'pre-line', textAlign: 'left',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
