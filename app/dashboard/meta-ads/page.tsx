import Link from 'next/link';
import { fetchCampaignInsights, fetchAdInsightsForCampaign } from '@/lib/meta';
import type { MetaPreset, CampaignInsight, AdInsight } from '@/lib/meta';
import { SectionLabel } from '../_components/cards';

export const dynamic = 'force-dynamic';

// ── types ─────────────────────────────────────────────────────────────────────

interface Kpis {
  spend: number;
  impressions: number;
  cpm: number;
  purchases: number;
  cost_per_purchase: number | null;
  purchase_roas: number | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_PRESETS: MetaPreset[] = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_30d'];
const TZ = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtInt(n: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}
function fmtRoas(n: number | null) {
  return n != null ? `${n.toFixed(2)}×` : 'N/A';
}

function aggregateKpis(campaigns: CampaignInsight[]): Kpis {
  const spend       = campaigns.reduce((s, c) => s + c.spend, 0);
  const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const purchases   = campaigns.reduce((s, c) => s + c.purchases, 0);
  const cpp         = spend > 0 && purchases > 0 ? spend / purchases : null;
  // Weighted average ROAS by spend
  const roasRows    = campaigns.filter((c) => c.purchase_roas != null && c.spend > 0);
  const roasWt      = roasRows.reduce((s, c) => s + c.purchase_roas! * c.spend, 0);
  const roasDenom   = roasRows.reduce((s, c) => s + c.spend, 0);
  const roas        = roasDenom > 0 ? roasWt / roasDenom : null;
  const cpm         = impressions > 0 ? (spend / impressions) * 1000 : 0;
  return { spend, impressions, cpm, purchases, cost_per_purchase: cpp, purchase_roas: roas };
}

function CppBadge({ cpp, purchases, spend }: { cpp: number | null; purchases: number; spend: number }) {
  if (spend === 0) return <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>N/A</span>;
  if (purchases === 0) {
    return <span style={{ background: '#fee2e2', color: '#991b1b', padding: '0.15rem 0.5rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>No conv.</span>;
  }
  const val = cpp ?? 0;
  const bg = val < 70 ? '#dcfce7' : val <= 110 ? '#fef9c3' : '#fee2e2';
  const fg = val < 70 ? '#15803d' : val <= 110 ? '#854d0e' : '#991b1b';
  return <span style={{ background: bg, color: fg, padding: '0.15rem 0.5rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtUsd(val)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  return (
    <span style={{
      fontSize: '0.65rem',
      fontFamily: 'var(--font-mono)',
      padding: '0.15rem 0.4rem',
      borderRadius: 5,
      background: active ? '#dcfce7' : 'var(--surface2)',
      color: active ? '#15803d' : 'var(--muted)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {status}
    </span>
  );
}

function KpiGrid({ kpis }: { kpis: Kpis }) {
  const cards = [
    { label: 'Spend',            value: fmtUsd(kpis.spend) },
    { label: 'Purchases',        value: fmtInt(kpis.purchases) },
    { label: 'Cost / Purchase',  value: kpis.cost_per_purchase != null ? fmtUsd(kpis.cost_per_purchase) : 'N/A' },
    { label: 'Impressions',      value: fmtInt(kpis.impressions) },
    { label: 'CPM',              value: fmtUsd(kpis.cpm) },
    { label: 'ROAS',             value: fmtRoas(kpis.purchase_roas) },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: '1.5rem' }}>
      {cards.map(({ label, value }) => (
        <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.875rem 1rem' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.4rem' }}>{label}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function CampaignTable({ campaigns }: { campaigns: CampaignInsight[] }) {
  if (!campaigns.length) return <div style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '0.75rem 0' }}>No campaigns.</div>;
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: '1.5rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {['Campaign', 'Status', 'Spend', 'Impr.', 'CPM', 'Purch.', 'Cost/Purch.', 'ROAS'].map((h) => (
              <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: h === 'Campaign' ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, i) => (
            <tr key={c.campaign_id} style={{ borderBottom: i < campaigns.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
              <td style={{ padding: '0.6rem 0.875rem', fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaign_name}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right' }}><StatusBadge status={c.status} /></td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtUsd(c.spend)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInt(c.impressions)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtUsd(c.cpm)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInt(c.purchases)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right' }}><CppBadge cpp={c.cost_per_purchase} purchases={c.purchases} spend={c.spend} /></td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{fmtRoas(c.purchase_roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdTable({ ads }: { ads: AdInsight[] }) {
  if (!ads.length) return <div style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '0.75rem 0' }}>No ads with spend.</div>;
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: '1.5rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {['Ad', 'Status', 'Spend', 'Impr.', 'CPM', 'Purch.', 'Cost/Purch.'].map((h) => (
              <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: h === 'Ad' ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ads.map((a, i) => (
            <tr key={a.ad_id} style={{ borderBottom: i < ads.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
              <td style={{ padding: '0.6rem 0.875rem', fontWeight: 500, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.ad_name}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right' }}><StatusBadge status={a.effective_status} /></td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtUsd(a.spend)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInt(a.impressions)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtUsd(a.cpm)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtInt(a.purchases)}</td>
              <td style={{ padding: '0.6rem 0.875rem', textAlign: 'right' }}><CppBadge cpp={a.cost_per_purchase} purchases={a.purchases} spend={a.spend} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function MetaAdsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const range: MetaPreset = VALID_PRESETS.includes(searchParams.range as MetaPreset)
    ? (searchParams.range as MetaPreset)
    : 'today';

  const isToday = range === 'today';
  const nowTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  });
  const nowHour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }), 10);

  const tabLabels: { preset: MetaPreset; label: string }[] = [
    { preset: 'today',     label: 'Today' },
    { preset: 'yesterday', label: 'Yesterday' },
    { preset: 'last_3d',   label: 'Last 3 days' },
    { preset: 'last_7d',   label: 'Last 7 days' },
    { preset: 'last_30d',  label: 'Last 30 days' },
  ];

  // ── no token state ──────────────────────────────────────────────────────────
  if (!process.env.META_ACCESS_TOKEN) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <TopBar range={range} tabLabels={tabLabels} isToday={isToday} nowTime={nowTime} />
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3rem 1.5rem' }}>
          <div style={{ background: '#fffbeb', border: '1.5px solid #f59e0b', borderRadius: 14, padding: '2rem', maxWidth: 560 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.75rem', color: '#92400e' }}>Meta API not configured</div>
            <div style={{ fontSize: '0.85rem', color: '#78350f', lineHeight: 1.6 }}>
              Add these environment variables in Vercel → Settings → Environment Variables, then redeploy:
              <ul style={{ marginTop: '0.75rem', paddingLeft: '1.25rem' }}>
                <li><code>META_ACCESS_TOKEN</code> — long-lived system user token with <code>ads_read</code></li>
                <li><code>META_AD_ACCOUNT_ID</code> — <code>852673303845594</code></li>
                <li><code>META_API_VERSION</code> — <code>v21.0</code> (optional)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── fetch ───────────────────────────────────────────────────────────────────
  let campaigns: CampaignInsight[] = [];
  let fetchError: string | null = null;

  try {
    campaigns = await fetchCampaignInsights(range);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
    console.error('[meta-ads page]', fetchError);
  }

  const ascMain = campaigns.filter((c) => /asc/i.test(c.campaign_name) && !/test/i.test(c.campaign_name));
  const testing = campaigns.filter((c) => !(/asc/i.test(c.campaign_name) && !/test/i.test(c.campaign_name)));

  // Ad-level for testing campaigns
  let ads: AdInsight[] = [];
  if (testing.length > 0 && !fetchError) {
    try {
      const adArrays = await Promise.all(testing.map((c) => fetchAdInsightsForCampaign(c.campaign_id, range)));
      ads = adArrays.flat().sort((a, b) => b.spend - a.spend);
    } catch (err) {
      console.error('[meta-ads ads]', err);
    }
  }

  const ascKpis     = aggregateKpis(ascMain);
  const testingKpis = aggregateKpis(testing);

  const hasNullMetrics = campaigns.some((c) => c.purchase_roas === null || c.ctr === null || c.cpc === null);

  const noSpend = campaigns.length === 0 || campaigns.every((c) => c.spend === 0);

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>

      <TopBar range={range} tabLabels={tabLabels} isToday={isToday} nowTime={nowTime} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Error state */}
        {fetchError && (
          <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#991b1b', fontFamily: 'var(--font-mono)' }}>
            {fetchError}
          </div>
        )}

        {/* Today footnote */}
        {isToday && (
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: '1.25rem' }}>
            Note: Purchase counts may lag actual delivery by 15–30 minutes due to Meta Insights API latency.
          </div>
        )}

        {/* No spend empty state */}
        {noSpend && !fetchError && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '2.5rem', textAlign: 'center', color: 'var(--muted)', marginBottom: '2rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text)' }}>
              {isToday
                ? nowHour < 12
                  ? 'No spend yet today — Meta typically begins delivery shortly after midnight. Check back in a few minutes, or view yesterday\'s results.'
                  : 'No spend recorded yet today.'
                : 'No campaign data for this period.'}
            </div>
            {isToday && (
              <Link href="/dashboard/meta-ads?range=yesterday" style={{ display: 'inline-block', marginTop: '0.75rem', padding: '0.4rem 1rem', background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8rem', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
                View yesterday&apos;s results
              </Link>
            )}
          </div>
        )}

        {/* Note callout */}
        {hasNullMetrics && !noSpend && (
          <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#854d0e' }}>
            ROAS, CTR, CPC may show N/A if purchase value events aren&apos;t flowing through your Meta pixel.
          </div>
        )}

        {/* Main ASC section */}
        {!noSpend && (
          <>
            <SectionLabel>Main ASC</SectionLabel>
            <KpiGrid kpis={ascKpis} />
            <CampaignTable campaigns={ascMain} />

            {/* Testing section */}
            <SectionLabel>Testing</SectionLabel>
            <KpiGrid kpis={testingKpis} />

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.5rem' }}>Campaign breakdown</div>
            <CampaignTable campaigns={testing} />

            {ads.length > 0 && (
              <>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.25rem' }}>Ad-level breakdown · Testing campaign</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>{ads.length} ads with spend, sorted by spend</div>
                <AdTable ads={ads} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── TopBar (extracted so both branches share it) ──────────────────────────────

function TopBar({ range, tabLabels, isToday, nowTime }: {
  range: MetaPreset;
  tabLabels: { preset: MetaPreset; label: string }[];
  isToday: boolean;
  nowTime: string;
}) {
  return (
    <div style={{ background: 'var(--surface)', color: 'var(--text)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
            Meta Ads <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Dashboard</em>
          </h1>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)' }}>
            Account 852673303845594 · USD · Live data
          </span>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {tabLabels.map(({ preset, label }) => {
              const active = range === preset;
              return (
                <Link
                  key={preset}
                  href={`/dashboard/meta-ads?range=${preset}`}
                  style={{
                    padding: '0.3rem 0.7rem',
                    borderRadius: 7,
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    textDecoration: 'none',
                    border: '1px solid var(--border)',
                    background: active ? 'var(--accent-100)' : 'var(--neutral-100)',
                    color: active ? '#fff' : 'var(--neutral-600)',
                    fontWeight: active ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  {preset === 'today' && active && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0,
                      animation: 'pulse-dot 1.5s ease-in-out infinite',
                    }} />
                  )}
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
        <Link
          href={`/api/meta-ads?range=${range}`}
          target="_blank"
          rel="noreferrer"
          style={{ background: 'var(--neutral-100)', color: 'var(--neutral-700)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.875rem', fontSize: '0.8rem', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}
        >
          JSON
        </Link>
      </div>
      {isToday && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)' }}>
          Data through {nowTime} advertiser local time · refreshes every minute
        </div>
      )}
    </div>
  );
}
