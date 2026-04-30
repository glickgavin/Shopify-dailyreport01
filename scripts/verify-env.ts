import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const required = [
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_API_VERSION',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'CRON_SECRET',
  'STORE_TIMEZONE',
];

let allOk = true;
for (const key of required) {
  const val = process.env[key];
  if (val) {
    const preview = val.length > 20 ? val.slice(0, 12) + '…' : val;
    console.log(`  OK      ${key} (${preview})`);
  } else {
    console.log(`  MISSING ${key}`);
    allOk = false;
  }
}

console.log('');
console.log(allOk ? '✓ All env vars present' : '✗ Some env vars are missing');
process.exit(allOk ? 0 : 1);
