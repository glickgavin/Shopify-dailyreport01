-- ─────────────────────────────────────────────────────────────────────────
-- PayPal subscription ledger + auto-populate trigger.
--
-- This migration is ALREADY APPLIED to Supabase project kztxlpfrullqzphkvkiv
-- (it was applied by hand from Claude); commit this file only so the repo
-- history matches the live schema.
--
-- Backfill has also already been run for all 788 historical T0002 rows in
-- paypal_daily_snapshot (from 2026-05-30 through 2026-07-20, $28,032.10 total).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.paypal_subscription_ledger (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- PayPal identity + timing
  paypal_transaction_id       text NOT NULL UNIQUE,
  initiated_at                timestamp with time zone NOT NULL,
  pt_date                     date NOT NULL,
  -- Money
  gross_cents                 integer NOT NULL,
  fee_cents                   integer NOT NULL DEFAULT 0,
  currency                    text NOT NULL DEFAULT 'USD',
  -- PayPal classification
  transaction_event_code      text NOT NULL,
  status                      text NOT NULL,
  subject                     text,
  -- Customer identity (from PayPal)
  payer_email                 text,
  payer_name                  text,
  custom_field_raw            text,
  custom_field_email          text,
  -- Payment instrument
  instrument_type             text,
  instrument_sub_type         text,
  -- Store-credit allocation workflow
  credit_status               text NOT NULL DEFAULT 'pending'
    CHECK (credit_status IN ('pending','allocated','skipped','refunded','failed')),
  credit_amount_cents         integer,
  credit_email                text,
  credit_shopify_customer_id  text,
  credit_reference            text,
  credit_allocated_at         timestamp with time zone,
  credit_allocated_by         text,
  credit_notes                text,
  credit_error                text,
  -- Reversal tracking (future)
  refunded_at                 timestamp with time zone,
  refund_paypal_txn_id        text,
  chargebacked_at             timestamp with time zone,
  chargeback_paypal_txn_id    text,
  -- Meta
  raw_payload                 jsonb NOT NULL,
  created_at                  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_pt_date_status_idx
  ON public.paypal_subscription_ledger (pt_date DESC, credit_status);
CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_pending_idx
  ON public.paypal_subscription_ledger (credit_status) WHERE credit_status = 'pending';
CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_payer_email_idx
  ON public.paypal_subscription_ledger (payer_email);
CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_custom_field_email_idx
  ON public.paypal_subscription_ledger (custom_field_email);
CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_credit_email_idx
  ON public.paypal_subscription_ledger (credit_email);
CREATE INDEX IF NOT EXISTS paypal_subscription_ledger_initiated_at_idx
  ON public.paypal_subscription_ledger (initiated_at DESC);

CREATE OR REPLACE FUNCTION public.paypal_subscription_ledger_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paypal_subscription_ledger_touch ON public.paypal_subscription_ledger;
CREATE TRIGGER paypal_subscription_ledger_touch
BEFORE UPDATE ON public.paypal_subscription_ledger
FOR EACH ROW EXECUTE FUNCTION public.paypal_subscription_ledger_touch();

COMMENT ON TABLE public.paypal_subscription_ledger IS
  'Ledger of PayPal subscription (T0002) payments. Each row = one PayPal payment; '
  'credit_status tracks whether we have compensated the customer with store credit in Shopify.';

-- Auto-populate the ledger from every paypal_daily_snapshot write.
CREATE OR REPLACE FUNCTION public.paypal_snapshot_populate_subscription_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.paypal_subscription_ledger (
    paypal_transaction_id, initiated_at, pt_date,
    gross_cents, fee_cents, currency,
    transaction_event_code, status, subject,
    payer_email, payer_name,
    custom_field_raw, custom_field_email,
    instrument_type, instrument_sub_type,
    raw_payload
  )
  SELECT
    txn->>'id',
    (txn->>'initiated_iso')::timestamptz,
    NEW.date,
    (txn->>'gross_cents')::int,
    COALESCE((txn->>'fee_cents')::int, 0),
    COALESCE(NULLIF(txn->>'currency',''), 'USD'),
    txn->>'transaction_event_code',
    COALESCE(NULLIF(txn->>'status',''), 'S'),
    NULLIF(txn->>'subject',''),
    NULLIF(txn->>'email',''),
    NULLIF(txn->>'name',''),
    NULLIF(txn->>'custom_field',''),
    CASE
      WHEN txn->>'custom_field' ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
        THEN lower(txn->>'custom_field')
      ELSE NULL
    END,
    NULLIF(txn->>'instrument_type',''),
    NULLIF(txn->>'instrument_sub_type',''),
    txn
  FROM jsonb_array_elements(NEW.payload->'direct_success_transactions') txn
  WHERE txn->>'transaction_event_code' = 'T0002'
    AND txn->>'id' IS NOT NULL
  ON CONFLICT (paypal_transaction_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paypal_snapshot_populate_ledger ON public.paypal_daily_snapshot;
CREATE TRIGGER paypal_snapshot_populate_ledger
AFTER INSERT OR UPDATE OF payload ON public.paypal_daily_snapshot
FOR EACH ROW EXECUTE FUNCTION public.paypal_snapshot_populate_subscription_ledger();

COMMENT ON FUNCTION public.paypal_snapshot_populate_subscription_ledger() IS
  'Copies T0002 subscription rows from paypal_daily_snapshot into paypal_subscription_ledger. '
  'Runs on every snapshot write; ON CONFLICT DO NOTHING makes replay safe.';

-- One-time backfill of every historical T0002 in paypal_daily_snapshot.
-- Idempotent via ON CONFLICT DO NOTHING. Already run against production.
INSERT INTO public.paypal_subscription_ledger (
  paypal_transaction_id, initiated_at, pt_date,
  gross_cents, fee_cents, currency,
  transaction_event_code, status, subject,
  payer_email, payer_name,
  custom_field_raw, custom_field_email,
  instrument_type, instrument_sub_type,
  raw_payload
)
SELECT
  txn->>'id',
  (txn->>'initiated_iso')::timestamptz,
  s.date,
  (txn->>'gross_cents')::int,
  COALESCE((txn->>'fee_cents')::int, 0),
  COALESCE(NULLIF(txn->>'currency',''), 'USD'),
  txn->>'transaction_event_code',
  COALESCE(NULLIF(txn->>'status',''), 'S'),
  NULLIF(txn->>'subject',''),
  NULLIF(txn->>'email',''),
  NULLIF(txn->>'name',''),
  NULLIF(txn->>'custom_field',''),
  CASE
    WHEN txn->>'custom_field' ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
      THEN lower(txn->>'custom_field')
    ELSE NULL
  END,
  NULLIF(txn->>'instrument_type',''),
  NULLIF(txn->>'instrument_sub_type',''),
  txn
FROM public.paypal_daily_snapshot s,
     jsonb_array_elements(s.payload->'direct_success_transactions') txn
WHERE txn->>'transaction_event_code' = 'T0002'
  AND txn->>'id' IS NOT NULL
ON CONFLICT (paypal_transaction_id) DO NOTHING;
