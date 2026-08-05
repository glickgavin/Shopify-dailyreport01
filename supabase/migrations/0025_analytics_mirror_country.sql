-- ─────────────────────────────────────────────────────────────────────────
-- Add country to analytics_events_mirror.
--
-- The source analytics_events table now carries a top-level `country` column
-- (ISO code, e.g. CA / US). The sync's field mapping previously dropped it.
-- Applied to Supabase project kztxlpfrullqzphkvkiv; committed for parity.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.analytics_events_mirror
  ADD COLUMN IF NOT EXISTS country text;

COMMENT ON COLUMN public.analytics_events_mirror.country IS
  'ISO country code from the source analytics_events table (e.g. CA, US). Synced by forward-sync/backfill.';
