import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';
import type { ProcessedDay, DerivedKPIs } from '@/lib/business-rules';
import type { Alert } from '@/lib/alerts';

type PrevSummary = { total_revenue: number; total_orders: number; total_net_sales: number } | null;

interface CustomerMix {
  newOrders: number;
  newRevenue: number;
  returningOrders: number;
  returningRevenue: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function deltaStr(now: number, prev: number): string {
  if (!prev) return '—';
  const pct = ((now - prev) / prev) * 100;
  return `${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%`;
}

export async function postDailySummary(
  processed: ProcessedDay,
  dashboardUrl: string,
  prev: PrevSummary = null,
  alerts: Alert[] = [],
  customerMix?: CustomerMix,
  derived?: DerivedKPIs,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const dryRun = process.env.DRY_RUN === 'true';

  const { date, total, physCash, physNonCash, membership, memOrders } = processed;

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

  const newCount = memOrders.filter((m) => m.membershipType === 'new').length;
  const recurringCount = memOrders.filter((m) => m.membershipType === 'recurring').length;

  const blocks: KnownBlock[] = [];

  // Prepend alert section if any alerts
  if (alerts.length > 0) {
    const redAlerts = alerts.filter((a) => a.level === 'red');
    const yellowAlerts = alerts.filter((a) => a.level === 'yellow');
    const alertLines = [
      ...redAlerts.map((a) => `🚨 ${a.message}`),
      ...yellowAlerts.map((a) => `⚠️ ${a.message}`),
    ].join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🚨 Alerts*\n${alertLines}` },
    });
    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📊 Daily Sales — ${dateLabel}*`,
    },
  });

  if (derived) {
    const profitStr = derived.dailyProfit < 0
      ? `🚨 *−${fmt(Math.abs(derived.dailyProfit))}*`
      : fmt(derived.dailyProfit);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `💰 Cash In: *${fmt(derived.cashIn)}*  ·  📈 GP − Ads: ${profitStr}`,
      },
    });
    if (derived.adCost > 0) {
      const cpaAdStr      = derived.cpaAd      !== null ? `$${derived.cpaAd.toFixed(2)}`      : '—';
      const cpaBlendedStr = derived.cpaBlended !== null ? `$${derived.cpaBlended.toFixed(2)}` : '—';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📣 Ad Spend: *${fmt(derived.adCost)}*  ·  CPA Ad: ${cpaAdStr}  ·  CPA Blended: ${cpaBlendedStr} (${derived.adPurchases} attr. / ${total.orders} total orders)`,
        },
      });
    }
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Total* — Revenue ${fmt(total.revenue)} · Net ${fmt(total.netSales)} · Orders ${total.orders} · AOV ${fmt(total.aov)}`,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Cash* 🔵 — Revenue ${fmt(physCash.revenue)} · Margin ${fmtPct(physCash.margin)} · Orders ${physCash.orders} · AOV ${fmt(physCash.aov)}`,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Non-Cash* 🟢 — Revenue ${fmt(physNonCash.revenue)} · Margin ${fmtPct(physNonCash.margin)} · Orders ${physNonCash.orders} · AOV ${fmt(physNonCash.aov)}`,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Memberships* — ${membership.orders} order${membership.orders !== 1 ? 's' : ''} · ${fmt(membership.revenue)} · New: ${newCount} · Recurring: ${recurringCount}`,
    },
  });

  if (customerMix) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Customer Mix* 👥 — New: ${customerMix.newOrders} orders · ${fmt(customerMix.newRevenue)} · Returning: ${customerMix.returningOrders} orders · ${fmt(customerMix.returningRevenue)}`,
      },
    });
  }

  if (prev) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `vs prev day — Revenue: *${deltaStr(total.revenue, prev.total_revenue)}* · Orders: *${deltaStr(total.orders, prev.total_orders)}* · Net Sales: *${deltaStr(total.netSales, prev.total_net_sales)}*`,
        },
      ],
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View Dashboard', emoji: true },
        url: dashboardUrl,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Export PDF', emoji: true },
        url: `${dashboardUrl.replace('/dashboard/', '/api/export/')}/pdf`,
      },
    ],
  });

  const payload = { blocks };

  if (dryRun || !token || !channel) {
    console.log('[slack] DRY_RUN — payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const client = new WebClient(token);
  const result = await client.chat.postMessage({ channel, blocks, text: `Daily Sales — ${dateLabel}` });
  if (!result.ok) throw new Error(`Slack API error: ${result.error}`);
}
