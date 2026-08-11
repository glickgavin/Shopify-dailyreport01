import { NextResponse } from 'next/server';
import { shopifyGraphQL } from '@/lib/shopify';
import { getAdminSessionUser } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRODUCT_ID = 'gid://shopify/Product/8471707222212';

// Markets: US→USA, CA→Canada, DE→EU, GB→UK (aliased in the GraphQL query below).
// Discounts to surface. `match` is compared (case-insensitively) against the
// discount title AND its codes, so either can drift on the Shopify side.
const WANTED_DISCOUNTS = [
  { key: 'magic',    match: 'MAGIC DISCOUNT', kind: 'code' },
  { key: 'bundle6',  match: 'BUNDLE6',        kind: 'code' },
  { key: 'bundle8',  match: 'BUNDLE8',        kind: 'code' },
  { key: 'bundle10', match: 'BUNDLE10',       kind: 'code' },
  { key: 'vipoff',   match: 'VIP-OFF',        kind: 'automatic' },
  { key: 'vipdeal',  match: 'VIP Deal',       kind: 'code' },
] as const;

interface Money { amount: string; currencyCode: string }
interface VariantNode {
  id: string;
  title: string;
  us: { price: Money } | null;
  ca: { price: Money } | null;
  de: { price: Money } | null;
  gb: { price: Money } | null;
}
interface DiscountValue { __typename: string; percentage?: number }
interface DiscountShape {
  __typename: string;
  title?: string;
  status?: string;
  codes?: { nodes: { code: string }[] };
  customerGets?: { value: DiscountValue };
  minimumRequirement?: { __typename: string; greaterThanOrEqualToQuantity?: string } | null;
}
interface PriceListQuery {
  product: { title: string; variants: { nodes: VariantNode[] } } | null;
  discountNodes: { nodes: { id: string; discount: DiscountShape }[] };
}

const QUERY = /* GraphQL */ `
  query PriceList($id: ID!) {
    product(id: $id) {
      title
      variants(first: 50) {
        nodes {
          id
          title
          us: contextualPricing(context: { country: US }) { price { amount currencyCode } }
          ca: contextualPricing(context: { country: CA }) { price { amount currencyCode } }
          de: contextualPricing(context: { country: DE }) { price { amount currencyCode } }
          gb: contextualPricing(context: { country: GB }) { price { amount currencyCode } }
        }
      }
    }
    discountNodes(first: 250) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title
            status
            codes(first: 10) { nodes { code } }
            customerGets { value { __typename ... on DiscountPercentage { percentage } } }
            minimumRequirement { __typename ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }
          }
          ... on DiscountAutomaticBasic {
            title
            status
            customerGets { value { __typename ... on DiscountPercentage { percentage } } }
            minimumRequirement { __typename ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }
          }
        }
      }
    }
  }
`;

const norm = (s: string) => s.trim().toUpperCase();

function matchesDiscount(d: DiscountShape, match: string): boolean {
  const target = norm(match);
  if (d.title && norm(d.title) === target) return true;
  return (d.codes?.nodes ?? []).some(c => norm(c.code) === target);
}

export async function GET() {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await shopifyGraphQL<PriceListQuery>(QUERY, { id: PRODUCT_ID });
    if (!data.product) {
      return NextResponse.json({ error: `Product ${PRODUCT_ID} not found` }, { status: 502 });
    }

    // Sort variants by leading tile size (8x8, 12x12, 16x16).
    const variants = [...data.product.variants.nodes]
      .sort((a, b) => (parseInt(a.title, 10) || 0) - (parseInt(b.title, 10) || 0))
      .map(v => ({
        id: v.id,
        title: v.title,
        prices: {
          US: v.us ? Number(v.us.price.amount) : null,
          CA: v.ca ? Number(v.ca.price.amount) : null,
          EU: v.de ? Number(v.de.price.amount) : null,
          UK: v.gb ? Number(v.gb.price.amount) : null,
        },
      }));

    const allDiscounts = data.discountNodes.nodes.map(n => n.discount);
    const discounts = WANTED_DISCOUNTS.map(w => {
      const found = allDiscounts.find(d => {
        const isAuto = d.__typename.startsWith('DiscountAutomatic');
        if (w.kind === 'automatic' && !isAuto) return false;
        if (w.kind === 'code' && isAuto) return false;
        return matchesDiscount(d, w.match);
      });
      const value = found?.customerGets?.value;
      const percentage = value?.__typename === 'DiscountPercentage' && typeof value.percentage === 'number'
        ? value.percentage
        : null;
      const minReq = found?.minimumRequirement;
      const minQuantity = minReq?.__typename === 'DiscountMinimumQuantity' && minReq.greaterThanOrEqualToQuantity
        ? parseInt(minReq.greaterThanOrEqualToQuantity, 10)
        : null;
      return {
        key: w.key,
        name: w.match,
        kind: w.kind,
        active: !!found && found.status === 'ACTIVE' && percentage !== null,
        percentage,
        minQuantity,
      };
    });

    return NextResponse.json({
      product: { title: data.product.title, variants },
      discounts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
