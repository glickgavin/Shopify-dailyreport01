# Shopify Daily Report — Architecture

## Production

- **URL:** https://shopifydailyreport01.vercel.app
- **Cron schedule:** `0 15 * * *` UTC = 7:00 AM PST / 8:00 AM PDT
- **Cron route:** `GET /api/cron/daily` (Bearer token auth via `CRON_SECRET`)
- **First successful run:** 2026-05-03

---

## Overview

Automated system that fetches yesterday's Shopify orders every morning,
processes them through business rules, persists to Supabase, renders an
interactive web dashboard, and posts a Block Kit summary to Slack.

---

## System Diagram

```
Vercel Cron (15:00 UTC daily)
        │
        ▼
GET /api/cron/daily   ← Authorization: Bearer CRON_SECRET
        │
        ├─► lib/queries/orders.ts     Shopify Admin GraphQL API
        │       Orders query with pagination (250/page)
        │       Date range: yesterday 00:00–23:59 in STORE_TIMEZONE
        │
        ├─► lib/business-rules.ts     Apply business rules
        │       - Classify items: Physical vs Membership
        │       - Classify payments: Cash vs Non-Cash (store credit)
        │       - Aggregate: total, physCash, physNonCash, membership blocks
        │       - Product-level aggregation with order counts
        │
        ├─► lib/persistence.ts        Supabase (Postgres)
        │       Upsert: daily_summary (idempotent on date conflict)
        │       Delete+insert: daily_products, daily_membership_orders
        │       Append: raw_data (audit log, never deleted)
        │
        ├─► lib/slack.ts              Slack Web API (chat.postMessage)
        │       Block Kit: date header, KPI fields, Cash/Non-Cash sections,
        │       membership summary, prev-day deltas, action buttons
        │
        └─► Return 200 JSON { status, date, summary }
```

---

## Data Flow

### 1. Fetch (Shopify Admin GraphQL API)
- Query: `orders` with `first: 250, after: $cursor` for pagination
- Filter: `created_at >= start AND created_at <= end AND financial_status:paid`
- Date range built from `STORE_TIMEZONE` using `date-fns-tz` offset calculation
- Fields: name, createdAt, paymentGatewayNames, totalPriceSet, totalRefundedSet,
  shippingLines, lineItems (with originalTotalSet, discountAllocations, variant.unitCost)

### 2. Transform (Business Rules)
- **Item type:** title matching `/membership|vip/i` → Membership, else Physical
- **Payment group:** dominant gateway; `shopify_store_credit` → Non-Cash, else Cash
- **Net sales per line:** `originalTotalSet − sum(discountAllocations)` (captures order-level discounts)
- **Shipping:** prorated to each line by revenue share
- **COGS:** `unitCost × quantity`
- **Revenue:** `netSales + shipping`
- **Margin:** `(revenue − cogs) / revenue × 100`

### 3. Store (Supabase)

#### Tables
| Table | Purpose |
|---|---|
| `daily_summary` | One row per date; all KPI blocks (total, physCash, physNonCash, membership) |
| `daily_products` | Per-product aggregates for the date |
| `daily_membership_orders` | Per-order detail for membership orders |
| `raw_data` | Full order + payment row JSON (append-only audit log) |
| `job_logs` | Reserved for future run logging |

#### Strategy
- `daily_summary`: upsert on `date` conflict — safe to re-run
- `daily_products` + `daily_membership_orders`: delete-then-insert per date
- `raw_data`: append only, never overwritten

### 4. Dashboard (Next.js 14 App Router)

- `/` — homepage with links to dashboard, history, admin
- `/dashboard` → redirects to yesterday's date
- `/dashboard/[date]` — server component; dark top bar with prev/next nav,
  6-KPI grid, Physical Cash + Non-Cash segment cards, products table,
  membership card, Recharts bar chart
- `/api/dashboard/[date]` — JSON API returning same data
- `RevenueChart.tsx` — `"use client"` Recharts component

### 5. Slack Notification

- `@slack/web-api` WebClient — `chat.postMessage` to `SLACK_CHANNEL_ID`
- Block Kit layout: header, KPI fields (4-up), divider, Cash section,
  Non-Cash section, divider, membership summary, prev-day delta context,
  View Dashboard + Export PDF action buttons
- Set `DRY_RUN=true` to log payload instead of sending

---

## Scheduling

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 15 * * *" }]
}
```

`15:00 UTC` = 7:00 AM PST (UTC−8) / 8:00 AM PDT (UTC−7).  
**DST note:** the run shifts by 1 hour during daylight saving. Update the cron
expression to `0 14 * * *` from mid-March to early November if 7:00 AM PDT
is required exactly.

---

## Environment Variables

| Variable | Where used |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | Shopify OAuth token fetch |
| `SHOPIFY_CLIENT_ID` | Shopify OAuth |
| `SHOPIFY_CLIENT_SECRET` | Shopify OAuth |
| `SHOPIFY_API_VERSION` | GraphQL endpoint |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin client (server only) |
| `SLACK_BOT_TOKEN` | Slack Web API |
| `SLACK_CHANNEL_ID` | Target Slack channel |
| `CRON_SECRET` | Protects `/api/cron/daily` |
| `STORE_TIMEZONE` | e.g. `America/Los_Angeles` |
| `DRY_RUN` | `true` = log Slack payload, don't send |
| `NEXT_PUBLIC_APP_URL` | Dashboard base URL in Slack links |

---

## File Structure

```
/
├── app/
│   ├── layout.tsx                       # DM Sans, DM Mono fonts + CSS vars
│   ├── page.tsx                         # Homepage
│   ├── globals.css                      # Design tokens
│   ├── dashboard/
│   │   ├── page.tsx                     # Redirect → yesterday
│   │   └── [date]/
│   │       ├── page.tsx                 # Main dashboard server component
│   │       └── RevenueChart.tsx         # Recharts client component
│   └── api/
│       ├── cron/daily/route.ts          # Vercel Cron handler
│       ├── dashboard/[date]/route.ts    # JSON API
│       ├── test-pipeline/route.ts       # Manual pipeline trigger
│       └── debug-token/route.ts         # Shopify token debug
├── lib/
│   ├── shopify.ts                       # OAuth token + GraphQL client
│   ├── supabase.ts                      # Anon + service-role clients
│   ├── slack.ts                         # Block Kit message builder
│   ├── business-rules.ts                # processDay() transform
│   ├── persistence.ts                   # saveDay() Supabase writes
│   ├── queries/
│   │   ├── orders.ts                    # fetchOrdersForDate()
│   │   └── payments.ts
│   └── types/
│       └── database.ts                  # Supabase Database type
├── scripts/
│   ├── backfill.ts                      # --start / --end date range backfill
│   ├── run-daily.ts                     # Local pipeline + Slack (no HTTP)
│   ├── test-pipeline.ts                 # Pipeline test (no Slack)
│   ├── test-slack.ts                    # Slack connectivity test
│   └── verify-supabase.ts              # Query all tables for a date
├── supabase/
│   └── migrations/
│       └── 0001_init.sql               # All 5 tables + RLS + triggers
├── docs/
│   └── architecture.md                  # ← this file
├── vercel.json                          # Cron schedule
├── next.config.mjs
├── tsconfig.json
└── package.json
```

---

## Local Development

```bash
pnpm install
pnpm dev

# Trigger pipeline manually (no cron wait)
npx tsx scripts/run-daily.ts --date=2026-05-01

# Backfill historical data
npx tsx scripts/backfill.ts --start=2026-04-19 --end=2026-05-01

# Test Slack connectivity
npx tsx scripts/test-slack.ts
```

---

## Deployment Checklist

- [x] GitHub repo: `glickgavin/Shopify-dailyreport01`
- [x] Vercel project linked, all env vars set
- [x] `vercel.json` cron schedule configured
- [x] Supabase migration applied (`0001_init.sql`)
- [x] Slack app created, `chat:write` scope, bot added to `#daily-sales-report`
- [x] Shopify OAuth app created, scopes granted
- [x] First manual cron run verified end-to-end

---

## Membership Pipeline

### Overview

VIP Membership subscriptions (`$9.99 intro → $39.99/mo`) are tracked through a
three-layer pipeline that runs daily at 07:20 UTC (5 minutes after the main cron):

```
Vercel Cron (07:20 UTC daily)
        │
        ▼
GET /api/cron/membership-daily
        │
        ├─► Step 1 – sync      lib/membership-sync.ts
        │       Fetch yesterday's Shopify orders, detect membership charges,
        │       upsert into membership_billing_events.
        │
        ├─► Step 2 – snapshot  lib/membership-status.ts
        │       Derive each member's current status from all events to date,
        │       write one row per member into membership_status_snapshots.
        │
        ├─► Step 3 – metrics   lib/membership-metrics.ts
        │       Compute cohort triangle, survival curve, LTV, churn; upsert
        │       one row for today into membership_metrics_daily.
        │
        └─► Step 4 – alerts    lib/membership-alerts.ts
                Flag if active_members swings >30% day-over-day or MRR = $0.
                Writes to job_logs (job_type = 'membership_alert') + Slack.
```

### Three Data Layers

| Layer | Table | Append-only? | Notes |
|---|---|---|---|
| Raw events | `membership_billing_events` | Yes | One row per Shopify billing charge; upserted on `(customer_id, charged_at)` |
| Daily snapshots | `membership_status_snapshots` | Yes (one row per member per snapshot date) | Derived status at that point in time |
| Daily metrics | `membership_metrics_daily` | No (upserted on `metric_date`) | Recomputed from all events each run |

**Why the snapshot layer cannot be backfilled after the fact:**
`membership_status_snapshots` captures each member's status as of the snapshot
date by replaying all billing events up to (but not beyond) that date. Running the
snapshot for a past date today would use today's event set — including events that
didn't exist on that past date — producing incorrect "as-of" status. The snapshot
is therefore append-only: past rows are never re-written, and missing dates cannot
be reconstructed accurately from the current event set alone.

### Membership-Charge Detection Rule

A Shopify line item is classified as a membership billing event when both conditions hold:

```
title matches /VIP Membership/i   AND   amount > 0
```

Source: `lib/queries/orders.ts` → `membershipBillingRows` filter.

- `is_intro = true` when the line item's price matches the intro price (`$9.99`);
  `false` for all recurring charges (`$39.99`).
- Refunds (`amount ≤ 0`) are excluded from billing events; they are logged in
  `daily_summary` via the standard order pipeline.

### Survival-Based LTV Method

LTV is computed in two variants, both derived from the empirical cohort retention triangle:

**Conservative LTV** — empirical curve only, no extrapolation:
```
LTV_conservative = Σ(k=0..K) survival[k] × price(k)
```
where `survival[k]` = fraction of original cohort still active at month *k*,
`price(0)` = intro price, `price(k≥1)` = recurring price, and *K* is the last
observed month with data.

**Projected LTV** — empirical curve + geometric tail:
```
LTV_projected = LTV_conservative + survival[K] × tail_retention^1/(1−tail_retention) × recurring_price
```
The tail adds the expected value of all future months assuming members who survive
past the observed window churn at a constant `tail_retention` rate per month.

**Adjusting the tail-retention assumption:**
The `tail_retention` value is stored in `cohort_data.ltv_assumptions.tail_retention`
on each `membership_metrics_daily` row. It is set inside `lib/membership-metrics.ts`:

```typescript
// lib/membership-metrics.ts — search for tailRetention
const tailRetention = 1 - avgMonthlyChurn;   // derived from observed churn
```

To override (e.g., to model a conservative scenario), set `tail_retention` directly
in the metrics computation or add an env var (`MEMBERSHIP_TAIL_RETENTION`) and read
it there. Re-run step 3 to regenerate metrics with the new assumption.

### Simplee Status Source and Its Limitations

**Decision (from initial architecture):** Voluntary cancellations vs. involuntary
churn (failed payment) are *not* distinguished within the Shopify event stream.
Both appear as an absence of a renewal charge. The authoritative split lives in
the **Simplee** subscription-management app, which tracks explicit cancellation
requests separately from payment failures.

**Limitation:** The daily pipeline has no API integration with Simplee. The
`membership_status_snapshots.involuntary_suspect` flag is a heuristic (e.g., a
member who had billing activity then silence without an explicit cancel signal),
not a confirmed failed-payment count. Treat the `involuntary_suspect` column as
an approximation only. For the true cancellation vs. failed-payment breakdown,
export the report directly from the Simplee dashboard.

### Manual Re-run

Override any step's date via query params (all default to today/yesterday):

```bash
# Full chain for a specific date
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://shopifydailyreport01.vercel.app/api/cron/membership-daily\
?sync_date=2026-05-01&snapshot_date=2026-05-01&metrics_date=2026-05-01"

# Step 3 only (re-compute metrics without re-syncing events)
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://shopifydailyreport01.vercel.app/api/cron/membership-daily\
?sync_date=skip&snapshot_date=skip&metrics_date=2026-05-01"
```

Note: passing `sync_date=skip` is not implemented as a no-op shortcut — to
re-run only metrics, trigger `computeAndSaveMembershipMetrics` directly via
a local script or the Supabase edge function.

### Logs and Alerts

| Location | What's there |
|---|---|
| Vercel runtime logs | All `[membership-daily]` and `[membership-once-full]` console lines |
| `job_logs` table | `job_type = 'membership_alert'`, `status = 'alert'`, alerts as `meta.alerts[]` |
| Slack (`SLACK_CHANNEL_ID`) | `⚠️ Membership alert` message with 🔴/🟡 per rule |
| `/systems` health page | Pings `/api/health/membership`; reports degraded if last row > 2 days old |

**Alert rules:**

| Rule | Level | Trigger |
|---|---|---|
| `membership_mrr_zero` | 🔴 red | `mrr_net = 0` — sync likely failed |
| `membership_active_swing` | 🔴 red | `active_members` swings > 30% day-over-day |

The threshold is configurable via `ALERT_MEM_ACTIVE_SWING_PCT` (default `30`).

### Membership Tables

| Table | Purpose |
|---|---|
| `membership_billing_events` | Raw charge records; one row per billing event |
| `membership_sync_state` | Cursor tracking last synced `charged_at` timestamp |
| `membership_status_snapshots` | Per-member status snapshot per day (append-only) |
| `membership_metrics_daily` | Computed KPIs + cohort JSONB; one row per day (upserted) |
