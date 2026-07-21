-- ─────────────────────────────────────────────────────────────────────────
-- Add a transient 'processing' state to paypal_subscription_ledger.credit_status.
--
-- The allocation endpoint atomically claims a row (pending/failed → processing)
-- BEFORE calling Shopify's storeCreditAccountCredit, so two concurrent requests
-- can never credit the same customer twice. The claim is a status transition,
-- so 'processing' must be an allowed value.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.paypal_subscription_ledger
  DROP CONSTRAINT IF EXISTS paypal_subscription_ledger_credit_status_check;

ALTER TABLE public.paypal_subscription_ledger
  ADD CONSTRAINT paypal_subscription_ledger_credit_status_check
  CHECK (credit_status IN ('pending','processing','allocated','skipped','refunded','failed'));
