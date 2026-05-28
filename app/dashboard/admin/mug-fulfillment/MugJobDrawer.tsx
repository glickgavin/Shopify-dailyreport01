'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface MugEvent {
  id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

interface MugJob {
  id: string;
  shopify_order_id: string;
  shopify_order_name: string;
  shopify_line_item_id: string;
  tile_id: string | null;
  print_file_url: string | null;
  gelato_product_uid: string;
  quantity: number;
  state: string;
  manual_approval: string | null;
  gelato_draft_id: string | null;
  gelato_order_id: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company: string | null;
  customer_name: string | null;
  shipping_address: Record<string, unknown> | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  job: MugJob;
  events: MugEvent[];
  closeHref: string;
}

export default function MugJobDrawer({ job, events, closeHref }: Props) {
  const router = useRouter();

  const close = useCallback(() => {
    router.push(closeHref);
  }, [router, closeHref]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          zIndex: 40, cursor: 'pointer',
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, background: 'var(--bg)',
        borderLeft: '1px solid var(--border)',
        zIndex: 50, overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1,
        }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{job.shopify_order_name}</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
              {job.customer_name}
            </span>
          </div>
          <button
            onClick={close}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.875rem',
              color: 'var(--muted)',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Job fields */}
          <Section title="Job Details">
            <Row label="ID" value={job.id} mono />
            <Row label="State" value={job.state} />
            <Row label="Approval" value={job.manual_approval ?? 'none'} />
            <Row label="Tile ID" value={job.tile_id ?? '—'} mono />
            <Row label="Order ID" value={job.shopify_order_id} mono />
            <Row label="Line Item" value={job.shopify_line_item_id} mono />
            <Row label="Attempts" value={String(job.attempts)} />
            {job.last_error && <Row label="Last Error" value={job.last_error} error />}
            {job.print_file_url && (
              <Row label="PDF" value={
                <a href={job.print_file_url} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--cash-blue)', wordBreak: 'break-all' }}>
                  {job.print_file_url}
                </a>
              } />
            )}
            {job.gelato_order_id && <Row label="Gelato Order" value={job.gelato_order_id} mono />}
            {job.gelato_draft_id && <Row label="Gelato Draft" value={job.gelato_draft_id} mono />}
            {job.tracking_number && <Row label="Tracking" value={job.tracking_number} mono />}
            <Row label="Created" value={new Date(job.created_at).toLocaleString()} />
            <Row label="Updated" value={new Date(job.updated_at).toLocaleString()} />
          </Section>

          {/* Shipping address */}
          {job.shipping_address && (
            <Section title="Shipping Address">
              <pre style={{
                fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
                background: 'var(--surface2)', borderRadius: 6, padding: '0.75rem',
                overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                margin: 0,
              }}>
                {JSON.stringify(job.shipping_address, null, 2)}
              </pre>
            </Section>
          )}

          {/* Audit events */}
          <Section title={`Audit Log (${events.length})`}>
            {events.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>No events yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {events.map((ev) => (
                  <div key={ev.id} style={{
                    background: 'var(--surface)', borderRadius: 8,
                    border: '1px solid var(--border)', padding: '0.6rem 0.75rem',
                    fontSize: '0.78rem',
                  }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: ev.payload || ev.error ? '0.4rem' : 0 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: ev.error ? '#dc2626' : 'var(--fg)' }}>
                        {ev.event_type}
                      </span>
                      {ev.from_state && ev.to_state && (
                        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                          {ev.from_state} → {ev.to_state}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                        {new Date(ev.created_at).toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {ev.error && (
                      <div style={{ color: '#dc2626', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', marginBottom: ev.payload ? '0.3rem' : 0 }}>
                        {ev.error}
                      </div>
                    )}
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <pre style={{
                        fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
                        background: 'var(--surface2)', borderRadius: 4, padding: '0.4rem 0.5rem',
                        overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        margin: 0, color: 'var(--muted)',
                      }}>
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase',
        letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.625rem',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono, error }: { label: string; value: React.ReactNode; mono?: boolean; error?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem',
      padding: '0.3rem 0', borderBottom: '1px solid var(--border)',
      fontSize: '0.8rem', alignItems: 'start',
    }}>
      <span style={{ color: 'var(--muted)', paddingTop: 1 }}>{label}</span>
      <span style={{
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: mono ? '0.74rem' : undefined,
        color: error ? '#dc2626' : undefined,
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  );
}
