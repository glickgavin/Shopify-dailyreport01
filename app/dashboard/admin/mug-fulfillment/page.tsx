import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import Link from 'next/link';
import { Suspense } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import MugJobDrawer from './MugJobDrawer';
import MugSearchBox from './MugSearchBox';
import {
  fulfillOrder, submitGelato, cancelJob, resetToReceived, setTileOverrideUrl, scanMugReady,
} from './actions';
import MugReadyScanForm from './MugReadyScanForm';

export const revalidate = 0;

const ALL_STATES = [
  'received', 'generating', 'file_ready', 'draft_created',
  'submitted', 'passed', 'printed', 'shipped', 'delivered', 'failed',
] as const;

const GROUPS: Record<string, readonly string[]> = {
  active: ['received', 'generating', 'file_ready', 'draft_created', 'submitted', 'passed', 'printed'],
  failed: ['failed'],
  done:   ['shipped', 'delivered'],
};

const STATE_COLORS: Record<string, { bg: string; color: string }> = {
  received:      { bg: '#dbeafe', color: '#1e40af' },
  generating:    { bg: '#fef9c3', color: '#854d0e' },
  file_ready:    { bg: '#dcfce7', color: '#166534' },
  draft_created: { bg: '#ede9fe', color: '#5b21b6' },
  submitted:     { bg: '#e0f2fe', color: '#0369a1' },
  passed:        { bg: '#d1fae5', color: '#065f46' },
  printed:       { bg: '#d1fae5', color: '#065f46' },
  shipped:       { bg: '#fce7f3', color: '#9d174d' },
  delivered:     { bg: '#f0fdf4', color: '#15803d' },
  failed:        { bg: '#fee2e2', color: '#991b1b' },
};

const APPROVAL_LABELS: Record<string, string> = {
  pdf_only:  'PDF only',
  submit:    'Submit',
  go_live:   'Go-live',
  cancelled: 'Cancelled',
};

// Approval filter options (null = all). 'none' matches jobs with no manual_approval.
const APPROVAL_FILTERS: ReadonlyArray<{ key: string | null; label: string }> = [
  { key: null,        label: 'All' },
  { key: 'none',      label: 'None' },
  { key: 'pdf_only',  label: 'PDF only' },
  { key: 'submit',    label: 'Submit' },
  { key: 'go_live',   label: 'Go-live' },
  { key: 'cancelled', label: 'Cancelled' },
];

// Date filter presets (null = all time). Value = number of days back from now.
const DATE_FILTERS: ReadonlyArray<{ key: string | null; label: string }> = [
  { key: null, label: 'All time' },
  { key: '7',  label: 'Last 7d' },
  { key: '30', label: 'Last 30d' },
  { key: '90', label: 'Last 90d' },
];

type Props = {
  searchParams: Promise<{
    state?: string;
    group?: string;
    drawer?: string;
    mug_ready?: string;
    q?: string;
    approval?: string;
    days?: string;
  }>;
};

export default async function MugFulfillmentPage({ searchParams }: Props) {
  // Auth guard
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/dashboard/admin/login');

  const sp = await searchParams;
  const activeState    = sp.state    ?? null;
  const activeGroup    = sp.group    ?? null;
  const mugReadyOnly   = sp.mug_ready === '1';
  const searchQ        = sp.q        ?? '';
  const drawerId       = sp.drawer   ?? null;
  const activeApproval = sp.approval ?? null;
  const activeDays     = sp.days     ?? null;

  // Fetch all jobs — paginate past PostgREST's 1000-row default so counts,
  // totals, and the date filter reflect the full table, not just the newest 1000.
  const JOB_COLUMNS = 'id, state, manual_approval, shopify_order_name, shopify_order_id, shopify_line_item_id, tile_id, tile_override_url, print_file_url, gelato_draft_id, gelato_order_id, shopify_fulfillment_id, customer_name, shipping_address, tracking_number, tracking_url, tracking_company, attempts, last_error, next_attempt_at, created_at, updated_at, gelato_product_uid, quantity, mug_ready, mug_ready_at, mug_ready_checked_at';
  const jobs: NonNullable<Awaited<ReturnType<typeof fetchJobsPage>>> = [];
  async function fetchJobsPage(from: number, to: number) {
    const { data } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .select(JOB_COLUMNS)
      .order('created_at', { ascending: false })
      .range(from, to);
    return data;
  }
  {
    const PAGE = 1000;
    for (let from = 0; from < 20000; from += PAGE) {
      const page = await fetchJobsPage(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      jobs.push(...page);
      if (page.length < PAGE) break;
    }
  }

  const stateCounts: Record<string, number> = {};
  for (const s of ALL_STATES) stateCounts[s] = 0;
  for (const j of jobs) stateCounts[j.state] = (stateCounts[j.state] ?? 0) + 1;

  const groupCounts = {
    active: GROUPS.active.reduce((sum, s) => sum + (stateCounts[s] ?? 0), 0),
    failed: stateCounts['failed'] ?? 0,
    done:   GROUPS.done.reduce((sum, s) => sum + (stateCounts[s] ?? 0), 0),
  };

  const mugReadyCount = jobs.filter(j => j.mug_ready).length;

  // Approval counts (null manual_approval → 'none' bucket).
  const approvalCounts: Record<string, number> = {};
  for (const j of jobs) {
    const key = j.manual_approval ?? 'none';
    approvalCounts[key] = (approvalCounts[key] ?? 0) + 1;
  }

  // Date cutoff for the "last N days" preset (by created_at).
  const daysNum    = activeDays ? parseInt(activeDays, 10) : null;
  const dateCutoff = daysNum && !Number.isNaN(daysNum)
    ? new Date(Date.now() - daysNum * 86_400_000)
    : null;

  const filteredJobs = (() => {
    let list = jobs;
    if (mugReadyOnly) list = list.filter(j => j.mug_ready);
    if (activeGroup && GROUPS[activeGroup]) list = list.filter(j => GROUPS[activeGroup].includes(j.state));
    if (activeState) list = list.filter(j => j.state === activeState);
    if (activeApproval) list = list.filter(j => (j.manual_approval ?? 'none') === activeApproval);
    if (dateCutoff) list = list.filter(j => j.created_at != null && new Date(j.created_at) >= dateCutoff);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(j =>
        (j.shopify_order_name ?? '').toLowerCase().includes(q) ||
        (j.customer_name ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  })();

  // Fetch recent webhook/events log
  const { data: recentEvents } = await supabaseAdmin
    .from('mug_fulfillment_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch drawer job events if drawer open
  const drawerJob = drawerId ? jobs.find(j => j.id === drawerId) ?? null : null;
  let drawerEvents: typeof recentEvents = [];
  if (drawerId) {
    const { data } = await supabaseAdmin
      .from('mug_fulfillment_events')
      .select('*')
      .eq('job_id', drawerId)
      .order('created_at', { ascending: true });
    drawerEvents = data ?? [];
  }

  const refreshedAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  // Build a URL preserving current filters, with overrides
  function buildUrl(overrides: Record<string, string | null> = {}) {
    const vals: Record<string, string | null> = {
      state:     activeState,
      group:     activeGroup,
      mug_ready: mugReadyOnly ? '1' : null,
      q:         searchQ || null,
      approval:  activeApproval,
      days:      activeDays,
      drawer:    drawerId,
      ...overrides,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(vals)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/dashboard/admin/mug-fulfillment${qs ? '?' + qs : ''}`;
  }

  function groupUrl(g: string | null) {
    return buildUrl({ group: g, state: null, drawer: null });
  }

  function stateUrl(s: string | null) {
    return buildUrl({ state: s, drawer: null });
  }

  function mugReadyUrl(on: boolean) {
    return buildUrl({ mug_ready: on ? '1' : null, drawer: null });
  }

  function approvalUrl(a: string | null) {
    return buildUrl({ approval: a, drawer: null });
  }

  function daysUrl(d: string | null) {
    return buildUrl({ days: d, drawer: null });
  }

  function drawerUrl(jobId: string) {
    return buildUrl({ drawer: jobId });
  }

  function closeDrawerUrl() {
    return buildUrl({ drawer: null });
  }

  // Active group's state pills (secondary filter)
  const groupStates = activeGroup ? (GROUPS[activeGroup] ?? []) : null;

  // Filter label for the jobs table header
  const baseLabel = searchQ
    ? `matching "${searchQ}"`
    : activeState
    ? `(${activeState})`
    : activeGroup
    ? `(${activeGroup})`
    : mugReadyOnly
    ? '(mug:ready)'
    : 'total';
  const extraLabels = [
    activeApproval ? `approval: ${APPROVAL_LABELS[activeApproval] ?? activeApproval}` : null,
    activeDays     ? `last ${activeDays}d` : null,
  ].filter(Boolean);
  const filterLabel = extraLabels.length > 0
    ? `${baseLabel} · ${extraLabels.join(' · ')}`
    : baseLabel;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: 'var(--font-sans)' }}>

      {/* Header */}
      <div style={{
        background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 30,
      }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
          Mug <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Fulfillment</em>
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)' }}>
            {refreshedAt}
          </span>
          <Link
            href={buildUrl({ drawer: null })}
            style={{
              background: 'var(--neutral-100)', color: 'var(--neutral-800)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Refresh
          </Link>
          <Link
            href="/dashboard/admin"
            style={{
              background: 'var(--neutral-100)', color: 'var(--neutral-500)',
              border: '1px solid var(--neutral-100)', borderRadius: 8,
              padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ← Admin
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem' }}>

        {/* Scan mug:ready status across recent orders */}
        <MugReadyScanForm action={scanMugReady} />

        {/* Filter strip */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '0.875rem 1rem',
          marginBottom: '1.5rem',
        }}>
          {/* Top row: group tabs + search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>

            {/* Group tabs */}
            {([
              { key: null,     label: 'All',    count: jobs.length },
              { key: 'active', label: 'Active', count: groupCounts.active },
              { key: 'failed', label: 'Failed', count: groupCounts.failed },
              { key: 'done',   label: 'Done',   count: groupCounts.done },
            ] as const).map(({ key, label, count }) => {
              const isActive = activeGroup === key && !mugReadyOnly;
              return (
                <Link
                  key={label}
                  href={groupUrl(key)}
                  style={{
                    padding: '0.35rem 0.875rem', borderRadius: 8, fontSize: '0.82rem',
                    fontFamily: 'var(--font-mono)', textDecoration: 'none',
                    background: isActive ? 'var(--accent)' : 'var(--surface2)',
                    color: isActive ? '#fff' : 'var(--muted)',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {label} <span style={{ opacity: 0.65 }}>({count})</span>
                </Link>
              );
            })}

            {/* mug:ready toggle */}
            <Link
              href={mugReadyUrl(!mugReadyOnly)}
              style={{
                padding: '0.35rem 0.875rem', borderRadius: 8, fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)', textDecoration: 'none',
                background: mugReadyOnly ? '#166534' : '#dcfce7',
                color: mugReadyOnly ? '#fff' : '#166534',
                border: '1px solid #bbf7d0',
                fontWeight: mugReadyOnly ? 600 : 400,
              }}
            >
              mug:ready <span style={{ opacity: 0.8 }}>({mugReadyCount})</span>
            </Link>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Search */}
            <Suspense fallback={null}>
              <MugSearchBox defaultValue={searchQ} />
            </Suspense>
          </div>

          {/* Approval + date filters */}
          <div style={{
            display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center',
            marginTop: '0.625rem', paddingTop: '0.625rem',
            borderTop: '1px solid var(--border)',
          }}>
            <span style={{
              fontSize: '0.66rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '0.15rem',
            }}>Approval</span>
            {APPROVAL_FILTERS.map(({ key, label }) => {
              const isActive = activeApproval === key;
              const count = key === null ? jobs.length : (approvalCounts[key] ?? 0);
              return (
                <Link
                  key={label}
                  href={approvalUrl(key)}
                  style={{
                    padding: '0.25rem 0.65rem', borderRadius: 20, fontSize: '0.76rem',
                    fontFamily: 'var(--font-mono)', textDecoration: 'none',
                    background: isActive ? 'var(--accent)' : 'var(--surface2)',
                    color: isActive ? '#fff' : 'var(--muted)',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    fontWeight: isActive ? 600 : 400,
                    opacity: key !== null && count === 0 ? 0.4 : 1,
                  }}
                >
                  {label} <span style={{ opacity: 0.65 }}>({count})</span>
                </Link>
              );
            })}

            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 0.375rem' }} />

            <span style={{
              fontSize: '0.66rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '0.15rem',
            }}>Date</span>
            {DATE_FILTERS.map(({ key, label }) => {
              const isActive = activeDays === key;
              return (
                <Link
                  key={label}
                  href={daysUrl(key)}
                  style={{
                    padding: '0.25rem 0.65rem', borderRadius: 20, fontSize: '0.76rem',
                    fontFamily: 'var(--font-mono)', textDecoration: 'none',
                    background: isActive ? 'var(--accent)' : 'var(--surface2)',
                    color: isActive ? '#fff' : 'var(--muted)',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          {/* Secondary state pills — only when a group is selected */}
          {groupStates && groupStates.length > 0 && (
            <div style={{
              display: 'flex', gap: '0.375rem', flexWrap: 'wrap',
              marginTop: '0.625rem', paddingTop: '0.625rem',
              borderTop: '1px solid var(--border)',
            }}>
              {groupStates.map(s => {
                const c = STATE_COLORS[s] ?? { bg: '#f3f4f6', color: '#374151' };
                const isActive = activeState === s;
                return (
                  <Link
                    key={s}
                    href={stateUrl(isActive ? null : s)}
                    style={{
                      padding: '0.25rem 0.65rem', borderRadius: 20, fontSize: '0.76rem',
                      fontFamily: 'var(--font-mono)', textDecoration: 'none',
                      background: isActive ? c.color : c.bg,
                      color: isActive ? '#fff' : c.color,
                      border: `1px solid ${c.color}40`,
                      fontWeight: isActive ? 600 : 400,
                      opacity: stateCounts[s] === 0 ? 0.4 : 1,
                    }}
                  >
                    {s} ({stateCounts[s]})
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Jobs table */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, marginBottom: '2rem', overflow: 'hidden',
        }}>
          <div style={{
            padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--muted)',
          }}>
            Jobs — {filteredJobs.length} {filterLabel}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Order', 'Mug Ready', 'Customer', 'State', 'Tracking #', 'Shopify', 'Approval', 'Tile', 'PDF', 'Gelato', 'Att.', 'Last Error', 'Created', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '0.55rem 0.875rem', textAlign: 'left', whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase',
                      letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.875rem' }}>
                      No jobs found.
                    </td>
                  </tr>
                ) : filteredJobs.map((job, i) => {
                  const sc = STATE_COLORS[job.state] ?? { bg: '#f3f4f6', color: '#374151' };
                  const isTerminal = ['delivered', 'failed'].includes(job.state);
                  const canCancelState = !['delivered', 'shipped', 'printed', 'submitted'].includes(job.state);

                  return (
                    <tr
                      key={job.id}
                      style={{
                        borderBottom: i < filteredJobs.length - 1 ? '1px solid var(--border)' : 'none',
                        background: drawerId === job.id ? 'rgba(59,130,246,0.04)' : i % 2 === 1 ? 'rgba(0,0,0,0.012)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Order */}
                      <td style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap' }}>
                        <a
                          href={`https://admin.shopify.com/store/storyboards/orders/${job.shopify_order_id}`}
                          target="_blank" rel="noreferrer"
                          style={{ color: 'var(--cash-blue)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600 }}
                        >
                          {job.shopify_order_name}
                        </a>
                      </td>

                      {/* Mug Ready */}
                      <td style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap' }}>
                        {(job as any).mug_ready ? (
                          <span
                            title={(job as any).mug_ready_at ? `Ready since ${new Date((job as any).mug_ready_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Customer confirmed'}
                            style={{
                              display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: 6,
                              background: '#dcfce7', color: '#166534',
                              fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                              textTransform: 'uppercase', cursor: 'help',
                            }}
                          >
                            READY
                          </span>
                        ) : (
                          <span
                            title={(job as any).mug_ready_checked_at ? `Last checked ${new Date((job as any).mug_ready_checked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Not yet checked'}
                            style={{ color: 'var(--muted)', fontSize: '0.75rem', cursor: 'help' }}
                          >
                            —
                          </span>
                        )}
                      </td>

                      {/* Customer */}
                      <td style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap' }}>
                        <Link href={drawerUrl(job.id)} style={{ textDecoration: 'none', color: 'inherit' }}>
                          {job.customer_name ?? '—'}
                        </Link>
                      </td>

                      {/* State */}
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        <span style={{
                          display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: 6,
                          background: sc.bg, color: sc.color,
                          fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                          textTransform: 'uppercase', whiteSpace: 'nowrap',
                        }}>
                          {job.state}
                        </span>
                      </td>

                      {/* Tracking # */}
                      <td style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap' }}>
                        {job.tracking_number ? (
                          job.tracking_url ? (
                            <a
                              href={job.tracking_url}
                              target="_blank" rel="noreferrer"
                              title={`${job.tracking_number}${job.tracking_company ? ` — ${job.tracking_company}` : ''}`}
                              style={{ color: 'var(--cash-blue)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 600 }}
                            >
                              {job.tracking_number} ↗
                            </a>
                          ) : (
                            <span
                              title={job.tracking_company ?? ''}
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text)' }}
                            >
                              {job.tracking_number}
                            </span>
                          )
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>

                      {/* Shopify updated */}
                      <td style={{ padding: '0.55rem 0.875rem', textAlign: 'center' }}>
                        {(() => {
                          const fid = (job as any).shopify_fulfillment_id as string | null;
                          const done = !!fid && fid !== 'not_found';
                          if (done) {
                            return (
                              <span
                                title={`Fulfilled in Shopify (id ${fid})`}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: 20, height: 20, borderRadius: 5,
                                  background: '#dcfce7', color: '#166534',
                                  fontSize: '0.8rem', fontWeight: 700, cursor: 'help',
                                }}
                              >
                                ✓
                              </span>
                            );
                          }
                          // Shipped/delivered but not yet pushed → highlight as pending.
                          const pending = ['shipped', 'delivered'].includes(job.state);
                          return (
                            <span
                              title={pending ? 'Shipped but not yet pushed to Shopify' : 'Not fulfilled in Shopify'}
                              style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 20, height: 20, borderRadius: 5,
                                background: pending ? '#fef9c3' : 'transparent',
                                color: pending ? '#854d0e' : 'var(--muted)',
                                border: pending ? '1px solid #fde047' : '1px solid var(--border)',
                                fontSize: '0.8rem', fontWeight: 700, cursor: 'help',
                              }}
                            >
                              {pending ? '!' : '—'}
                            </span>
                          );
                        })()}
                      </td>

                      {/* Approval */}
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        {job.manual_approval ? (
                          <span style={{
                            display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: 6,
                            background: '#f0fdf4', color: '#166534',
                            fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 500,
                          }}>
                            {APPROVAL_LABELS[job.manual_approval] ?? job.manual_approval}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>none</span>
                        )}
                      </td>

                      {/* Tile */}
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        <span
                          title={job.tile_id ?? ''}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', cursor: 'help' }}
                        >
                          {job.tile_id ? job.tile_id.slice(0, 8) + '…' : '—'}
                        </span>
                      </td>

                      {/* PDF */}
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        {job.print_file_url ? (
                          <a
                            href={job.print_file_url}
                            target="_blank" rel="noreferrer"
                            style={{ color: '#059669', fontSize: '0.78rem', fontWeight: 600 }}
                          >
                            PDF ↗
                          </a>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>

                      {/* Gelato */}
                      <td style={{ padding: '0.55rem 0.875rem' }}>
                        {job.gelato_order_id ? (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} title={job.gelato_order_id}>
                            {job.gelato_order_id.slice(0, 10)}…
                          </span>
                        ) : job.gelato_draft_id ? (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }} title={job.gelato_draft_id}>
                            draft:{job.gelato_draft_id.slice(0, 8)}…
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>

                      {/* Attempts */}
                      <td style={{ padding: '0.55rem 0.875rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        {job.attempts}
                      </td>

                      {/* Last error */}
                      <td style={{ padding: '0.55rem 0.875rem', maxWidth: 160 }}>
                        {job.last_error ? (
                          <span
                            title={job.last_error}
                            style={{ color: '#dc2626', fontSize: '0.72rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}
                          >
                            {job.last_error}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>

                      {/* Created */}
                      <td style={{ padding: '0.55rem 0.875rem', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: '0.75rem' }}>
                        {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '0.4rem 0.875rem' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>

                          {/* View drawer */}
                          <Link
                            href={drawerUrl(job.id)}
                            style={btnStyle('ghost')}
                          >
                            View
                          </Link>

                          {/* Tile override URL — shown when state is received or failed */}
                          {['received', 'failed'].includes(job.state) && (
                            <form action={setTileOverrideUrl} style={{ display: 'flex', gap: 4 }}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <input
                                type="url"
                                name="tile_override_url"
                                defaultValue={(job as any).tile_override_url ?? ''}
                                placeholder="Tile override URL (optional)"
                                style={{ fontSize: 11, padding: '2px 6px', border: '1px solid #ccc', borderRadius: 4, width: 200 }}
                              />
                              <button type="submit" style={btnStyle('ghost')}>Set</button>
                            </form>
                          )}

                          {/* Fulfill — single button for received/failed: approve + generate PDF + submit to Gelato */}
                          {['received', 'failed'].includes(job.state) && (
                            <form action={fulfillOrder}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('green')}>Fulfill</button>
                            </form>
                          )}

                          {/* Submit to Gelato — PDF already generated, just submit */}
                          {job.state === 'file_ready' && (
                            <form action={submitGelato}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('purple')}>Submit to Gelato</button>
                            </form>
                          )}

                          {/* Reset — available on any state except delivered */}
                          {job.state !== 'delivered' && (
                            <form action={resetToReceived}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('yellow')}>Reset</button>
                            </form>
                          )}

                          {/* Cancel — show on non-terminal, non-cancelled */}
                          {!isTerminal && canCancelState && job.manual_approval !== 'cancelled' && (
                            <form action={cancelJob}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('red')}>Cancel</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent events log */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--muted)',
          }}>
            Recent Events (last 50)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Job', 'Event', 'From → To', 'Error / Payload'].map(h => (
                    <th key={h} style={{
                      padding: '0.5rem 0.875rem', textAlign: 'left', whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase',
                      letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(recentEvents ?? []).map((ev, i) => {
                  const jobRow = jobs.find(j => j.id === ev.job_id);
                  return (
                    <tr key={ev.id} style={{
                      borderBottom: i < (recentEvents ?? []).length - 1 ? '1px solid var(--border)' : 'none',
                      background: i % 2 === 1 ? 'rgba(0,0,0,0.012)' : 'transparent',
                    }}>
                      <td style={{ padding: '0.45rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {new Date(ev.created_at).toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.45rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {jobRow ? (
                          <Link href={drawerUrl(ev.job_id)} style={{ color: 'var(--cash-blue)', textDecoration: 'none' }}>
                            {jobRow.shopify_order_name}
                          </Link>
                        ) : (
                          <span title={ev.job_id}>{ev.job_id.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td style={{ padding: '0.45rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600 }}>
                        {ev.event_type}
                      </td>
                      <td style={{ padding: '0.45rem 0.875rem', color: 'var(--muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {ev.from_state && ev.to_state ? `${ev.from_state} → ${ev.to_state}` : '—'}
                      </td>
                      <td style={{ padding: '0.45rem 0.875rem', maxWidth: 300 }}>
                        {ev.error ? (
                          <span style={{ color: '#dc2626', fontSize: '0.72rem' }}>{ev.error}</span>
                        ) : ev.payload && Object.keys(ev.payload).length > 0 ? (
                          <span
                            title={JSON.stringify(ev.payload)}
                            style={{ color: 'var(--muted)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', cursor: 'help' }}
                          >
                            {JSON.stringify(ev.payload)}
                          </span>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Drawer */}
      {drawerJob && (
        <MugJobDrawer
          job={drawerJob as Parameters<typeof MugJobDrawer>[0]['job']}
          events={(drawerEvents ?? []) as Parameters<typeof MugJobDrawer>[0]['events']}
          closeHref={closeDrawerUrl()}
        />
      )}
    </div>
  );
}

function btnStyle(variant: 'blue' | 'green' | 'purple' | 'red' | 'yellow' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '0.2rem 0.55rem', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600,
    fontFamily: 'var(--font-mono)', cursor: 'pointer', border: '1px solid transparent',
    whiteSpace: 'nowrap', display: 'inline-block',
  };
  const variants: Record<string, React.CSSProperties> = {
    blue:   { background: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' },
    green:  { background: '#dcfce7', color: '#166534', borderColor: '#86efac' },
    purple: { background: '#ede9fe', color: '#5b21b6', borderColor: '#c4b5fd' },
    red:    { background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' },
    yellow: { background: '#fef9c3', color: '#854d0e', borderColor: '#fde047' },
    ghost:  { background: 'var(--surface2)', color: 'var(--muted)', borderColor: 'var(--border)' },
  };
  return { ...base, ...variants[variant] };
}
