export const dynamic = 'force-dynamic';

import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
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

interface BehaviorRpcResult {
  matched_sessions: number;
  matched_events: number;
  events_per_session: number;
  by_device: { key: string; sessions: number }[] | null;
  by_source: { key: string; sessions: number }[] | null;
}

function zTest(a: number, b: number, nTotal: number): { z: number; significant: boolean } | null {
  if (!nTotal) return null;
  const pA = a / nTotal, pB = b / nTotal;
  const pPool = (a + b) / (2 * nTotal);
  const se = Math.sqrt(pPool * (1 - pPool) * (2 / nTotal));
  if (se === 0) return null;
  const z = Math.abs(pA - pB) / se;
  return { z, significant: z > 1.96 };
}

async function runBehaviorRpc(
  predicates: Predicate[],
  startDate: string,
  endDate: string
): Promise<BehaviorRpcResult | null> {
  if (!predicates.length) return null;
  const { data, error } = await supabaseAdmin.rpc('analytics_behavior', {
    p_conditions: predicates as unknown as import('@/lib/types/database').Json,
    p_from: startDate + 'T00:00:00.000Z',
    p_to: endDate + 'T23:59:59.999Z',
  });
  if (error) throw error;
  const rows = data as BehaviorRpcResult[] | null;
  return rows?.[0] ?? null;
}

export default async function BehaviorLabPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
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

  let activeStats: BehaviorRpcResult | null = null;
  let compareStats: BehaviorRpcResult | null = null;
  let totalSessions = 0;
  let error: string | null = null;

  try {
    [activeStats, compareStats] = await Promise.all([
      runBehaviorRpc(activePredicates, startDate, endDate),
      comparePredicates.length ? runBehaviorRpc(comparePredicates, startDate, endDate) : Promise.resolve(null),
    ]);

    // Get total sessions for percentage calculation
    if (activeStats || compareStats) {
      const { data: tot } = await supabaseAdmin
        .from('analytics_events_mirror')
        .select('session_id')
        .gte('created_at', startDate)
        .lte('created_at', endDate + 'T23:59:59.999Z')
        .not('session_id', 'is', null);
      totalSessions = new Set((tot ?? []).map((r: { session_id: string }) => r.session_id)).size;
    }
  } catch (e) {
    error = String(e);
  }

  const sigTest = activeStats && compareStats
    ? zTest(activeStats.matched_sessions, compareStats.matched_sessions, totalSessions)
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
        devices={[]}
        excludePreview={false}
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
                        {(stats?.matched_sessions ?? 0).toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                        sessions · {totalSessions > 0 ? `${Math.round(((stats?.matched_sessions ?? 0) / totalSessions) * 100)}% of total` : '—'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                        {(stats?.matched_events ?? 0).toLocaleString()} matching events
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
