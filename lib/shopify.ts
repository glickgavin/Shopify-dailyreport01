import { config } from 'dotenv';
import { resolve } from 'path';

// Load env when running as a script outside Next.js
if (!process.env.SHOPIFY_STORE_DOMAIN) {
  config({ path: resolve(process.cwd(), '.env.local') });
}

const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const clientId = process.env.SHOPIFY_CLIENT_ID!;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;
const version = process.env.SHOPIFY_API_VERSION ?? '2026-01';

const TOKEN_URL = `https://${domain}/admin/oauth/access_token`;
const ENDPOINT = `https://${domain}/admin/api/${version}/graphql.json`;

// In-process token cache — refreshed automatically before expiry
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // unix ms

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
  // Refresh 5 minutes before actual expiry
  tokenExpiresAt = Date.now() + (json.expires_in - 300) * 1000;
  return json.access_token;
}

async function getToken(): Promise<string> {
  if (!cachedToken || Date.now() >= tokenExpiresAt) {
    cachedToken = await fetchAccessToken();
  }
  return cachedToken;
}

const SHOPIFYQL_QUERY = /* GraphQL */ `
  query ShopifyQL($query: String!) {
    shopifyqlQuery(query: $query) {
      ... on TableResponse {
        tableData {
          unformattedData
          rowData
          columns {
            name
            dataType
            displayName
          }
        }
      }
      parseErrors {
        code
        message
        range { start { line column } end { line column } }
      }
    }
  }
`;

export async function runShopifyQL(ql: string): Promise<Record<string, string>[]> {
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt++;

    // If we get a 401 mid-flight, force token refresh on next iteration
    const token = await getToken();

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query: SHOPIFYQL_QUERY, variables: { query: ql } }),
    });

    // Force refresh and retry on 401
    if (res.status === 401) {
      cachedToken = null;
      tokenExpiresAt = 0;
      await sleep(500);
      continue;
    }

    // Retry on 429 / 5xx
    if (res.status === 429 || res.status >= 500) {
      const backoff = 2 ** attempt * 500;
      console.warn(`Shopify ${res.status} — retrying in ${backoff}ms (attempt ${attempt})`);
      await sleep(backoff);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json() as {
      data?: {
        shopifyqlQuery?: {
          tableData?: {
            unformattedData: string[][];
            rowData: string[][];
            columns: { name: string; dataType: string; displayName: string }[];
          };
          parseErrors?: { code: string; message: string }[];
        };
      };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`);
    }

    const result = json.data?.shopifyqlQuery;
    if (!result) throw new Error('Empty shopifyqlQuery response');

    if (result.parseErrors?.length) {
      throw new Error(`ShopifyQL parse errors: ${result.parseErrors.map((e) => e.message).join(', ')}`);
    }

    const tableData = result.tableData;
    if (!tableData) return [];

    const { columns, unformattedData } = tableData;
    const colNames = columns.map((c) => c.name);

    return unformattedData.map((row) => {
      const obj: Record<string, string> = {};
      colNames.forEach((name, i) => { obj[name] = row[i] ?? ''; });
      return obj;
    });
  }

  throw new Error(`Shopify request failed after ${maxAttempts} attempts`);
}
