import { config } from 'dotenv';
import { resolve } from 'path';

if (!process.env.SHOPIFY_STORE_DOMAIN) {
  config({ path: resolve(process.cwd(), '.env.local') });
}

const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const clientId = process.env.SHOPIFY_CLIENT_ID!;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;
const version = process.env.SHOPIFY_API_VERSION ?? '2024-04';

const TOKEN_URL = `https://${domain}/admin/oauth/access_token`;
const ENDPOINT = `https://${domain}/admin/api/${version}/graphql.json`;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Shopify token fetch failed HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  tokenExpiresAt = Date.now() + (json.expires_in - 300) * 1000;
  return json.access_token;
}

async function getToken(): Promise<string> {
  if (!cachedToken || Date.now() >= tokenExpiresAt) {
    cachedToken = await fetchAccessToken();
  }
  return cachedToken;
}

export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt++;
    const token = await getToken();

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiresAt = 0;
      await sleep(500);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const backoff = 2 ** attempt * 500;
      console.warn(`Shopify ${res.status} — retrying in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json() as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    return json.data as T;
  }

  throw new Error(`Shopify request failed after ${maxAttempts} attempts`);
}
