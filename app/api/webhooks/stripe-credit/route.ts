import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { processInvoicePaid, processChargeRefunded } from '@/lib/stripe-credit';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Stripe webhook: invoice.paid → Shopify store credit; charge.refunded →
// proportional store-credit debit.
//
// Contract with Stripe:
// - Signature failures / bad methods → 4xx (Stripe will retry — good).
// - Business-logic failures → 200 with the failure recorded in the DB
//   (stripe_credit_invoices/refunds + stripe_credit_logs), so Stripe does
//   NOT retry-storm us; the hourly retry cron reprocesses failed rows.

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const secret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error(`[stripe-credit][${requestId}] STRIPE_WEBHOOK_SIGNING_SECRET not set`);
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing stripe-signature' }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    console.error(`[stripe-credit][${requestId}] signature verification failed: ${(err as Error).message}`);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  console.log(`[stripe-credit][${requestId}] event ${event.id} (${event.type})`);

  try {
    if (event.type === 'invoice.paid') {
      const result = await processInvoicePaid(event.data.object as Stripe.Invoice, requestId);
      return NextResponse.json({ received: true, requestId, result });
    }
    if (event.type === 'charge.refunded') {
      const results = await processChargeRefunded(event.data.object as Stripe.Charge, requestId);
      return NextResponse.json({ received: true, requestId, results });
    }
    // Any other event type: acknowledge and ignore.
    return NextResponse.json({ received: true });
  } catch (err) {
    // Unexpected failure (e.g. DB down). Still 200 so Stripe doesn't hammer
    // us; the row (if written) stays pending/failed for the retry cron.
    console.error(`[stripe-credit][${requestId}] handler error: ${(err as Error).message}`);
    return NextResponse.json({ received: true, requestId, error: (err as Error).message });
  }
}
