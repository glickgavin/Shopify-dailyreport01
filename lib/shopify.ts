import { config } from 'dotenv';
import { resolve } from 'path';

// Load env when running as a script outside Next.js
if (!process.env.SHOPIFY_STORE_DOMAIN) {
  config({ path: resolve(process.cwd(), '.env.local') });
}

const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const token = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const version = process.env.SHOPIFY_API_VERSION ?? '2026-01';

const ENDPOINT = `https://${domain}/admin/api/${version}/graphql.json`;

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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runShopifyQL(ql: string): Promise<Record<string, string>[]> {
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt++;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query: SHOPIFYQL_QUERY, variables: { query: ql } }),
    });

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
