import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import MugJobDrawer from './MugJobDrawer';
import {
  approvePdf, approveSubmit, approveGoLive,
  generatePdf, submitGelato, cancelJob, resetToReceived,
} from './actions';

export const revalidate = 0;

const ALL_STATES = [
  'received', 'generating', 'file_ready', 'draft_created',
  'submitted', 'passed', 'printed', 'shipped', 'delivered', 'failed',
] as const;

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

type Props = {
  searchParams: Promise<{ state?: string; drawer?: string }>;
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
  const activeState = sp.state ?? null;
  const drawerId = sp.drawer ?? null;

  // Fetch state counts
  const { data: allJobs } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, state, manual_approval, shopify_order_name, shopify_order_id, shopify_line_item_id, tile_id, print_file_url, gelato_draft_id, gelato_order_id, customer_name, shipping_address, tracking_number, tracking_url, tracking_company, attempts, last_error, next_attempt_at, created_at, updated_at, gelato_product_uid, quantity')
    .order('created_at', { ascending: false });

  const jobs = allJobs ?? [];

  const stateCounts: Record<string, number> = {};
  for (const s of ALL_STATES) stateCounts[s] = 0;
  for (const j of jobs) stateCounts[j.state] = (stateCounts[j.state] ?? 0) + 1;

  const filteredJobs = activeState ? jobs.filter(j => j.state === activeState) : jobs;

  // Fetch recent webhook/events log
  const { data: recentEvents } = await supabaseAdmin
    .from('mug_fulfillment_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch drawer job events if drawer open
  let drawerJob = drawerId ? jobs.find(j => j.id === drawerId) ?? null : null;
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

  function stateUrl(s: string | null) {
    const params = new URLSearchParams();
    if (s) params.set('state', s);
    const qs = params.toString();
    return `/dashboard/admin/mug-fulfillment${qs ? '?' + qs : ''}`;
  }

  function drawerUrl(jobId: string) {
    const params = new URLSearchParams();
    if (activeState) params.set('state', activeState);
    params.set('drawer', jobId);
    return `/dashboard/admin/mug-fulfillment?${params.toString()}`;
  }

  function closeDrawerUrl() {
    return stateUrl(activeState);
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: 'var(--font-sans)' }}>

      {/* Header */}
      <div style={{
        background: '#1a1a2e', color: '#fff', padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 30,
      }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
          Mug <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Fulfillment</em>
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
            {refreshedAt}
          </span>
          <Link
            href={stateUrl(activeState)}
            style={{
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
              padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Refresh
          </Link>
          <Link
            href="/dashboard/admin"
            style={{
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
              padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ← Admin
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem' }}>

        {/* State summary strip */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
          marginBottom: '1.5rem',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '0.875rem 1rem',
        }}>
          <Link
            href={stateUrl(null)}
            style={{
              padding: '0.35rem 0.75rem', borderRadius: 20, fontSize: '0.78rem',
              fontFamily: 'var(--font-mono)', textDecoration: 'none',
              background: !activeState ? '#1a1a2e' : 'var(--surface2)',
              color: !activeState ? '#fff' : 'var(--muted)',
              border: '1px solid var(--border)',
              fontWeight: !activeState ? 600 : 400,
            }}
          >
            all ({jobs.length})
          </Link>
          {ALL_STATES.map(s => {
            const c = STATE_COLORS[s] ?? { bg: '#f3f4f6', color: '#374151' };
            const isActive = activeState === s;
            return (
              <Link
                key={s}
                href={stateUrl(s)}
                style={{
                  padding: '0.35rem 0.75rem', borderRadius: 20, fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)', textDecoration: 'none',
                  background: isActive ? c.color : c.bg,
                  color: isActive ? '#fff' : c.color,
                  border: `1px solid ${c.color}40`,
                  fontWeight: isActive ? 600 : 400,
                  opacity: stateCounts[s] === 0 ? 0.45 : 1,
                }}
              >
                {s} ({stateCounts[s]})
              </Link>
            );
          })}
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
            Jobs — {filteredJobs.length} {activeState ? `(${activeState})` : 'total'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Order', 'Customer', 'State', 'Approval', 'Tile', 'PDF', 'Gelato', 'Att.', 'Last Error', 'Created', 'Actions'].map(h => (
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
                    <td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.875rem' }}>
                      No jobs in this state.
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

                          {/* Approve PDF — show when no approval yet */}
                          {!job.manual_approval && (
                            <form action={approvePdf}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('blue')}>Approve PDF</button>
                            </form>
                          )}

                          {/* Generate PDF — show when approved >= pdf_only and state allows it */}
                          {(['pdf_only', 'submit', 'go_live'] as string[]).includes(job.manual_approval ?? '') &&
                           ['received', 'generating', 'failed'].includes(job.state) && (
                            <form action={generatePdf}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('green')}>Generate PDF</button>
                            </form>
                          )}

                          {/* Approve Submit — show when file_ready and only pdf_only approval */}
                          {job.state === 'file_ready' && job.manual_approval === 'pdf_only' && (
                            <form action={approveSubmit}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('blue')}>Approve Submit</button>
                            </form>
                          )}

                          {/* Submit to Gelato — show when file_ready and submit or higher approval */}
                          {job.state === 'file_ready' && (['submit', 'go_live'] as string[]).includes(job.manual_approval ?? '') && (
                            <form action={submitGelato}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('purple')}>Submit to Gelato</button>
                            </form>
                          )}

                          {/* Approve Go-Live — show when draft_created and submit approval */}
                          {job.state === 'draft_created' && job.manual_approval === 'submit' && (
                            <form action={approveGoLive}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button type="submit" style={btnStyle('blue')}>Approve Go-Live</button>
                            </form>
                          )}

                          {/* Reset — show on failed */}
                          {job.state === 'failed' && job.manual_approval !== 'cancelled' && (
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
