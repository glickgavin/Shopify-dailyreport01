CREATE TABLE stripe_daily_snapshot (
  date DATE PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sds_fetched_at ON stripe_daily_snapshot(fetched_at DESC);

ALTER TABLE stripe_daily_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON stripe_daily_snapshot
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon read" ON stripe_daily_snapshot
  FOR SELECT TO anon USING (true);
