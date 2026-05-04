import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';
import type { ProcessedDay } from '@/lib/business-rules';
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

  blocks.push(
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Daily Sales — ${dateLabel}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Revenue*\n${fmt(total.revenue)}` },
        { type: 'mrkdwn', text: `*Orders*\n${total.orders}` },
        { type: 'mrkdwn', text: `*Net Sales*\n${fmt(total.netSales)}` },
        { type: 'mrkdwn', text: `*AOV*\n${fmt(total.aov)}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Physical — Cash* 🔵' },
      fields: [
        { type: 'mrkdwn', text: `*Revenue*\n${fmt(physCash.revenue)}` },
        { type: 'mrkdwn', text: `*Margin*\n${fmtPct(physCash.margin)}` },
        { type: 'mrkdwn', text: `*Orders*\n${physCash.orders}` },
        { type: 'mrkdwn', text: `*AOV*\n${fmt(physCash.aov)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Physical — Non-Cash* 🟢' },
      fields: [
        { type: 'mrkdwn', text: `*Revenue*\n${fmt(physNonCash.revenue)}` },
        { type: 'mrkdwn', text: `*Margin*\n${fmtPct(physNonCash.margin)}` },
        { type: 'mrkdwn', text: `*Orders*\n${physNonCash.orders}` },
        { type: 'mrkdwn', text: `*AOV*\n${fmt(physNonCash.aov)}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Memberships* — ${membership.orders} order${membership.orders !== 1 ? 's' : ''} · ${fmt(membership.revenue)}\n_New: ${newCount} · Recurring: ${recurringCount}_`,
      },
    },
  );

  if (customerMix) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Customer Mix* 👥\nNew: ${customerMix.newOrders} orders · ${fmt(customerMix.newRevenue)}  ·  Returning: ${customerMix.returningOrders} orders · ${fmt(customerMix.returningRevenue)}`,
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
