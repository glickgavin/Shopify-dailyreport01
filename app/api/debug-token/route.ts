import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;
  const version = process.env.SHOPIFY_API_VERSION ?? '2024-04';

  // 1. Fetch token
  const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const tokenJson = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ step: 'token_fetch', error: tokenJson }, { status: 500 });
  }

  const token = tokenJson.access_token as string;
  const tokenPreview = token ? token.slice(0, 12) + '…' : 'none';

  // 2. Check access scopes
  const scopesRes = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  const scopesJson = await scopesRes.json();

  // 3. Simple shop query to confirm token works
  const shopRes = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: '{ shop { name myshopifyDomain } }' }),
  });
  const shopJson = await shopRes.json();

  // 4. Check if shopifyqlQuery exists via introspection
  const introRes = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({
      query: `{ __type(name: "QueryRoot") { fields { name } } }`,
    }),
  });
  const introJson = await introRes.json();
  const fields: string[] = introJson?.data?.__type?.fields?.map((f: { name: string }) => f.name) ?? [];
  const hasShopifyQL = fields.includes('shopifyqlQuery');

  return NextResponse.json({
    tokenPreview,
    expiresIn: tokenJson.expires_in,
    scopes: scopesJson,
    shop: shopJson?.data?.shop,
    shopGraphqlStatus: shopRes.status,
    hasShopifyqlQueryField: hasShopifyQL,
    queryRootFields: fields.filter(f => f.toLowerCase().includes('shopify') || f.toLowerCase().includes('analyt')),
    apiVersion: version,
  });
}
