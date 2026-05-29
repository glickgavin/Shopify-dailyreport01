export const dynamic = 'force-dynamic';

import { resolveDateRange, dateToUTCRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import { unstable_cache } from 'next/cache';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import type { Predicate } from '@/lib/analytics/predicates';
import FunnelEditor from './FunnelEditor';
import AttributionToggles from './AttributionToggles';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    funnel_id?: string; new?: string;
    compare_funnel_id?: string;   // Mode A: two funnels, same dates
    compare_from?: string;        // Mode B: same funnel, different dates
    compare_to?: string;
    email_stitch?: string; apply_window?: string;
  }>;
}

export interface FunnelStep {
  label: string;
  predicates: Predicate[];
  logic?: 'AND' | 'OR';
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
  total_events: number;
  total_revenue: number;
  conversion_from_prev: number | null;
  conversion_from_start: number | null;
}

export interface AvailableDefinition {
  label: string;
  predicates: Predicate[];
}

const getFunnels = unstable_cache(
  async () => supabaseAdmin
    .from('analytics_funnels')
    .select('id,name,description,steps')
    .order('created_at', { ascending: false }),
  ['analytics_funnels_list'],
  { revalidate: 60, tags: ['analytics_funnels_list'] },
);

function normalizeSteps(raw: unknown[]): FunnelStep[] {
  return raw.map(s => {
    const step = s as Record<string, unknown>;
    if ('predicates' in step && Array.isArray(step.predicates)) {
      return {
        label: (step.label as string) ?? '',
        predicates: step.predicates as Predicate[],
        logic: (step.logic as 'AND' | 'OR' | undefined) ?? 'AND',
      };
    }
    // backward-compat: old format { event_type, label? }
    const et = (step.event_type as string) ?? '';
    return {
      label: (step.label as string) ?? et,
      predicates: [{ kind: 'event_type' as const, op: 'is' as const, value: et }],
      logic: 'AND' as const,
    };
  });
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDateRange(from: string, to: string): string {
  const fmt = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

async function runFunnel(
  steps: FunnelStep[],
  startDate: string,
  endDate: string,
  opts: { emailStitch: boolean; applyWindow: boolean } = { emailStitch: true, applyWindow: true },
): Promise<{ rows: FunnelRpcRow[]; error: string | null }> {
  if (steps.length === 0) return { rows: [], error: null };
  try {
    const { data, error: rpcErr } = await supabaseAdmin.rpc('analytics_funnel', {
      p_steps: steps as unknown as import('@/lib/types/database').Json,
      p_from: dateToUTCRange(startDate, endDate).from,
      p_to:   dateToUTCRange(startDate, endDate).to,
      p_window_hours: opts.applyWindow ? 24 : null,
      p_stitch_by_email: opts.emailStitch,
    } as unknown as Parameters<typeof supabaseAdmin.rpc<'analytics_funnel'>>[1]);
    if (rpcErr) {
      const msg = rpcErr.message + (rpcErr.details ? ' — ' + rpcErr.details : '') + (rpcErr.hint ? ' (hint: ' + rpcErr.hint + ')' : '');
      return { rows: [], error: msg };
    }
    return { rows: (data ?? []) as FunnelRpcRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : JSON.stringify(e) };
  }
}

function FunnelBars({ rows, steps, title, dateLabel }: {
  rows: FunnelRpcRow[];
  steps: FunnelStep[];
  title: string;
  dateLabel: string;
}) {
  const maxUsers = rows[0]?.users ?? 1;
  return (
    <div>
      <div style={{ marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{title}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{dateLabel}</div>
      </div>
      {rows.map((row, i) => {
        const step = steps[i];
        const pct = maxUsers > 0 ? Math.round((row.users / maxUsers) * 100) : 0;
        return (
          <div key={i} style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                <span style={{ color: 'var(--muted)', marginRight: 6 }}>{i + 1}.</span>
                {step?.label || row.step_label}
              </span>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                <div style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span title="Unique sessions">
                    <span style={{ color: 'var(--muted)', fontSize: '0.7rem', marginRight: 3 }}>uniq</span>
                    {row.users.toLocaleString()}
                  </span>
                  <span title="Total event occurrences" style={{ color: 'var(--muted)' }}>
                    <span style={{ fontSize: '0.7rem', marginRight: 3 }}>total</span>
                    {row.total_events.toLocaleString()}
                  </span>
                  {row.total_revenue > 0 && (
                    <span title="Total revenue for matching events" style={{ color: '#1D9E75', fontWeight: 600 }}>
                      ${row.total_revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                  {row.conversion_from_prev !== null && (
                    <span style={{ color: (row.conversion_from_prev ?? 0) > 50 ? '#1D9E75' : '#e53e3e', fontSize: '0.75rem' }}>
                      {row.conversion_from_prev}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ height: 26, borderRadius: 6, background: '#e2e8f0', overflow: 'hidden' }}>
              <div style={{
                height: 26, borderRadius: 6,
                background: `hsl(${220 - i * 15}, 60%, ${35 + i * 5}%)`,
                width: `${pct}%`,
                transition: 'width 0.3s',
                display: 'flex', alignItems: 'center', paddingLeft: 8,
              }}>
                <span style={{ color: '#fff', fontSize: '0.72rem', fontWeight: 600 }}>{pct}%</span>
              </div>
            </div>
            {step?.predicates && step.predicates.length >= 1 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {step.predicates.map((p, pi) => (
                  <span key={pi}>
                    {pi > 0 && <span style={{ marginRight: 4, marginLeft: 4, color: '#888', fontStyle: 'italic' }}>{step.logic ?? 'AND'}</span>}
                    <span style={{ marginRight: 4 }}>{p.kind}{p.key ? `[${p.key}]` : ''} {p.op} {p.value ?? ''}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {rows.length > 1 && rows[0]?.users > 0 && (
        <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac', fontSize: '0.8rem', color: '#166534' }}>
          Overall: {rows[rows.length - 1]?.conversion_from_start ?? 0}%
          · {(rows[rows.length - 1]?.users ?? 0).toLocaleString()} of {rows[0].users.toLocaleString()} completed all steps
        </div>
      )}
    </div>
  );
}

export default async function FunnelBuilderPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const funnelId = sp.funnel_id ? parseInt(sp.funnel_id) : null;
  const compareFunnelId = sp.compare_funnel_id ? parseInt(sp.compare_funnel_id) : null;

  // Attribution toggles — both default ON.
  // URL only carries the param when the toggle is explicitly OFF.
  const emailStitch = sp.email_stitch !== 'false';
  const applyWindow = sp.apply_window !== 'false';

  // Comparison date range (Mode B)
  const compareFrom = sp.compare_from ?? '';
  const compareTo = sp.compare_to ?? '';
  const hasModeB = !!(compareFrom && compareTo);

  // Compute "prior period" shortcut values for links
  const durationDays = Math.round((new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime()) / 86400000) + 1;
  const priorTo = offsetDate(startDate, -1);
  const priorFrom = offsetDate(priorTo, -(durationDays - 1));
  const prior7To = offsetDate(startDate, -1);
  const prior7From = offsetDate(prior7To, -6);
  const prior30To = offsetDate(startDate, -1);
  const prior30From = offsetDate(prior30To, -29);

  const [{ data: savedFunnels, error: funnelsError }, { data: eventDefs }] = await Promise.all([
    getFunnels(),
    supabaseAdmin
      .from('analytics_event_definitions')
      .select('event_type,display_name,predicates')
      .order('display_name'),
  ]);

  const funnels = (savedFunnels ?? []) as FunnelRow[];
  const isNew = sp.new === '1';
  const activeFunnel = isNew ? undefined : (funnelId ? funnels.find(f => f.id === funnelId) : funnels[0]);
  const steps: FunnelStep[] = Array.isArray(activeFunnel?.steps) ? normalizeSteps(activeFunnel.steps as unknown[]) : [];

  // Mode A: second funnel
  const compareFunnel = compareFunnelId ? funnels.find(f => f.id === compareFunnelId) : undefined;
  const compareSteps: FunnelStep[] = Array.isArray(compareFunnel?.steps) ? normalizeSteps(compareFunnel!.steps as unknown[]) : [];

  // Build available definitions for the step picker
  const configuredDefs: AvailableDefinition[] = (eventDefs ?? []).map(d => ({
    label: d.display_name,
    predicates: Array.isArray(d.predicates) && (d.predicates as unknown[]).length > 0
      ? d.predicates as unknown as Predicate[]
      : [{ kind: 'event_type' as const, op: 'is' as const, value: d.event_type }],
  }));

  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: mirrorNames } = await supabaseAdmin
    .from('analytics_events_mirror')
    .select('event_name')
    .gte('created_at', cutoff);

  const configuredEventTypes = new Set((eventDefs ?? []).map(d => d.event_type));
  const rawNames = Array.from(new Set((mirrorNames ?? []).map((r: { event_name: string }) => r.event_name)))
    .filter(n => !configuredEventTypes.has(n))
    .sort();

  const rawDefs: AvailableDefinition[] = rawNames.map(n => ({
    label: n,
    predicates: [{ kind: 'event_type' as const, op: 'is' as const, value: n }],
  }));

  const availableDefinitions: AvailableDefinition[] = [...configuredDefs, ...rawDefs];

  // Run primary funnel
  const attrOpts = { emailStitch, applyWindow };
  const { rows: funnelRows, error } = await runFunnel(steps, startDate, endDate, attrOpts);

  // Run comparison (Mode A or Mode B)
  let compareRows: FunnelRpcRow[] = [];
  let compareError: string | null = null;
  let compareDateLabel = '';
  const isModeA = !!(compareFunnel && compareSteps.length > 0);
  const isModeB = hasModeB && steps.length > 0;
  const isCompareActive = isModeA || isModeB;

  if (isModeA) {
    const res = await runFunnel(compareSteps, startDate, endDate, attrOpts);
    compareRows = res.rows;
    compareError = res.error;
    compareDateLabel = label;
  } else if (isModeB) {
    const res = await runFunnel(steps, compareFrom, compareTo, attrOpts);
    compareRows = res.rows;
    compareError = res.error;
    compareDateLabel = formatDateRange(compareFrom, compareTo);
  }

  // URL helpers
  const baseParams = new URLSearchParams();
  if (sp.preset) baseParams.set('preset', sp.preset);
  if (sp.from) baseParams.set('from', sp.from);
  if (sp.to) baseParams.set('to', sp.to);
  if (activeFunnel) baseParams.set('funnel_id', String(activeFunnel.id));
  if (compareFunnelId) baseParams.set('compare_funnel_id', String(compareFunnelId));
  if (compareFrom) baseParams.set('compare_from', compareFrom);
  if (compareTo) baseParams.set('compare_to', compareTo);

  function buildUrl(overrides: Record<string, string | null>) {
    const p = new URLSearchParams(baseParams);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) p.delete(k); else p.set(k, v);
    }
    return `/analytics/funnel?${p.toString()}`;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 1400 }}>
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

      <AttributionToggles emailStitch={emailStitch} applyWindow={applyWindow} />

      {/* Compare period bar (Mode B) */}
      {activeFunnel && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', flexShrink: 0 }}>Compare to:</span>
          {[
            { label: `Prior ${durationDays}d`, from: priorFrom, to: priorTo },
            { label: 'Prior 7d',  from: prior7From, to: prior7To },
            { label: 'Prior 30d', from: prior30From, to: prior30To },
          ].map(opt => {
            const isActive = compareFrom === opt.from && compareTo === opt.to;
            return (
              <a
                key={opt.label}
                href={isActive
                  ? buildUrl({ compare_from: null, compare_to: null, compare_funnel_id: null })
                  : buildUrl({ compare_from: opt.from, compare_to: opt.to, compare_funnel_id: null })}
                style={{
                  padding: '0.2rem 0.55rem', borderRadius: 5, fontSize: '0.73rem', textDecoration: 'none',
                  background: isActive ? '#1a1a2e' : 'var(--surface)',
                  color: isActive ? '#fff' : 'var(--muted)',
                  border: `1px solid ${isActive ? '#1a1a2e' : 'var(--border)'}`,
                }}
              >{opt.label}</a>
            );
          })}
          {isModeB && (
            <>
              <span style={{ fontSize: '0.73rem', color: 'var(--muted)', marginLeft: 4 }}>
                vs {formatDateRange(compareFrom, compareTo)}
              </span>
              <a
                href={buildUrl({ compare_from: null, compare_to: null })}
                style={{ fontSize: '0.73rem', color: '#e53e3e', textDecoration: 'none', marginLeft: 2 }}
              >× clear</a>
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, marginTop: '1.5rem' }}>
        {/* Left panel */}
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Saved Funnels</span>
              <a
                href={`/analytics/funnel?new=1&preset=${sp.preset ?? '7d'}${sp.from ? `&from=${sp.from}` : ''}${sp.to ? `&to=${sp.to}` : ''}`}
                style={{ fontSize: '0.78rem', color: '#1a1a2e', textDecoration: 'none', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', background: isNew ? 'rgba(26,26,46,0.08)' : 'transparent' }}
              >+ New</a>
            </div>
            {funnelsError ? (
              <p style={{ padding: '1rem', color: '#991b1b', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                Error: {funnelsError.message}
              </p>
            ) : funnels.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>None yet.</p>
            ) : (
              funnels.map(f => {
                const isActive = !isNew && activeFunnel?.id === f.id;
                const isCompare = compareFunnelId === f.id;
                return (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex', alignItems: 'center',
                      borderBottom: '1px solid var(--border)',
                      background: isActive ? 'rgba(26,26,46,0.05)' : 'transparent',
                      borderLeft: isActive ? '3px solid #1a1a2e' : '3px solid transparent',
                    }}
                  >
                    <a
                      href={buildUrl({ funnel_id: String(f.id), new: null, compare_funnel_id: compareFunnelId && compareFunnelId !== f.id ? String(compareFunnelId) : null })}
                      style={{ flex: 1, padding: '0.65rem 0.75rem', textDecoration: 'none' }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 400, color: 'var(--text)' }}>{f.name}</div>
                      {f.description && <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{f.description}</div>}
                    </a>
                    {/* "vs" toggle for Mode A — only show on non-active funnels */}
                    {!isActive && (
                      <a
                        href={isCompare
                          ? buildUrl({ compare_funnel_id: null, compare_from: null, compare_to: null })
                          : buildUrl({ compare_funnel_id: String(f.id), compare_from: null, compare_to: null })}
                        title={isCompare ? 'Remove comparison' : 'Compare with this funnel'}
                        style={{
                          padding: '0.25rem 0.5rem', marginRight: 6, borderRadius: 4,
                          fontSize: '0.68rem', fontWeight: 600, textDecoration: 'none',
                          background: isCompare ? '#1a1a2e' : 'var(--surface)',
                          color: isCompare ? '#fff' : 'var(--muted)',
                          border: `1px solid ${isCompare ? '#1a1a2e' : 'var(--border)'}`,
                          flexShrink: 0,
                        }}
                      >vs</a>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Compare funnel indicator (Mode A) */}
          {isModeA && compareFunnel && (
            <div style={{ marginTop: 6, padding: '0.4rem 0.75rem', background: 'rgba(26,26,46,0.05)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>Comparing vs <strong>{compareFunnel.name}</strong></span>
              <a
                href={buildUrl({ compare_funnel_id: null })}
                style={{ fontSize: '0.73rem', color: '#e53e3e', textDecoration: 'none' }}
              >× clear</a>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <FunnelEditor
              key={activeFunnel?.id ?? 'new'}
              currentSteps={steps}
              funnelId={activeFunnel?.id}
              funnelName={activeFunnel?.name}
              availableDefinitions={availableDefinitions}
            />
          </div>
        </div>

        {/* Results panel */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem' }}>
          {!activeFunnel ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Select or create a funnel to see results.</p>
          ) : steps.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>This funnel has no steps defined yet.</p>
          ) : isCompareActive ? (
            /* Side-by-side comparison */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <FunnelBars
                rows={funnelRows}
                steps={steps}
                title={isModeA ? activeFunnel.name : activeFunnel.name}
                dateLabel={isModeA ? label : label}
              />
              <div>
                {compareError ? (
                  <div style={{ color: '#991b1b', fontSize: '0.82rem' }}>{compareError}</div>
                ) : (
                  <FunnelBars
                    rows={compareRows}
                    steps={isModeA ? compareSteps : steps}
                    title={isModeA ? (compareFunnel?.name ?? '') : activeFunnel.name}
                    dateLabel={isModeA ? label : compareDateLabel}
                  />
                )}
              </div>
            </div>
          ) : (
            /* Single funnel view */
            <FunnelBars
              rows={funnelRows}
              steps={steps}
              title={activeFunnel.name}
              dateLabel={label}
            />
          )}
        </div>
      </div>
    </div>
  );
}
