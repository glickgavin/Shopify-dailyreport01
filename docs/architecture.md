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
