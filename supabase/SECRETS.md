# Required Environment Variables

## Shopify
| Variable | Description |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | e.g. `yourstore.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | OAuth app client ID |
| `SHOPIFY_CLIENT_SECRET` | OAuth app client secret |
| `SHOPIFY_API_VERSION` | e.g. `2024-01` |

## Supabase (local shopify-dailyreport project)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |

## Analytics (remote source)
| Variable | Description |
|---|---|
| `ANALYTICS_API_URL` | URL of the remote `get-analytics` edge function |
| `ANALYTICS_API_KEY` | API key sent as `x-api-key` header |
| `ANALYTICS_USE_REMOTE` | Set to `true` to bypass local mirror and query remote directly (debug only) |

### Analytics sync cadence
- Vercel Pro: hourly minimum (`0 * * * *`)
- Vercel Enterprise: 5-minute cadence (`*/5 * * * *`) — update `vercel.json` if upgraded

## Other
| Variable | Description |
|---|---|
| `CRON_SECRET` | Bearer token to authenticate Vercel cron requests |
| `STORE_TIMEZONE` | e.g. `America/Los_Angeles` |
| `SLACK_BOT_TOKEN` | Slack bot token for daily report notifications |
| `SLACK_CHANNEL_ID` | Slack channel to post to |
| `STRIPE_SECRET_KEY` | Stripe secret key for snapshot data |
| `NEXT_PUBLIC_APP_URL` | Full URL of the deployed app |
