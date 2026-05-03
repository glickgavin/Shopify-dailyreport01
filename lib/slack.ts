import type { ProcessedDay } from '@/lib/business-rules';

type PrevSummary = { total_revenue: number; total_orders: number; total_net_sales: number } | null;

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
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const dryRun = process.env.DRY_RUN === 'true';

  const { date, total, physCash, physNonCash, membership, memOrders } = processed;

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

  const newCount = memOrders.filter((m) => m.membershipType === 'new').length;
  const recurringCount = memOrders.filter((m) => m.membershipType === 'recurring').length;

  const blocks: object[] = [
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
  ];

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
        url: `${dashboardUrl}?export=pdf`,
      },
    ],
  });

  const payload = { blocks };

  if (dryRun || !webhookUrl) {
    console.log('[slack] DRY_RUN — payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${text}`);
  }
}
