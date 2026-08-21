'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Responsive navigation: a fixed left rail on desktop (≥1024px) and a sticky
// top bar with a slide-in drawer on smaller screens. Detection is pure CSS
// media queries, so the same markup adapts automatically to the device.

const NAV = [
  {
    group: 'Business',
    items: [
      { href: '/dashboard',          label: 'Daily Dashboard', exact: true },
      { href: '/dashboard/range',    label: 'Range Report' },
      { href: '/dashboard/aov',      label: 'AOV' },
      { href: '/dashboard/ads',      label: 'Ad Report' },
      { href: '/dashboard/meta-ads', label: 'Meta Ads' },
      { href: '/dashboard/history',    label: 'History' },
      { href: '/dashboard/membership', label: 'Membership' },
    ],
  },
  {
    group: 'Analytics',
    items: [
      { href: '/analytics',              label: 'Overview',        exact: true },
      { href: '/analytics/realtime',     label: 'Real-time' },
      { href: '/analytics/events',       label: 'Event Explorer' },
      { href: '/analytics/journey',      label: 'User Journey' },
      { href: '/analytics/funnel',       label: 'Funnel Builder' },
      { href: '/analytics/behaviors',    label: 'Behavior Lab' },
      { href: '/analytics/paths',        label: 'Path Analysis' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { href: '/dashboard/admin',                  label: 'Admin Dashboard', exact: true },
      { href: '/dashboard/admin/mug-fulfillment',  label: 'Mug Fulfillment' },
      { href: '/dashboard/admin/paypal-subscriptions', label: 'PayPal Subscriptions' },
      { href: '/dashboard/admin/stripe-credits',       label: 'Stripe Credits' },
      { href: '/dashboard/admin/product-cleanup',      label: 'Product Cleanup' },
      { href: '/dashboard/admin/price-list',           label: 'Price List' },
      { href: '/systems',                          label: 'Systems' },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { href: '/configuration/events',     label: 'Events' },
      { href: '/configuration/paths',      label: 'Paths' },
      { href: '/configuration/properties', label: 'Properties' },
      { href: '/configuration/unmapped',   label: 'Unmapped' },
      { href: '/configuration/sync',       label: 'Sync Status' },
    ],
  },
];

function Brand() {
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', textTransform: 'uppercase' }}>
      Storyboards
    </span>
  );
}

export default function AnalyticsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever navigation happens.
  useEffect(() => { setOpen(false); }, [pathname]);
  // Prevent background scroll while the drawer is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  const navGroups = (
    <>
      {NAV.map(section => (
        <div key={section.group} style={{ marginBottom: '0.25rem' }}>
          <div style={{
            padding: '0.5rem 1rem 0.25rem',
            fontSize: '0.67rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--muted)',
            textTransform: 'uppercase',
          }}>
            {section.group}
          </div>
          {section.items.map(item => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  textDecoration: 'none',
                  color: active ? 'var(--text)' : 'var(--muted)',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'var(--accent-100)' : 'transparent',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );

  return (
    <>
      <style>{`
        .sb-desktop { display: block; }
        .sb-topbar  { display: none; }
        @media (max-width: 1023px) {
          .sb-desktop { display: none; }
          .sb-topbar  { display: flex; }
        }
      `}</style>

      {/* ── Desktop rail ──────────────────────────────────────────────────── */}
      <nav className="sb-desktop" style={{
        width: 200,
        minHeight: '100vh',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '1.25rem 0',
        flexShrink: 0,
      }}>
        <Link href="/" style={{ display: 'block', padding: '0 1rem 1rem', textDecoration: 'none' }}>
          <Brand />
        </Link>
        {navGroups}
      </nav>

      {/* ── Mobile top bar ────────────────────────────────────────────────── */}
      <div className="sb-topbar" style={{
        position: 'sticky', top: 0, zIndex: 200,
        alignItems: 'center', gap: 12,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '10px 14px',
      }}>
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          style={{
            border: '1px solid var(--border)', background: 'var(--surface)',
            borderRadius: 10, padding: '6px 12px', fontSize: 18, lineHeight: 1, cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          ☰
        </button>
        <Link href="/" style={{ textDecoration: 'none' }}><Brand /></Link>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(29,33,31,0.45)' }}
        >
          <nav
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: 'min(280px, 82vw)',
              background: 'var(--surface)',
              overflowY: 'auto',
              padding: '0.75rem 0 2rem',
              boxShadow: '0 0 40px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.25rem 1rem 0.75rem' }}>
              <Link href="/" style={{ textDecoration: 'none' }}><Brand /></Link>
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--neutral-600)' }}
              >
                ✕
              </button>
            </div>
            {navGroups}
          </nav>
        </div>
      )}
    </>
  );
}
