// Gelato Order Flow API v4 — thin client for mug fulfillment.
// Docs: https://dashboard.gelato.com/docs/orders/

const GELATO_BASE = 'https://order.gelatoapis.com';

async function gelatoFetch(path: string, options: RequestInit): Promise<Response> {
  const key = process.env.GELATO_API_KEY;
  if (!key) throw new Error('GELATO_API_KEY not configured');

  const res = await fetch(`${GELATO_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
      ...(options.headers ?? {}),
    },
  });
  return res;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GelatoFileRequest {
  type: 'default';
  url: string;
}

export interface GelatoItem {
  itemReferenceId: string;
  productUid: string;
  quantity: number;
  files: GelatoFileRequest[];
}

export interface GelatoRecipient {
  name:        string;
  email?:      string;
  phone?:      string;
  country:     string;
  firstName?:  string;
  lastName?:   string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  city:        string;
  postCode:    string;
  state?:      string;
}

export interface GelatoCreateDraftPayload {
  orderReferenceId: string;
  customerReferenceId?: string;
  currency: string;
  items: GelatoItem[];
  shipmentMethodUid?: string;  // omit for cheapest
  shippingAddress: GelatoRecipient;
  returnAddress?: Partial<GelatoRecipient>;
  metadata?: Record<string, string>;
}

export interface GelatoDraftOrder {
  id: string;
  orderReferenceId: string;
  status: string;
  items: Array<{ itemReferenceId: string; status: string; productUid: string }>;
  fulfillment?: { shipmentMethodName?: string; price?: number };
}

export interface GelatoOrder {
  id: string;
  orderReferenceId: string;
  // Gelato webhooks send "status"; the REST GET endpoint sends "fulfillmentStatus".
  // getOrderStatus normalises both into "status" so callers can use one field.
  status?: string;
  fulfillmentStatus?: string;
  // REST GET returns top-level "shipment" (singular); webhooks nest under "fulfillment.shipments".
  shipment?: {
    trackingCode?: string;
    trackingUrl?: string;
    shipmentMethodName?: string;
  };
  fulfillment?: {
    shipmentMethodName?: string;
    shipments?: Array<{
      trackingCode?: string;
      trackingUrl?: string;
      shipmentMethodName?: string;
    }>;
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

// Search for an existing order by the reference ID we supplied (e.g. Shopify line item ID).
// Returns the first match or null if not found.
export async function findOrderByReference(orderReferenceId: string): Promise<GelatoOrder | null> {
  const res = await gelatoFetch(
    `/v4/orders?orderReferenceId=${encodeURIComponent(orderReferenceId)}`,
    { method: 'GET' },
  );
  if (!res.ok) return null;
  const body = await res.json() as { orders?: GelatoOrder[] };
  return body.orders?.[0] ?? null;
}

export async function getOrderStatus(gelatoOrderId: string): Promise<GelatoOrder> {
  const res = await gelatoFetch(`/v4/orders/${gelatoOrderId}`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gelato getOrder failed (${res.status}): ${text}`);
  }
  const order = await res.json() as GelatoOrder;
  // Normalise: REST API uses fulfillmentStatus; webhooks use status.
  if (!order.status && order.fulfillmentStatus) {
    order.status = order.fulfillmentStatus;
  }
  return order;
}

// Patch an existing order — used to update print file URL on a Shopify-integrated order,
// or to promote a draft to a live order.
export async function patchOrder(gelatoOrderId: string, patch: Record<string, unknown>): Promise<GelatoOrder> {
  const res = await gelatoFetch(`/v4/orders/${gelatoOrderId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gelato patchOrder failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<GelatoOrder>;
}

// Cancel an order. Gelato rejects PATCH-ing the print file on an already-placed
// order (returns 550), so a stale order from a prior attempt must be cancelled
// before re-creating a fresh draft. Best-effort: 404 (already gone) is not an error.
export async function cancelOrder(gelatoOrderId: string): Promise<void> {
  const res = await gelatoFetch(`/v4/orders/${gelatoOrderId}:cancel`, { method: 'POST' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Gelato cancelOrder failed (${res.status}): ${text}`);
  }
}

export async function createDraftOrder(payload: GelatoCreateDraftPayload): Promise<GelatoDraftOrder> {
  const testMode = process.env.GELATO_TEST_MODE === 'true';
  const body = { ...payload, orderType: 'draft' };
  const path = testMode ? '/v4/orders?mock=true' : '/v4/orders';

  const res = await gelatoFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gelato createDraft failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<GelatoDraftOrder>;
}

// Kept for backwards compat — wraps patchOrder with orderType:'order'
export async function patchDraftToOrder(draftId: string): Promise<GelatoOrder> {
  return patchOrder(draftId, { orderType: 'order' });
}
