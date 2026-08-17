'use client';

import { useState, type ReactNode } from 'react';

// Client tab shell for the range report. Sections are server-rendered and
// passed in as ReactNodes; this component only toggles which are visible, so
// switching tabs is instant (no refetch). "All" stacks every section with a
// small uppercase heading above each.

export interface TabSection {
  id: string;
  label: string;
  node: ReactNode;
}

export default function RangeTabs({
  title,
  sections,
  defaultTab = 'highlights',
}: {
  title: ReactNode;
  sections: TabSection[];
  defaultTab?: string;
}) {
  const [tab, setTab] = useState(defaultTab);
  const all = tab === 'all';
  const active = all ? sections : sections.filter(s => s.id === tab);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
        {title}
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[...sections.map(s => [s.id, s.label] as const), ['all', 'All'] as const].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`pill${tab === id ? ' pill--active' : ''}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      {active.map(s => (
        <section key={s.id}>
          {all && (
            <h6 style={{ margin: '40px 0 16px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, color: 'var(--neutral-600)' }}>
              {s.label}
            </h6>
          )}
          {s.node}
        </section>
      ))}
    </>
  );
}
