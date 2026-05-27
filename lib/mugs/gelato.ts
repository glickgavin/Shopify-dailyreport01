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
  status: string;
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

export async function patchDraftToOrder(draftId: string): Promise<GelatoOrder> {
  const res = await gelatoFetch(`/v4/orders/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ orderType: 'order' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gelato patch to order failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<GelatoOrder>;
}

export async function getOrderStatus(gelatoOrderId: string): Promise<GelatoOrder> {
  const res = await gelatoFetch(`/v4/orders/${gelatoOrderId}`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gelato getOrder failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<GelatoOrder>;
}
