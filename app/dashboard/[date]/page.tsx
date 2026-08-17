import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { addDays, subDays, parseISO, isValid, format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAds } from '@/lib/ads';
import { computeDerivedKPIs, memberLtv, MEMBER_LTV_VALUE } from '@/lib/business-rules';
import RevenueChart from '../_components/RevenueChart';
import {
  fmt, fmtDec, fmtPct, calcDelta,
  KpiCard, SegmentCard, StripeSegmentCard, PayPalSegmentCard, SectionLabel, TintCard,
} from '../_components/cards';

// ── page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({ params }: { params: { date: string } }) {
  const { date } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValid(parseISO(date))) {
    notFound();
  }

  const prevDate = format(subDays(parseISO(date), 1), 'yyyy-MM-dd');
  const nextDate = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
  const sevenDayStart = format(subDays(parseISO(date), 7), 'yyyy-MM-dd');

  const [
    { data: summary },
    { data: products },
    { data: memOrders },
    { data: prevSummary },
    { data: sparkRows },
    { data: segments },
    { data: stripeSnap },
    { data: prevStripeSnap },
    { data: paypalSnap },
    { data: discountRows },
    { data: countryRows },
    ads,
    prevAds,
  ] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    supabaseAdmin.from('daily_products').select('*').eq('date', date).order('revenue', { ascending: false }),
    supabaseAdmin.from('daily_membership_orders').select('*').eq('date', date).order('order_name'),
    supabaseAdmin.from('daily_summary').select('total_revenue,total_net_sales,total_orders,total_margin,total_aov,phys_cash_aov,total_profit,phys_cash_revenue,mem_revenue').eq('date', prevDate).single(),
    supabaseAdmin.from('daily_summary').select('date,total_revenue').gte('date', sevenDayStart).lt('date', date).order('date', { ascending: true }),
    supabaseAdmin.from('daily_customer_segments').select('*').eq('date', date),
    supabaseAdmin.from('stripe_daily_snapshot').select('payload').eq('date', date).single(),
    supabaseAdmin.from('stripe_daily_snapshot').select('payload').eq('date', prevDate).single(),
    supabaseAdmin.from('paypal_daily_snapshot').select('payload').eq('date', date).single(),
    supabaseAdmin.from('daily_discounts').select('*').eq('date', date).eq('product_title', 'ALL').eq('variant_title', 'ALL'),
    (supabaseAdmin as any).from('daily_countries').select('*').eq('date', date),
    fetchAds(date),
    fetchAds(prevDate),
  ]);

  if (!summary) notFound();

  const seg = (pt: string, ct: string) =>
    (segments ?? []).find((s) => s.payment_type === pt && s.customer_type === ct);
  const cashNewSeg      = seg('cash',     'new');
  const cashRetSeg      = seg('cash',     'returning');
  const nonCashNewSeg   = seg('non_cash', 'new');
  const nonCashRetSeg   = seg('non_cash', 'returning');
  const internalNewSeg  = seg('internal', 'new');
  const internalRetSeg  = seg('internal', 'returning');
  const amazonNewSeg    = seg('amazon',   'new');
  const amazonRetSeg    = seg('amazon',   'returning');

  const totalNewOrders      = (cashNewSeg?.orders ?? 0)    + (nonCashNewSeg?.orders ?? 0)    + (amazonNewSeg?.orders ?? 0);
  const totalRetOrders      = (cashRetSeg?.orders ?? 0)    + (nonCashRetSeg?.orders ?? 0)    + (amazonRetSeg?.orders ?? 0);
  const totalNewRevenue     = (cashNewSeg?.revenue ?? 0)   + (nonCashNewSeg?.revenue ?? 0)   + (amazonNewSeg?.revenue ?? 0);
  const totalRetRevenue     = (cashRetSeg?.revenue ?? 0)   + (nonCashRetSeg?.revenue ?? 0)   + (amazonRetSeg?.revenue ?? 0);
  const totalNewAov         = totalNewOrders > 0 ? totalNewRevenue / totalNewOrders : 0;
  const totalRetAov         = totalRetOrders > 0 ? totalRetRevenue / totalRetOrders : 0;
  const totalNewMargin      = totalNewRevenue > 0 ? ((totalNewRevenue - ((cashNewSeg?.cogs ?? 0) + (nonCashNewSeg?.cogs ?? 0) + (amazonNewSeg?.cogs ?? 0))) / totalNewRevenue) * 100 : 0;
  const totalRetMargin      = totalRetRevenue > 0 ? ((totalRetRevenue - ((cashRetSeg?.cogs ?? 0) + (nonCashRetSeg?.cogs ?? 0) + (amazonRetSeg?.cogs ?? 0))) / totalRetRevenue) * 100 : 0;
  const hasSegments         = (segments ?? []).length > 0;

  const cashNewCount    = cashNewSeg?.orders ?? 0;
  const cashRetCount    = cashRetSeg?.orders ?? 0;
  const nonCashNewCount = nonCashNewSeg?.orders ?? 0;
  const nonCashRetCount = nonCashRetSeg?.orders ?? 0;

  const memNew       = (memOrders ?? []).filter((m) => m.membership_type === 'new').length;
  const memRecurring = (memOrders ?? []).filter((m) => m.membership_type === 'recurring').length;

  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy');

  const physProducts = (products ?? []).filter((p) => p.item_type === 'Physical' && p.revenue > 0);
  const chartData = physProducts.map((p) => ({
    name: p.variant ? `${p.title.replace('Magic Portrait', 'Portrait')} ${p.variant}` : p.title,
    revenue: Number(p.revenue),
    netSales: Number(p.net_sales),
  }));

  const sparkData = (sparkRows ?? []).map((r) => r.total_revenue);

  // Stripe snapshot helpers
  type StripeSummary = {
    direct_success_count: number;
    direct_success_total_cents: number;
    direct_success_unique_customers: number;
    refunds_count: number;
    refunds_total_cents: number;
    failed_count: number;
    failed_total_cents: number;
    shopify_filtered_count: number;
    top_failure_reasons: { reason: string; count: number }[];
  };
  const stripeSummary = stripeSnap
    ? ((stripeSnap.payload as unknown as { summary: StripeSummary }).summary)
    : null;
  const prevStripeSummary = prevStripeSnap
    ? ((prevStripeSnap.payload as unknown as { summary: StripeSummary }).summary)
    : null;

  type PayPalSummary = {
    direct_success_count: number;
    direct_success_total_cents: number;
    direct_success_unique_customers: number;
    refunds_count: number;
    refunds_total_cents: number;
    // Added with the customer-attribution taxonomy fix. May be absent on
    // snapshots written before the migration — handle as undefined.
    excluded_internal_transfers_count?: number;
    excluded_internal_transfers_net_cents?: number;
    denied_count: number;
    denied_total_cents: number;
    shopify_filtered_count: number;
  };
  const paypalSummary = paypalSnap
    ? ((paypalSnap.payload as unknown as { summary: PayPalSummary }).summary)
    : null;

  // ── Discounts rollup (product_title=ALL, variant=ALL level) ────────────────
  type DiscountRow = { discount_code: string; orders: number; units: number; units_primary: number; net_sales: number; order_value: number };
  const dRows = (discountRows ?? []) as DiscountRow[];
  const dBlended = dRows.find(r => r.discount_code === 'ALL') ?? null;
  const dNone    = dRows.find(r => r.discount_code === '') ?? null;
  const dCodes   = dRows
    .filter(r => r.discount_code !== 'ALL' && r.discount_code !== '')
    .sort((a, b) => b.orders - a.orders);

  // ── Country-of-purchase rollup ─────────────────────────────────────────────
  type CountryRow = { country: string; orders: number; units: number; units_primary: number; net_sales: number; order_value: number };
  const cRows    = (countryRows ?? []) as CountryRow[];
  const cBlended = cRows.find(r => r.country === 'ALL') ?? null;
  const cUnknown = cRows.find(r => r.country === '') ?? null;
  const cList    = cRows
    .filter(r => r.country !== 'ALL' && r.country !== '')
    .sort((a, b) => b.orders - a.orders || b.net_sales - a.net_sales);
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const countryLabel = (code: string) => {
    try { return `${regionNames.of(code) ?? code} (${code})`; } catch { return code; }
  };

  // Derived KPIs — computed from Shopify summary + Stripe + Ads
  // summary is a flat DB row; build the minimal ProcessedDay-compatible shape for the helper
  const productOrders = (summary.phys_cash_orders ?? 0) + (summary.phys_non_cash_orders ?? 0) + (summary.amazon_orders ?? 0);

  // New-member LTV: each new membership signup credited MEMBER_LTV_VALUE.
  // Headline "GP + LTV − Ads" = gross profit + new-member LTV − ad spend.
  // (adCost comes from `derived`, defined below.)
  const dayLtv = memberLtv(memNew);

  const summaryAsProcessed = {
    total:      { revenue: summary.total_revenue,     profit: summary.total_profit,     orders: summary.total_orders },
    physCash:   { revenue: summary.phys_cash_revenue  },
    membership: { revenue: summary.mem_revenue        },
  } as Parameters<typeof computeDerivedKPIs>[0];

  const derived = computeDerivedKPIs(
    summaryAsProcessed,
    ads?.spend ?? null,
    ads?.purchases ?? null,
    stripeSummary?.direct_success_total_cents ?? null,
    stripeSummary?.refunds_total_cents        ?? null,
    productOrders,
  );

  // Headline: gross profit + new-member LTV − ad spend.
  const gpLtvMinusAds = summary.total_profit + dayLtv - derived.adCost;

  const prevDerived = prevSummary ? computeDerivedKPIs(
    {
      total:      { revenue: prevSummary.total_revenue, profit: prevSummary.total_profit ?? 0, orders: prevSummary.total_orders ?? 0 },
      physCash:   { revenue: prevSummary.phys_cash_revenue ?? 0 },
      membership: { revenue: prevSummary.mem_revenue       ?? 0 },
    } as Parameters<typeof computeDerivedKPIs>[0],
    prevAds?.spend    ?? null,
    prevAds?.purchases ?? null,
    prevStripeSummary?.direct_success_total_cents ?? null,
    prevStripeSummary?.refunds_total_cents        ?? null,
  ) : null;

  const cpaDelta = derived.cpaAd !== null && prevDerived?.cpaAd != null
    ? calcDelta(derived.cpaAd, prevDerived.cpaAd)
    : null;
  const cpaBlendedDelta = derived.cpaBlended !== null && prevDerived?.cpaBlended != null
    ? calcDelta(derived.cpaBlended, prevDerived.cpaBlended)
    : null;

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        borderBottom: '1px solid var(--border)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
            Daily Sales <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Dashboard</em>
          </h1>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link href={`/dashboard/${prevDate}`} style={{ color: 'var(--neutral-600)', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.5rem', borderRadius: 6 }} title="Previous day">‹</Link>
            <span style={{ fontSize: '0.9rem', color: 'var(--neutral-800)', fontWeight: 500, minWidth: 210, textAlign: 'center' }}>{displayDate}</span>
            <Link href={`/dashboard/${nextDate}`} style={{ color: 'var(--neutral-600)', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.5rem', borderRadius: 6 }} title="Next day">›</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link
            href="/dashboard/history"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-700)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            History
          </Link>
          <Link
            href="/dashboard/range"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-700)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Range
          </Link>
          <a
            href={`/api/export/${date}/jpg`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-700)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            JPG
          </a>
          <a
            href={`/api/export/${date}/pdf`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-700)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            PDF
          </a>
          <a
            href={`/api/dashboard/${date}`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: 'var(--neutral-100)',
              color: 'var(--neutral-800)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            JSON
          </a>
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .segments-row { flex-direction: column !important; }
        }
      `}</style>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── TOTAL KPIs ──────────────────────────────────────────────────── */}
        <SectionLabel>Total Business</SectionLabel>

        {/* Row 1 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}>
          <KpiCard
            label="Total Revenue"
            info={"Net Sales + Shipping across all Shopify orders for the day (Pacific-time reporting day).\nNet Sales = line-item price after discounts. Includes Cash, Non-Cash, Membership and Amazon segments."}
            value={fmt(summary.total_revenue)}
            sub={`${summary.total_orders} orders · ${productOrders} product · ${summary.total_qty} units`}
            delta={calcDelta(summary.total_revenue, prevSummary?.total_revenue)}
            sparkData={sparkData}
          />
          <KpiCard
            label="Gross Profit"
            info={"Total Revenue − COGS.\nCOGS = Shopify's 'Cost per item' on each variant × quantity. Variants with no cost set (e.g. membership) count as $0 cost. Shipping charges count as revenue with no shipping cost deducted."}
            value={fmt(summary.total_profit)}
          />
          <KpiCard
            label="GP + LTV − Ads"
            info={"Gross Profit + new-member LTV − Meta ad spend.\nLTV = new membership signups × $70 assumed lifetime value. One combined view of today's profit including the future value of new members, net of advertising."}
            value={fmt(gpLtvMinusAds)}
            sub={`+ ${fmt(dayLtv)} LTV (${memNew}×$${MEMBER_LTV_VALUE}) − ${fmt(derived.adCost)} ads`}
          />
          <KpiCard
            label="Margin"
            info={"Gross Profit ÷ Total Revenue."}
            value={fmtPct(summary.total_margin)}
            delta={calcDelta(summary.total_margin, prevSummary?.total_margin)}
          />
          <KpiCard
            label="AOV"
            info={"Average order value: Total Revenue ÷ total orders."}
            value={fmtDec(summary.total_aov)}
            delta={calcDelta(summary.total_aov, prevSummary?.total_aov)}
          />
        </div>

        {/* Row 2 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
          marginTop: 10,
          marginBottom: '2rem',
        }}>
          {/* Cash In */}
          <TintCard
            label="Cash In"
            info={"Actual money received today:\nCash-segment revenue + Membership revenue + Stripe net (direct charges − refunds).\nExcludes Non-Cash (store-credit) and Amazon orders."}
            value={fmt(derived.cashIn)}
            sub="Shopify + Members + Stripe"
            bg="var(--accent2-100)" border="transparent" textColor="var(--accent2-900)" subColor="var(--accent2-700)"
          />
          {/* Ad Cost */}
          <TintCard
            label="Ad Cost"
            info={"Meta (Facebook/Instagram) ad spend for the day, from the Meta Ads API, with Meta-attributed purchase count."}
            value={derived.adCost > 0 ? fmt(derived.adCost) : '—'}
            sub={ads ? `Meta · ${ads.purchases} purch.` : 'No data'}
            bg="var(--accent-100)" border="transparent" textColor="var(--accent-900)" subColor="var(--accent-700)"
          />
          {/* CPA — Ad */}
          <TintCard
            label="CPA — Ad"
            info={"Cost per acquisition, attributed:\nAd Cost ÷ Meta-attributed purchases."}
            value={derived.cpaAd !== null ? fmtDec(derived.cpaAd) : '—'}
            sub="attributed orders"
            bg="var(--accent-100)" border="transparent" textColor="var(--accent-900)" subColor="var(--accent-700)"
            delta={derived.cpaAd !== null ? { pct: cpaDelta, inverted: true } : undefined}
          />
          {/* CPA — Blended */}
          <TintCard
            label="CPA — Blended"
            info={"Cost per acquisition, blended:\nAd Cost ÷ ALL physical product orders (Cash + Non-Cash + Amazon), regardless of ad attribution."}
            value={derived.cpaBlended !== null ? fmtDec(derived.cpaBlended) : '—'}
            sub={`${productOrders} product orders`}
            bg="var(--accent-100)" border="transparent" textColor="var(--accent-900)" subColor="var(--accent-700)"
            delta={derived.cpaBlended !== null ? { pct: cpaBlendedDelta, inverted: true } : undefined}
          />
          {/* Daily Profit */}
          <TintCard
            label="GP − Ads"
            info={"Gross Profit − Ad Cost. Today's profit after advertising, before the LTV credit."}
            value={derived.dailyProfit < 0
              ? `−${fmt(Math.abs(derived.dailyProfit))}`
              : fmt(derived.dailyProfit)}
            sub="GP − ad spend"
            bg="var(--neutral-200)" border="transparent"
            textColor={derived.dailyProfit < 0 ? 'var(--accent-700)' : 'var(--neutral-900)'}
            subColor="var(--neutral-700)"
          />
        </div>

        {/* ── SALES SEGMENTS ──────────────────────────────────────────────── */}
        <SectionLabel>Sales Segments</SectionLabel>
        <div className="segments-row" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          <SegmentCard
            theme="cash"
            title="Cash"
            info={"Physical product orders paid with a real payment gateway (the order's dominant gateway is anything other than Shopify store credit).\nRevenue = net sales + shipping. $0-revenue orders (comps/redos) are shown separately as Internal, not here."}
            revenue={summary.phys_cash_revenue}
            netSales={summary.phys_cash_net_sales}
            shipping={summary.phys_cash_shipping}
            cogs={summary.phys_cash_cogs}
            profit={summary.phys_cash_profit}
            margin={summary.phys_cash_margin}
            orders={summary.phys_cash_orders}
            qty={summary.phys_cash_qty}
            aov={summary.phys_cash_aov}
            breakdownLabel={`${cashNewCount} new · ${cashRetCount} returning`}
          />
          <SegmentCard
            theme="noncash"
            title="Non-Cash"
            info={"Physical product orders paid mostly with Shopify STORE CREDIT (the order's dominant payment gateway is shopify_store_credit).\nNo new money changes hands, so this segment is excluded from Cash In."}
            revenue={summary.phys_non_cash_revenue}
            netSales={summary.phys_non_cash_net_sales}
            shipping={summary.phys_non_cash_shipping}
            cogs={summary.phys_non_cash_cogs}
            profit={summary.phys_non_cash_profit}
            margin={summary.phys_non_cash_margin}
            orders={summary.phys_non_cash_orders}
            qty={summary.phys_non_cash_qty}
            aov={summary.phys_non_cash_aov}
            breakdownLabel={`${nonCashNewCount} new · ${nonCashRetCount} returning`}
          />
          <SegmentCard
            theme="membership"
            title="Membership"
            info={"Orders whose line-item title matches Membership/VIP.\nNew = first billing, Recurring = renewals. No 'Cost per item' is set on membership, so COGS is $0 and margin shows 100%."}
            revenue={summary.mem_revenue}
            netSales={summary.mem_net_sales}
            shipping={summary.mem_shipping}
            cogs={summary.mem_cogs}
            profit={summary.mem_profit}
            margin={summary.mem_margin}
            orders={summary.mem_orders}
            qty={summary.mem_qty}
            aov={summary.mem_aov}
            breakdownLabel={(memOrders ?? []).length > 0 ? `New: ${memNew} · Recurring: ${memRecurring}` : undefined}
          />
          {/* Amazon channel — rendered when there is activity. Older daily_summary
              rows (written before the amazon_* columns existed) will have null/0
              for these fields, so the card stays hidden. Cast: lib/types/database.ts
              hasn't been regenerated since the migration. */}
          {(() => {
            const s = summary as any; // amazon_* columns added in migration 0013
            const amzOrders = Number(s.amazon_orders ?? 0);
            if (amzOrders <= 0) return null;
            return (
              <SegmentCard
                theme="amazon"
                title="Amazon"
                info={"Orders whose Shopify sourceName is 'amazon' (Codisto Marketplace Connect). Kept separate from Cash/Non-Cash and excluded from Cash In."}
                revenue={Number(s.amazon_revenue ?? 0)}
                netSales={Number(s.amazon_net_sales ?? 0)}
                shipping={Number(s.amazon_shipping ?? 0)}
                cogs={Number(s.amazon_cogs ?? 0)}
                profit={Number(s.amazon_profit ?? 0)}
                margin={Number(s.amazon_margin ?? 0)}
                orders={amzOrders}
                qty={Number(s.amazon_qty ?? 0)}
                aov={Number(s.amazon_aov ?? 0)}
              />
            );
          })()}
          {stripeSummary && (
            <StripeSegmentCard
              info={"Stripe direct charges for the day, from the daily Stripe snapshot.\nNet = gross successful charges − refunds. This is payment-processor money, separate from Shopify order revenue; its net feeds into Cash In."}
              grossCents={stripeSummary.direct_success_total_cents}
              refundCents={stripeSummary.refunds_total_cents}
              charges={stripeSummary.direct_success_count}
              refunds={stripeSummary.refunds_count}
              uniqueCustomers={stripeSummary.direct_success_unique_customers}
            />
          )}
          {paypalSummary && (
            <PayPalSegmentCard
              info={"PayPal transactions for the day, from the daily PayPal snapshot.\nNet = gross successful transactions − refunds. Internal balance movements (payouts to bank, transfers, currency conversions) are excluded and noted at the bottom of the card."}
              grossCents={paypalSummary.direct_success_total_cents}
              refundCents={paypalSummary.refunds_total_cents}
              transactions={paypalSummary.direct_success_count}
              refunds={paypalSummary.refunds_count}
              uniqueCustomers={paypalSummary.direct_success_unique_customers}
              excludedTransfersCount={paypalSummary.excluded_internal_transfers_count}
              excludedTransfersNetCents={paypalSummary.excluded_internal_transfers_net_cents}
            />
          )}
        </div>

        {/* ── CUSTOMER MIX ────────────────────────────────────────────────── */}
        {hasSegments && (
          <div className="desktop-only">
            <SectionLabel>Customer Mix</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1.5px solid var(--accent)',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              {/* Stat tiles */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'New Orders',      value: String(totalNewOrders),    accent: '#1d4ed8' },
                  { label: 'New Revenue',      value: fmt(totalNewRevenue),      accent: '#1d4ed8' },
                  { label: 'New AOV',          value: fmtDec(totalNewAov),       accent: '#1d4ed8' },
                  { label: 'New Margin',       value: fmtPct(totalNewMargin),    accent: '#1d4ed8' },
                  { label: 'Returning Orders', value: String(totalRetOrders),    accent: '#6b7280' },
                  { label: 'Returning Revenue',value: fmt(totalRetRevenue),      accent: '#6b7280' },
                  { label: 'Returning AOV',    value: fmtDec(totalRetAov),       accent: '#6b7280' },
                  { label: 'Returning Margin', value: fmtPct(totalRetMargin),    accent: '#6b7280' },
                ].map(({ label, value, accent: ac }) => (
                  <div key={label} style={{ textAlign: 'center', minWidth: 90 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: ac, marginBottom: '0.25rem' }}>{label}</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: ac }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Breakdown table: cash × non-cash × new/returning */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Segment', 'Type', 'Orders', 'Revenue', 'Net Sales', 'Margin', 'AOV'].map((h) => (
                      <th key={h} style={{
                        padding: '0.5rem 0.75rem',
                        textAlign: h === 'Segment' || h === 'Type' ? 'left' : 'right',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: 'var(--muted)',
                        fontWeight: 500,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = [
                      { seg: 'Cash',     ct: 'new',       s: cashNewSeg,     payAccent: 'var(--cash-blue-dark)', ctAccent: '#1d4ed8' },
                      { seg: 'Cash',     ct: 'returning',  s: cashRetSeg,     payAccent: 'var(--cash-blue-dark)', ctAccent: '#6b7280' },
                      { seg: 'Non-Cash', ct: 'new',       s: nonCashNewSeg,  payAccent: 'var(--nc-green-dark)',  ctAccent: '#1d4ed8' },
                      { seg: 'Non-Cash', ct: 'returning',  s: nonCashRetSeg,  payAccent: 'var(--nc-green-dark)',  ctAccent: '#6b7280' },
                      { seg: 'Internal', ct: 'new',       s: internalNewSeg, payAccent: '#92400e',               ctAccent: '#1d4ed8' },
                      { seg: 'Internal', ct: 'returning',  s: internalRetSeg, payAccent: '#92400e',               ctAccent: '#6b7280' },
                      ...(amazonNewSeg || amazonRetSeg ? [
                        { seg: 'Amazon', ct: 'new',       s: amazonNewSeg,   payAccent: '#B26B00',               ctAccent: '#1d4ed8' },
                        { seg: 'Amazon', ct: 'returning',  s: amazonRetSeg,   payAccent: '#B26B00',               ctAccent: '#6b7280' },
                      ] : []),
                    ];
                    return rows.map(({ seg, ct, s, payAccent, ctAccent }, i) => (
                      <tr key={`${seg}-${ct}`} style={{ borderBottom: i < rows.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: payAccent, fontWeight: 500 }}>{seg}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <span style={{
                            fontSize: '0.65rem',
                            fontFamily: 'var(--font-mono)',
                            padding: '0.15rem 0.4rem',
                            borderRadius: 5,
                            background: ct === 'new' ? 'var(--accent2-200)' : 'var(--neutral-200)',
                            color: ctAccent,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}>{ct}</span>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s?.orders ?? 0}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtDec(s?.revenue ?? 0)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtDec(s?.net_sales ?? 0)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtPct(s?.margin ?? 0)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtDec(s?.aov ?? 0)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── STRIPE ──────────────────────────────────────────────────────── */}
        {stripeSummary && (
          <div className="desktop-only">
            <SectionLabel>Stripe Payments</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1.5px solid #6366f1',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {/* Successful */}
                <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#15803d', marginBottom: '0.5rem' }}>Successful (direct)</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#15803d', marginBottom: '0.25rem' }}>
                    {fmt(stripeSummary.direct_success_total_cents / 100)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#166534' }}>
                    {stripeSummary.direct_success_count} charges · {stripeSummary.direct_success_unique_customers} customers
                  </div>
                </div>
                {/* Refunds */}
                <div style={{ background: '#fffbeb', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fde68a' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', marginBottom: '0.5rem' }}>Refunds</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b45309', marginBottom: '0.25rem' }}>
                    {fmt(stripeSummary.refunds_total_cents / 100)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                    {stripeSummary.refunds_count} refunds
                  </div>
                </div>
                {/* Failed */}
                <div style={{ background: '#fef2f2', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fecaca' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#dc2626', marginBottom: '0.5rem' }}>Failed charges</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                    {stripeSummary.failed_count}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#991b1b' }}>
                    {fmt(stripeSummary.failed_total_cents / 100)} attempted
                  </div>
                </div>
              </div>

              {/* Top failure reasons */}
              {stripeSummary.top_failure_reasons.length > 0 && (
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.5rem' }}>Top Decline Reasons</div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {stripeSummary.top_failure_reasons.map(({ reason, count }) => (
                      <div key={reason} style={{
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '0.3rem 0.65rem',
                        fontSize: '0.75rem',
                        display: 'flex',
                        gap: '0.4rem',
                        alignItems: 'center',
                      }}>
                        <span style={{ fontWeight: 700, color: '#dc2626', fontFamily: 'var(--font-mono)' }}>{count}×</span>
                        <span style={{ color: 'var(--fg)' }}>{reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {stripeSummary.shopify_filtered_count} Shopify-originated charges excluded
              </div>
            </div>
          </div>
        )}

        {/* ── PAYPAL ──────────────────────────────────────────────────────── */}
        {paypalSummary && (
          <div className="desktop-only">
            <SectionLabel>PayPal Payments</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1.5px solid #003087',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                {/* Successful */}
                <div style={{ background: '#e8f0fe', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #b3c6f7' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#003087', marginBottom: '0.5rem' }}>Successful (direct)</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#003087', marginBottom: '0.25rem' }}>
                    {fmt(paypalSummary.direct_success_total_cents / 100)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#001f5b' }}>
                    {paypalSummary.direct_success_count} transactions · {paypalSummary.direct_success_unique_customers} customers
                  </div>
                </div>
                {/* Refunds */}
                <div style={{ background: '#fffbeb', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fde68a' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', marginBottom: '0.5rem' }}>Refunds</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b45309', marginBottom: '0.25rem' }}>
                    {fmt(paypalSummary.refunds_total_cents / 100)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                    {paypalSummary.refunds_count} refunds
                  </div>
                </div>
                {/* Denied */}
                <div style={{ background: '#fef2f2', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fecaca' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#dc2626', marginBottom: '0.5rem' }}>Denied</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                    {paypalSummary.denied_count}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#991b1b' }}>
                    {fmt(paypalSummary.denied_total_cents / 100)} attempted
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {paypalSummary.shopify_filtered_count} Shopify-routed PayPal transactions excluded · PayPal totals not included in Cash In
              </div>
            </div>
          </div>
        )}

        {/* ── META ADS ────────────────────────────────────────────────────── */}
        {ads && (
          <div className="desktop-only">
            <SectionLabel>Meta Advertising</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1.5px solid #3b82f6',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
                {[
                  { label: 'Ad Spend',   value: fmt(ads.spend),                    accent: '#1d4ed8' },
                  { label: 'Purchases',  value: String(ads.purchases),              accent: '#15803d' },
                  { label: 'CPA',        value: fmtDec(ads.cpa),                   accent: '#b45309' },
                  { label: 'Link Clicks',value: String(ads.link_clicks ?? '—'),     accent: '#6b7280' },
                ].map(({ label, value, accent }) => (
                  <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '0.875rem 1rem', border: '1px solid var(--border)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: accent, marginBottom: '0.4rem' }}>{label}</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: accent }}>{value}</div>
                  </div>
                ))}
              </div>
              {/* Funnel metrics */}
              <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Funnel</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--muted)' }}>Click → ATC</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#1d4ed8' }}>
                    {ads.click_to_atc != null ? `${(ads.click_to_atc * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)' }}>→</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--muted)' }}>ATC → Purchase</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#15803d' }}>
                    {ads.atc_to_purchase != null ? `${(ads.atc_to_purchase * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
                {ads.atcs != null && (
                  <>
                    <div style={{ color: 'var(--muted)' }}>·</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{ads.atcs} ATCs</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── DISCOUNTS ───────────────────────────────────────────────────── */}
        {dRows.length > 0 && dBlended && (
          <>
            <SectionLabel>Discounts</SectionLabel>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: '2rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Discount Code', '% of Orders', 'Orders', 'Units', 'U/O', 'Net $', 'AOV'].map((h, i) => (
                      <th key={h} style={{ padding: '0.7rem 1rem', textAlign: i === 0 ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'BLENDED (all orders)', row: dBlended, bold: true },
                    ...dCodes.map(r => ({ label: r.discount_code, row: r, bold: false })),
                    ...(dNone ? [{ label: 'No discount', row: dNone, bold: false }] : []),
                  ].map(({ label, row, bold }, i, arr) => {
                    const share = dBlended.orders > 0 ? (row.orders / dBlended.orders) * 100 : 0;
                    const uo    = row.orders > 0 ? row.units_primary / row.orders : 0;
                    const aov   = row.orders > 0 ? row.order_value / row.orders : 0;
                    return (
                      <tr key={label} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: bold ? 'var(--surface2)' : 'transparent' }}>
                        <td style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 500 }}>{label}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{bold ? '100%' : `${share.toFixed(0)}%`}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 400 }}>{row.orders}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{row.units_primary}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{uo.toFixed(1)}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{fmt(row.net_sales)}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{fmtDec(aov)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border)', fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                Rows can overlap when orders carry multiple discounts · Units counts Magic Portrait items only · Net $ = net sales of matching lines · AOV = full order value ÷ orders
              </div>
            </div>
          </>
        )}

        {/* ── COUNTRY OF PURCHASE ─────────────────────────────────────────── */}
        {cRows.length > 0 && cBlended && (
          <>
            <SectionLabel>Country of Purchase</SectionLabel>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: '2rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Country', '% of Orders', 'Orders', 'Units', 'U/O', 'Net $', 'AOV'].map((h, i) => (
                      <th key={h} style={{ padding: '0.7rem 1rem', textAlign: i === 0 ? 'left' : 'right', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'ALL COUNTRIES', row: cBlended, bold: true },
                    ...cList.map(r => ({ label: countryLabel(r.country), row: r, bold: false })),
                    ...(cUnknown ? [{ label: 'No address', row: cUnknown, bold: false }] : []),
                  ].map(({ label, row, bold }, i, arr) => {
                    const share = cBlended.orders > 0 ? (row.orders / cBlended.orders) * 100 : 0;
                    const uo    = row.orders > 0 ? row.units_primary / row.orders : 0;
                    const aov   = row.orders > 0 ? row.order_value / row.orders : 0;
                    return (
                      <tr key={label} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', background: bold ? 'var(--surface2)' : 'transparent' }}>
                        <td style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 500 }}>{label}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{bold ? '100%' : `${share.toFixed(0)}%`}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: bold ? 700 : 400 }}>{row.orders}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{row.units_primary}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{uo.toFixed(1)}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{fmt(row.net_sales)}</td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{fmtDec(aov)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border)', fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                Country = shipping address (billing as fallback) · Units counts Magic Portrait items only · Net $ = net sales of the country&apos;s lines · AOV = full order value ÷ orders
              </div>
            </div>
          </>
        )}

        {/* ── PRODUCTS TABLE ──────────────────────────────────────────────── */}
        <div className="desktop-only">
        <SectionLabel>Products</SectionLabel>
        <div style={{
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          marginBottom: '2rem',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                {['Product', 'Variant', 'Type', 'Qty', 'Orders', 'Net Sales', 'Shipping', 'COGS', 'Revenue'].map((h) => (
                  <th key={h} style={{
                    padding: '0.75rem 1rem',
                    textAlign: h === 'Product' || h === 'Variant' || h === 'Type' ? 'left' : 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.65rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    color: 'var(--muted)',
                    fontWeight: 500,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p, i) => (
                <tr key={p.id} style={{
                  borderBottom: i < (products ?? []).length - 1 ? '1px solid var(--border)' : 'none',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                }}>
                  <td style={{ padding: '0.625rem 1rem', fontWeight: 500 }}>{p.title}</td>
                  <td style={{ padding: '0.625rem 1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>{p.variant ?? '—'}</td>
                  <td style={{ padding: '0.625rem 1rem' }}>
                    <span style={{
                      fontSize: '0.65rem',
                      fontFamily: 'var(--font-mono)',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 5,
                      background: p.item_type === 'Physical' ? 'var(--accent2-200)' : p.item_type === 'Membership' ? 'var(--accent-200)' : 'var(--neutral-200)',
                      color: p.item_type === 'Physical' ? 'var(--accent2-900)' : p.item_type === 'Membership' ? 'var(--accent-900)' : 'var(--neutral-800)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>{p.item_type}</span>
                  </td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.qty}</td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.orders}</td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtDec(p.net_sales)}</td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{fmtDec(p.shipping)}</td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{fmtDec(p.cogs)}</td>
                  <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtDec(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        {/* ── REVENUE CHART ───────────────────────────────────────────────── */}
        {chartData.length > 0 && (
          <div className="desktop-only">
            <SectionLabel>Revenue by Product</SectionLabel>
            <div style={{
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1px solid var(--border)',
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <RevenueChart data={chartData} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
