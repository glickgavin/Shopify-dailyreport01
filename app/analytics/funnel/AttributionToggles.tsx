'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';

interface Props {
  emailStitch: boolean;
  applyWindow: boolean;
}

/**
 * Two URL-driven toggles for funnel attribution rules.
 *
 * - "Stitch by email": when on, the funnel function joins events across
 *   sessions by email so cross-domain conversions (e.g. order_placed in
 *   Shopify's session, prior steps in the imagegen session) get
 *   attributed to the upload-flow session. When off, only session_id
 *   matching is used — strict same-session attribution.
 *
 * - "24h step window": when on, each consecutive funnel step must occur
 *   within 24 hours of the previous step. When off, the window is
 *   effectively disabled (set to 1 year on the server side) so a user
 *   can complete the funnel over a long stretch of time.
 *
 * Defaults: both on. The URL only carries the param when its toggle
 * is OFF (`email_stitch=false` / `apply_window=false`); ON is the
 * default and produces a clean URL.
 */
export default function AttributionToggles({ emailStitch, applyWindow }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const navigate = useCallback((params: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    router.push(`${pathname}?${next.toString()}`);
  }, [router, pathname, sp]);

  // When currently on, flipping sets the param to 'false'.
  // When currently off, flipping clears the param (back to default = on).
  const toggleEmail  = () => navigate({ email_stitch: emailStitch  ? 'false' : '' });
  const toggleWindow = () => navigate({ apply_window: applyWindow ? 'false' : '' });

  const active   = { background: '#1a1a2e', color: '#fff', border: '1px solid #1a1a2e', fontWeight: 600 };
  const inactive = { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' };
  const btn = {
    padding: '0.35rem 0.65rem',
    borderRadius: 8,
    fontSize: '0.78rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  } as const;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0.25rem 0 0.75rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--muted)', marginRight: 4 }}>Attribution:</span>
      <button
        onClick={toggleEmail}
        title="Match users across sessions by email. Required to attribute Shopify-checkout events (e.g. order_placed) back to the upload-flow session that fired the earlier steps."
        style={{ ...btn, ...(emailStitch ? active : inactive) }}
      >
        <span aria-hidden>{emailStitch ? '✓' : '○'}</span>
        Stitch by email
      </button>
      <button
        onClick={toggleWindow}
        title="Require each consecutive funnel step to occur within 24 hours of the previous step. Turn off to allow longer journeys (up to ~1 year)."
        style={{ ...btn, ...(applyWindow ? active : inactive) }}
      >
        <span aria-hidden>{applyWindow ? '✓' : '○'}</span>
        24h step window
      </button>
    </div>
  );
}
