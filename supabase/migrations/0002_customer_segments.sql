CREATE TABLE daily_customer_segments (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL REFERENCES daily_summary(date) ON DELETE CASCADE,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'non_cash')),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('new', 'returning')),
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping NUMERIC(12,2) NOT NULL DEFAULT 0,
  cogs NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin NUMERIC(6,4) NOT NULL DEFAULT 0,
  orders INT NOT NULL DEFAULT 0,
  qty INT NOT NULL DEFAULT 0,
  aov NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date, payment_type, customer_type)
);

CREATE INDEX idx_dcs_date ON daily_customer_segments(date);
ALTER TABLE daily_customer_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON daily_customer_segments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
