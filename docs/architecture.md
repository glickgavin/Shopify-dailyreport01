# Shopify Daily Report — Architecture

## Overview

An automated system that pulls yesterday's Shopify sales data every morning,
stores it in Supabase, renders an interactive web dashboard, and posts a
formatted summary to Slack — all without manual intervention.

---

## System Diagram

```
Vercel Cron (10:30am store-local time)
        │
        ▼
POST /api/cron/daily-report   ← authenticated with CRON_SECRET
        │
        ├─► lib/shopify.ts          Shopify Admin REST API
        │       Fetch: orders, products, refunds (yesterday's window)
        │
        ├─► lib/transforms.ts       Apply business rules
        │       - Filter out test orders, staff orders
        │       - Compute: net revenue, AOV, units sold, refund rate
        │       - Aggregate: by product, by channel, by hour
        │
        ├─► lib/supabase.ts         Supabase (Postgres)
        │       Upsert: daily_snapshots table (idempotent)
        │       Store: raw JSON blobs in Supabase Storage
        │
        ├─► lib/slack.ts            Slack Web API
        │       Post: formatted summary message with KPIs
        │       Attach: screenshot of dashboard (Puppeteer)
        │
        └─► Return 200 JSON summary to Vercel Cron log
```

---

## Data Flow

### 1. Fetch (Shopify Admin REST API)
- Endpoint: `GET /admin/api/{version}/orders.json`
- Params: `created_at_min`, `created_at_max` covering yesterday 00:00–23:59
  in store-local timezone
- Paginated with `Link` header cursors until all orders are retrieved
- Fields: `id`, `created_at`, `total_price`, `subtotal_price`,
  `total_discounts`, `total_refunds`, `line_items`, `source_name`,
  `financial_status`, `fulfillment_status`, `customer`

### 2. Transform (Business Rules)
- **Exclude** orders with `financial_status: pending` (unpaid)
- **Exclude** orders tagged `test` or placed by staff accounts
- **Net revenue** = `total_price` − `total_refunds`
- **AOV** = net revenue ÷ order count
- **Refund rate** = refunded orders ÷ total orders
- **Top products** by units sold and by revenue
- **Channel breakdown**: online store vs POS vs draft orders

### 3. Store (Supabase)

#### Tables
| Table | Purpose |
|---|---|
| `daily_snapshots` | One row per store per date; all KPIs |
| `order_line_items` | Granular per-product-per-day aggregates |
| `raw_fetches` | Full JSON payload from Shopify (Supabase Storage) |

#### Strategy
- Upsert on `(store_domain, report_date)` — safe to re-run
- Storage bucket `raw-reports` holds gzipped JSON for audit/replay

### 4. Dashboard (Next.js App Router)

- `/app/dashboard/page.tsx` — server component, reads from Supabase
- `/app/dashboard/[date]/page.tsx` — historical view for a specific date
- Client components (Recharts):
  - Revenue trend (7-day line chart)
  - Top products (bar chart)
  - Channel split (pie/donut chart)
  - Hourly order volume (area chart)

### 5. Slack Notification

- `chat.postMessage` with Block Kit layout
- Blocks: date header, KPI summary, top 3 products, comparison vs prior week
- Attached: PNG screenshot of dashboard captured with Puppeteer +
  `@sparticuz/chromium` (Vercel-compatible headless Chrome)

---

## Scheduling

Vercel Cron triggers `POST /api/cron/daily-report` on a UTC cron expression
calculated from the store's `STORE_TIMEZONE`. Because Vercel Cron only supports
UTC, the cron expression is set for the UTC equivalent of 10:30am store-local
time. **DST note:** update the cron expression manually when DST transitions
occur (twice a year), or accept up to 1 hour of drift.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Idempotent upserts | Safe to re-run the cron; won't double-count |
| Service-role key server-side only | Avoids RLS bypass in browser |
| Raw JSON stored in Storage | Allows replay if transform logic changes |
| Puppeteer screenshot | Slack image attachment gives at-a-glance view without clicking |
| `date-fns-tz` for timezone math | Handles DST correctly; no moment.js |
| Zod for API response validation | Catches Shopify schema drift early |
| Pino for structured logging | Vercel log drains can parse JSON logs |

---

## Environment Variables

See `.env.example` for the full list with descriptions. Required at runtime:

**Shopify:** `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_API_TOKEN`, `SHOPIFY_API_VERSION`  
**Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`  
**Slack:** `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`  
**Cron:** `CRON_SECRET`  
**Config:** `STORE_TIMEZONE`, `DRY_RUN`, `NEXT_PUBLIC_APP_URL`

---

## File Structure

```
/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                         # Root redirect → /dashboard
│   ├── globals.css
│   ├── dashboard/
│   │   ├── page.tsx                     # Latest report
│   │   └── [date]/
│   │       └── page.tsx                 # Historical report by date
│   └── api/
│       ├── cron/
│       │   └── daily-report/
│       │       └── route.ts             # Vercel Cron handler
│       └── shopify/
│           └── test/
│               └── route.ts            # Manual test trigger (dev only)
├── lib/
│   ├── shopify.ts                       # Shopify API client + fetchers
│   ├── supabase.ts                      # Supabase client (server + browser)
│   ├── slack.ts                         # Slack notification builder
│   ├── transforms.ts                    # Business rule transformations
│   ├── screenshot.ts                    # Puppeteer screenshot helper
│   ├── logger.ts                        # Pino logger config
│   ├── queries/
│   │   ├── upsertSnapshot.ts
│   │   └── getSnapshot.ts
│   └── types/
│       ├── shopify.ts                   # Zod schemas + inferred types
│       ├── snapshot.ts                  # DB row types
│       └── slack.ts                     # Slack block types
├── scripts/
│   ├── seed-test-data.ts                # Local dev: insert fake snapshot
│   └── backfill.ts                      # One-off: fetch & store past N days
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── docs/
│   └── architecture.md                  # ← this file
├── .env.example
├── .env.local                           # git-ignored
├── .gitignore
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Local Development

```bash
# 1. Copy env vars
cp .env.example .env.local
# fill in .env.local with real credentials

# 2. Install deps
pnpm install

# 3. Run dev server
pnpm dev

# 4. Trigger a manual fetch (without waiting for cron)
curl -X POST http://localhost:3000/api/cron/daily-report \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Deployment Checklist

- [ ] All env vars set in Vercel project settings
- [ ] `vercel.json` cron schedule configured for correct UTC time
- [ ] Supabase migration applied (`001_initial_schema.sql`)
- [ ] Slack app installed to workspace, bot added to channel
- [ ] Shopify app created, scopes granted, token generated
- [ ] First manual run via Vercel dashboard to verify end-to-end
