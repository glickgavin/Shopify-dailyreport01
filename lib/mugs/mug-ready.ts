import { shopifyGraphQL } from '@/lib/shopify';

const MUG_CHOICE_QUERY = `
  query GetOrderMugChoice($id: ID!) {
    order(id: $id) {
      tags
      metafield(namespace: "custom", key: "mug_choice") {
        value
      }
    }
  }
`;

export interface MugReadyStatus {
  ready: boolean;
  tileId: string | null;
  imageUrl: string | null;
  source: string | null;
  metafieldUpdatedAt: string | null;
}

/**
 * Fetch the mug:ready status for a Shopify order.
 * ready = order has the 'mug:ready' tag AND a custom.mug_choice metafield
 * with a non-empty image_url.
 */
export async function fetchMugReadyStatus(shopifyOrderId: string): Promise<MugReadyStatus> {
  const gid = `gid://shopify/Order/${shopifyOrderId}`;

  const result = await shopifyGraphQL<{
    order: { tags: string[]; metafield: { value: string } | null } | null;
  }>(MUG_CHOICE_QUERY, { id: gid });

  const order = result.order;

  if (!order?.tags.includes('mug:ready') || !order.metafield) {
    return { ready: false, tileId: null, imageUrl: null, source: null, metafieldUpdatedAt: null };
  }

  let choice: { tile_id?: string; image_url?: string; source?: string; updated_at?: string };
  try {
    choice = JSON.parse(order.metafield.value);
  } catch {
    return { ready: false, tileId: null, imageUrl: null, source: null, metafieldUpdatedAt: null };
  }

  if (!choice.image_url) {
    return { ready: false, tileId: null, imageUrl: null, source: null, metafieldUpdatedAt: null };
  }

  return {
    ready:              true,
    tileId:             choice.tile_id   ?? null,
    imageUrl:           choice.image_url,
    source:             choice.source    ?? null,
    metafieldUpdatedAt: choice.updated_at ?? null,
  };
}
