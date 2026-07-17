-- Migration 039: Investment Journal
-- Append-only log of investment theses: every time Mentor IA generates a
-- full Premium fundamental analysis ("Analízame X"), the real numbers
-- (price, intrinsic value, scorecard) and the full narrative reply are
-- saved so the user can revisit the thesis later and compare it against
-- reality — unlike thesis_drift_state (migration 028), this is NOT a
-- dedup/state table: it accumulates one row per analysis over time.

CREATE TABLE IF NOT EXISTS investment_theses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker                   TEXT NOT NULL,
  company_name             TEXT,
  price_at_creation        NUMERIC(14,4),
  intrinsic_value_base     NUMERIC(14,4),
  intrinsic_value_expected NUMERIC(14,4),
  margin_of_safety_pct     NUMERIC(8,2),
  thesis_scores            JSONB,
  thesis_text              TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_theses_user_ticker ON investment_theses (user_id, ticker, created_at DESC);

ALTER TABLE investment_theses ENABLE ROW LEVEL SECURITY;

CREATE POLICY investment_theses_self ON investment_theses FOR ALL USING (user_id = auth.uid());
