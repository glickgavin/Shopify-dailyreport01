import Stripe from 'stripe';

const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey) {
  // Don't throw at import time — let the consumer get a clearer error
  // when they actually try to use the client. This keeps Next.js build
  // from failing in environments where Stripe isn't configured.
  console.warn('[stripe] STRIPE_SECRET_KEY not set');
}

export const stripe = new Stripe(apiKey ?? 'sk_test_placeholder', {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});
