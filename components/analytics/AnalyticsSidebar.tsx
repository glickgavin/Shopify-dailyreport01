'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  {
    group: 'Business',
    items: [
      { href: '/dashboard', label: 'Daily Dashboard' },
      { href: '/dashboard/range', label: 'Range Report' },
      { href: '/history', label: 'History' },
    ],
  },
  {
    group: 'Analytics',
    items: [
      { href: '/analytics', label: 'Overview' },
      { href: '/analytics/realtime', label: 'Real-time' },
      { href: '/analytics/events', label: 'Event Explorer' },
      { href: '/analytics/journey', label: 'User Journey' },
      { href: '/analytics/funnel', label: 'Funnel Builder' },
      { href: '/analytics/behaviors', label: 'Behavior Lab' },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { href: '/configuration/events', label: 'Events' },
      { href: '/configuration/paths', label: 'Paths' },
      { href: '/configuration/properties', label: 'Properties' },
      { href: '/configuration/unmapped', label: 'Unmapped' },
    ],
  },
];

export default function AnalyticsSidebar() {
  const pathname = usePathname();

  return (
    <nav style={{
      width: 200,
      minHeight: '100vh',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      padding: '1.25rem 0',
      flexShrink: 0,
    }}>
      <Link href="/" style={{ display: 'block', padding: '0 1rem 1rem', textDecoration: 'none' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', textTransform: 'uppercase' }}>
          Storyboards
        </span>
      </Link>
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
            const active = pathname === item.href || (item.href !== '/analytics' && item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '0.45rem 1rem',
                  fontSize: '0.875rem',
                  textDecoration: 'none',
                  borderRadius: 0,
                  color: active ? 'var(--text)' : 'var(--muted)',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'rgba(0,0,0,0.04)' : 'transparent',
                  borderLeft: active ? '3px solid #1a1a2e' : '3px solid transparent',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
