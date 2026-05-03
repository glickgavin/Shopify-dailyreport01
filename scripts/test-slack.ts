import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;

  if (!token || !channel) {
    console.error('Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID in .env.local');
    process.exit(1);
  }

  console.log(`Posting to channel: ${channel}`);
  const client = new WebClient(token);
  const result = await client.chat.postMessage({
    channel,
    text: '🧪 Test from Shopify Daily Report — Slack integration is working',
  });

  if (result.ok) {
    console.log('✓ Message sent successfully');
  } else {
    console.error('✗ Slack error:', result.error);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
