'use client';

import { useEffect, useState } from 'react';
import { SYSTEMS, SystemStatus } from '@/lib/systems';

interface HealthResult {
  id: string;
  status: 'operational' | 'degraded';
  httpStatus: number | null;
  checkedAt: string;
}

const DOT_COLOR: Record<SystemStatus, string> = {
  operational: 'var(--nc-green)',
  degraded:    '#e05c5c',
  building:    '#c8a88a',
};

const DOT_LABEL: Record<SystemStatus, string> = {
  operational: 'Operational',
  degraded:    'Degraded',
  building:    'Building',
};

const categories = Array.from(new Set(SYSTEMS.map(s => s.category)));
const multiCategory = categories.length > 1;

export default function SystemsPage() {
  const [liveStatus, setLiveStatus] = useState<Record<string, SystemStatus>>({});
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then((data: { results: HealthResult[] }) => {
        const map: Record<string, SystemStatus> = {};
        for (const r of data.results) {
          map[r.id] = r.status;
        }
        setLiveStatus(map);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  function getStatus(id: string, baseStatus: SystemStatus): SystemStatus {
    if (baseStatus === 'building') return 'building';
    if (checking) return baseStatus;
    return liveStatus[id] ?? baseStatus;
  }

  return (
    <main style={{ background: 'var(--bg)', minHeight: '100vh', padding: '3rem 2rem' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.25rem', marginBottom: '0.5rem' }}>
          Systems
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}> ·</em>
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: '3rem', fontSize: '0.95rem' }}>
          {checking ? 'Checking…' : 'Live status for all connected systems'}
        </p>

        {categories.map(cat => (
          <section key={cat} style={{ marginBottom: '2.5rem' }}>
            {multiCategory && (
              <div style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                marginBottom: '1rem',
              }}>
                {cat}
              </div>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1rem',
            }}>
              {SYSTEMS.filter(s => s.category === cat).map(sys => {
                const status = getStatus(sys.id, sys.status);
                return (
                  <div
                    key={sys.id}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '1.25rem 1.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--accent)',
                      }}>
                        {sys.category}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                        <span style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: checking ? 'var(--muted)' : DOT_COLOR[status],
                          display: 'inline-block',
                          flexShrink: 0,
                        }} />
                        {checking ? 'Checking…' : DOT_LABEL[status]}
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)' }}>
                      {sys.name}
                    </div>

                    <div style={{ fontSize: '0.875rem', color: 'var(--muted)', flex: 1 }}>
                      {sys.description}
                    </div>

                    <a
                      href={sys.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--text)',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                      }}
                    >
                      Open →
                    </a>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
