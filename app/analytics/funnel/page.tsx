export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import FunnelEditor from './FunnelEditor';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    funnel_id?: string;
  }>;
}

interface FunnelStep {
  event_type: string;
  label?: string;
}

interface FunnelRow {
  id: number;
  name: string;
  description: string | null;
  steps: unknown;
}

export default async function FunnelBuilderPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const funnelId = sp.funnel_id ? parseInt(sp.funnel_id) : null;

  // Load saved funnels
  const { data: savedFunnels } = await supabaseAdmin
    .from('analytics_funnels')
    .select('id,name,description,steps')
    .order('created_at', { ascending: false });

  const funnels = (savedFunnels ?? []) as FunnelRow[];
  const activeFunnel = funnelId ? funnels.find(f => f.id === funnelId) : funnels[0];
  const steps: FunnelStep[] = Array.isArray(activeFunnel?.steps) ? activeFunnel.steps as FunnelStep[] : [];

  // Fetch events if we have a funnel with steps
  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  if (steps.length > 0) {
    try {
      events = await fetchEventsDirect({ startDate, endDate, limit: 5000 });
    } catch (e) {
      error = String(e);
    }
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  // Compute funnel: sessions that completed each step in order
  function computeFunnel(allEvents: typeof filtered, funnelSteps: FunnelStep[]): number[] {
    if (!funnelSteps.length) return [];
    // Group by session
    const sessionMap = new Map<string, typeof filtered>();
    for (const e of allEvents) {
      const sid = e.session_id ?? 'anon';
      const arr = sessionMap.get(sid) ?? [];
      arr.push(e);
      sessionMap.set(sid, arr);
    }

    const counts = new Array(funnelSteps.length).fill(0);
    for (const [, sessEvents] of Array.from(sessionMap)) {
      const sorted = sessEvents.slice().sort((a: typeof sessEvents[0], b: typeof sessEvents[0]) =>
        new Date(a.created_at ?? a.timestamp ?? 0).getTime() - new Date(b.created_at ?? b.timestamp ?? 0).getTime()
      );
      let stepIdx = 0;
      for (const e of sorted) {
        if (stepIdx >= funnelSteps.length) break;
        if (e.event_type === funnelSteps[stepIdx].event_type) {
          counts[stepIdx]++;
          stepIdx++;
        }
      }
    }
    return counts;
  }

  const counts = computeFunnel(filtered, steps);
  const maxCount = counts[0] ?? 1;

  return (
    <div style={{ padding: '2rem', maxWidth: 1000 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Funnel Builder</h1>
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
        {/* Saved funnels */}
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>Saved Funnels</div>
            {funnels.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>None yet. Create one below.</p>
            ) : (
              funnels.map(f => (
                <a
                  key={f.id}
                  href={`/analytics/funnel?preset=${sp.preset ?? '7d'}&funnel_id=${f.id}`}
                  style={{
                    display: 'block', padding: '0.65rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    textDecoration: 'none',
                    background: activeFunnel?.id === f.id ? 'rgba(26,26,46,0.05)' : 'transparent',
                    borderLeft: activeFunnel?.id === f.id ? '3px solid #1a1a2e' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: activeFunnel?.id === f.id ? 600 : 400, color: 'var(--text)' }}>{f.name}</div>
                  {f.description && <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{f.description}</div>}
                </a>
              ))
            )}
          </div>

          {/* Create / edit funnel */}
          <div style={{ marginTop: 12 }}>
            <FunnelEditor currentSteps={steps} funnelId={activeFunnel?.id} funnelName={activeFunnel?.name} />
          </div>
        </div>

        {/* Funnel visualization */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem' }}>
          {!activeFunnel ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Select or create a funnel to see results.</p>
          ) : steps.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>This funnel has no steps defined yet.</p>
          ) : (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.25rem' }}>{activeFunnel.name}</div>
              {steps.map((step, i) => {
                const count = counts[i] ?? 0;
                const pct = i === 0 ? 100 : maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
                const convPct = i === 0 ? null : (counts[i - 1] ?? 0) > 0 ? Math.round(((count) / (counts[i - 1] ?? 1)) * 100) : 0;
                return (
                  <div key={i} style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                        <span style={{ color: 'var(--muted)', marginRight: 6 }}>{i + 1}.</span>
                        {step.label ?? step.event_type}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                        {count.toLocaleString()}
                        {convPct !== null && (
                          <span style={{ color: convPct > 50 ? '#1D9E75' : '#e53e3e', marginLeft: 8, fontSize: '0.78rem' }}>
                            {convPct}% step conv.
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 28, borderRadius: 6, background: '#e2e8f0', overflow: 'hidden' }}>
                      <div style={{
                        height: 28, borderRadius: 6,
                        background: `hsl(${220 - i * 15}, 60%, ${35 + i * 5}%)`,
                        width: `${pct}%`,
                        transition: 'width 0.3s',
                        display: 'flex', alignItems: 'center', paddingLeft: 8,
                      }}>
                        <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 600 }}>{pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {counts[0] > 0 && steps.length > 1 && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac', fontSize: '0.82rem', color: '#166534' }}>
                  Overall conversion: {Math.round(((counts[counts.length - 1] ?? 0) / counts[0]) * 100)}%
                  ({(counts[counts.length - 1] ?? 0).toLocaleString()} of {counts[0].toLocaleString()} completed all steps)
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
