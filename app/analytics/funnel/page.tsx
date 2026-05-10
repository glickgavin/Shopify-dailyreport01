export const dynamic = 'force-dynamic';

import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import { unstable_cache } from 'next/cache';
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

interface FunnelRpcRow {
  step_index: number;
  step_label: string;
  users: number;
  conversion_from_prev: number | null;
  conversion_from_start: number | null;
}

const getFunnels = unstable_cache(
  async () => supabaseAdmin
    .from('analytics_funnels')
    .select('id,name,description,steps')
    .order('created_at', { ascending: false }),
  ['analytics_funnels_list'],
  { revalidate: 60, tags: ['analytics_funnels_list'] },
);

export default async function FunnelBuilderPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const funnelId = sp.funnel_id ? parseInt(sp.funnel_id) : null;

  const { data: savedFunnels, error: funnelsError } = await getFunnels();

  const funnels = (savedFunnels ?? []) as FunnelRow[];
  const activeFunnel = funnelId ? funnels.find(f => f.id === funnelId) : funnels[0];
  const steps: FunnelStep[] = Array.isArray(activeFunnel?.steps) ? activeFunnel.steps as FunnelStep[] : [];

  const predicates = steps.map(s => ({ kind: 'event_type', op: 'is', value: s.event_type }));

  let funnelRows: FunnelRpcRow[] = [];
  let error: string | null = null;

  if (predicates.length > 0) {
    try {
      const { data, error: rpcErr } = await supabaseAdmin.rpc('analytics_funnel', {
        p_steps: predicates,
        p_from: startDate + 'T00:00:00.000Z',
        p_to: endDate + 'T23:59:59.999Z',
        p_window_hours: 24,
      });
      if (rpcErr) throw rpcErr;
      funnelRows = (data ?? []) as FunnelRpcRow[];
    } catch (e) {
      error = String(e);
    }
  }

  const maxUsers = funnelRows[0]?.users ?? 1;

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
        devices={[]}
        excludePreview={false}
      />

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginTop: '1.5rem' }}>
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>Saved Funnels</div>
            {funnelsError ? (
              <p style={{ padding: '1rem', color: '#991b1b', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                Error loading funnels: {funnelsError.message}
              </p>
            ) : funnels.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>
                None yet. Create one below.
              </p>
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

          <div style={{ marginTop: 12 }}>
            <FunnelEditor currentSteps={steps} funnelId={activeFunnel?.id} funnelName={activeFunnel?.name} />
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem' }}>
          {!activeFunnel ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Select or create a funnel to see results.</p>
          ) : steps.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>This funnel has no steps defined yet.</p>
          ) : (
            <>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1.25rem' }}>{activeFunnel.name}</div>
              {funnelRows.map((row, i) => {
                const step = steps[i];
                const pct = maxUsers > 0 ? Math.round((row.users / maxUsers) * 100) : 0;
                return (
                  <div key={i} style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                        <span style={{ color: 'var(--muted)', marginRight: 6 }}>{i + 1}.</span>
                        {step?.label ?? step?.event_type ?? row.step_label}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                        {row.users.toLocaleString()}
                        {row.conversion_from_prev !== null && (
                          <span style={{ color: (row.conversion_from_prev ?? 0) > 50 ? '#1D9E75' : '#e53e3e', marginLeft: 8, fontSize: '0.78rem' }}>
                            {row.conversion_from_prev}% step conv.
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
              {funnelRows.length > 1 && funnelRows[0]?.users > 0 && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac', fontSize: '0.82rem', color: '#166534' }}>
                  Overall conversion: {funnelRows[funnelRows.length - 1]?.conversion_from_start ?? 0}%
                  ({(funnelRows[funnelRows.length - 1]?.users ?? 0).toLocaleString()} of {funnelRows[0].users.toLocaleString()} completed all steps)
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
