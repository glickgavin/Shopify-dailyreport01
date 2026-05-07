export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import { matchesAllPredicates } from '@/lib/analytics/predicates';
import type { Predicate } from '@/lib/analytics/predicates';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import BehaviorEditor from './BehaviorEditor';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    behavior_id?: string; compare_id?: string;
  }>;
}

interface BehaviorRow { id: number; name: string; description: string | null; predicates: unknown }

export default async function BehaviorLabPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const behaviorId = sp.behavior_id ? parseInt(sp.behavior_id) : null;
  const compareId = sp.compare_id ? parseInt(sp.compare_id) : null;

  const { data: savedBehaviors } = await supabaseAdmin
    .from('analytics_behaviors')
    .select('id,name,description,predicates')
    .order('created_at', { ascending: false });

  const behaviors = (savedBehaviors ?? []) as BehaviorRow[];
  const activeBehavior = behaviorId ? behaviors.find(b => b.id === behaviorId) : behaviors[0];
  const compareBehavior = compareId ? behaviors.find(b => b.id === compareId) : null;
  const activePredicates: Predicate[] = Array.isArray(activeBehavior?.predicates) ? activeBehavior.predicates as Predicate[] : [];
  const comparePredicates: Predicate[] = Array.isArray(compareBehavior?.predicates) ? compareBehavior.predicates as Predicate[] : [];

  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  if (activePredicates.length > 0) {
    try {
      events = await fetchEventsDirect({ startDate, endDate, limit: 5000 });
    } catch (e) {
      error = String(e);
    }
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  // Count matching sessions for a set of predicates
  function countMatchingSessions(predicates: Predicate[]): { sessions: number; events: number } {
    if (!predicates.length) return { sessions: 0, events: 0 };
    const matchingEvents = filtered.filter(e => matchesAllPredicates(e, predicates));
    const sessions = new Set(matchingEvents.map(e => e.session_id).filter(Boolean)).size;
    return { sessions, events: matchingEvents.length };
  }

  const activeStats = countMatchingSessions(activePredicates);
  const compareStats = comparePredicates.length ? countMatchingSessions(comparePredicates) : null;
  const totalSessions = new Set(filtered.map(e => e.session_id).filter(Boolean)).size;

  // Significance test (z-test for proportions)
  function zTest(a: number, b: number, nA: number, nB: number): { z: number; significant: boolean } | null {
    if (!nA || !nB) return null;
    const pA = a / nA, pB = b / nB;
    const pPool = (a + b) / (nA + nB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
    if (se === 0) return null;
    const z = Math.abs(pA - pB) / se;
    return { z, significant: z > 1.96 };
  }

  const sigTest = compareStats
    ? zTest(activeStats.sessions, compareStats.sessions, totalSessions, totalSessions)
    : null;

  return (
    <div style={{ padding: '2rem', maxWidth: 1000 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Behavior Lab</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label}</p>
      </div>

      <AnalyticsFilterBar
        preset={preset as Preset}
        from={sp.from}
        to={sp.to}
        devices={devices}
        excludePreview={excludePreview}
      />

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginTop: '1.5rem' }}>
        {/* Saved behaviors */}
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>Saved Behaviors</div>
            {behaviors.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>None yet.</p>
            ) : (
              behaviors.map(b => (
                <a
                  key={b.id}
                  href={`/analytics/behaviors?preset=${sp.preset ?? '7d'}&behavior_id=${b.id}${compareId ? `&compare_id=${compareId}` : ''}`}
                  style={{
                    display: 'block', padding: '0.65rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    textDecoration: 'none',
                    background: activeBehavior?.id === b.id ? 'rgba(26,26,46,0.05)' : 'transparent',
                    borderLeft: activeBehavior?.id === b.id ? '3px solid #1a1a2e' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: activeBehavior?.id === b.id ? 600 : 400, color: 'var(--text)' }}>{b.name}</div>
                  {b.description && <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{b.description}</div>}
                </a>
              ))
            )}
          </div>
          <BehaviorEditor
            currentPredicates={activePredicates}
            behaviorId={activeBehavior?.id}
            behaviorName={activeBehavior?.name}
          />
        </div>

        {/* Results */}
        <div>
          {/* Comparison selector */}
          {behaviors.length > 1 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', marginBottom: 12 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>Compare against:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a
                  href={`/analytics/behaviors?preset=${sp.preset ?? '7d'}&behavior_id=${behaviorId ?? ''}`}
                  style={{ padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.78rem', textDecoration: 'none', background: !compareId ? '#1a1a2e' : 'var(--surface)', color: !compareId ? '#fff' : 'var(--muted)', border: `1px solid ${!compareId ? '#1a1a2e' : 'var(--border)'}` }}
                >None</a>
                {behaviors.filter(b => b.id !== activeBehavior?.id).map(b => (
                  <a
                    key={b.id}
                    href={`/analytics/behaviors?preset=${sp.preset ?? '7d'}&behavior_id=${behaviorId ?? ''}&compare_id=${b.id}`}
                    style={{ padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.78rem', textDecoration: 'none', background: compareId === b.id ? '#1a1a2e' : 'var(--surface)', color: compareId === b.id ? '#fff' : 'var(--muted)', border: `1px solid ${compareId === b.id ? '#1a1a2e' : 'var(--border)'}` }}
                  >{b.name}</a>
                ))}
              </div>
            </div>
          )}

          {/* Stats */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem' }}>
            {!activeBehavior ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Select or create a behavior.</p>
            ) : (
              <>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.25rem' }}>{activeBehavior.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: compareStats ? '1fr 1fr' : '1fr', gap: 12, marginBottom: '1.25rem' }}>
                  {[
                    { label: activeBehavior.name, stats: activeStats, color: '#1a1a2e' },
                    ...(compareStats && compareBehavior ? [{ label: compareBehavior.name, stats: compareStats, color: '#6366f1' }] : []),
                  ].map(({ label: lbl, stats, color }) => (
                    <div key={lbl} style={{ padding: '1rem', borderRadius: 8, border: `2px solid ${color}20`, background: `${color}08` }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>{lbl}</div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>
                        {stats.sessions.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                        sessions · {totalSessions > 0 ? `${Math.round((stats.sessions / totalSessions) * 100)}% of total` : '—'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                        {stats.events.toLocaleString()} matching events
                      </div>
                    </div>
                  ))}
                </div>

                {sigTest && (
                  <div style={{
                    padding: '0.75rem', borderRadius: 8,
                    background: sigTest.significant ? '#f0fdf4' : '#fef9c3',
                    border: `1px solid ${sigTest.significant ? '#86efac' : '#fcd34d'}`,
                    fontSize: '0.82rem',
                    color: sigTest.significant ? '#166534' : '#713f12',
                  }}>
                    z = {sigTest.z.toFixed(2)} · {sigTest.significant
                      ? 'Statistically significant difference (p < 0.05)'
                      : 'No significant difference detected'}
                  </div>
                )}

                {activePredicates.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>Predicates:</div>
                    {activePredicates.map((p, i) => (
                      <div key={i} style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 2 }}>
                        {p.kind} {p.key ? `[${p.key}]` : ''} {p.op} {p.value ?? ''}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
