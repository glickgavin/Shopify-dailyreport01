export const dynamic = 'force-dynamic';

import { supabaseAdmin } from '@/lib/supabase';
import { fetchDistinctEventTypes } from '@/lib/analytics/client';
import BulkMapForm from './BulkMapForm';

export default async function UnmappedPage() {
  const [{ data: definitions }, { data: categories }] = await Promise.all([
    supabaseAdmin.from('analytics_event_definitions').select('event_type'),
    supabaseAdmin.from('analytics_event_categories').select('*').order('name'),
  ]);

  const mappedTypes = new Set((definitions ?? []).map((d: { event_type: string }) => d.event_type));
  const cats = categories ?? [];

  let liveTypes: string[] = [];
  let fetchError: string | null = null;
  try {
    liveTypes = await fetchDistinctEventTypes({});
  } catch (e) {
    fetchError = String(e);
  }

  const unmapped = liveTypes.filter(t => !mappedTypes.has(t)).sort();

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Unmapped Events</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          {unmapped.length} event type{unmapped.length !== 1 ? 's' : ''} seen in analytics but not defined in the dictionary.
        </p>
      </div>

      {fetchError && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>
          Could not fetch live event types: {fetchError}
        </div>
      )}

      {unmapped.length === 0 ? (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>✓</div>
          <p style={{ color: '#166534', fontWeight: 600 }}>All event types are mapped!</p>
          <p style={{ color: '#15803d', fontSize: '0.85rem' }}>No action needed.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Unmapped Types ({unmapped.length})</span>
            <a href="/configuration/events" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>
              → Go to Event Config
            </a>
          </div>

          {/* Bulk map form */}
          <BulkMapForm unmappedTypes={unmapped} categories={cats} />
        </div>
      )}
    </div>
  );
}
