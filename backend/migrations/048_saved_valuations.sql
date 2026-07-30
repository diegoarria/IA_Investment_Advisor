-- Migration 048: Saved intrinsic valuations
-- Lets a Premium user freeze their own DCF assumptions (growth / discount
-- rate / terminal growth) for a ticker from the Valor Intrínseco screen,
-- then get notified as the LIVE margin of safety (recomputed with those
-- frozen assumptions against fresh fundamentals/price) crosses meaningful
-- thresholds: -10% (getting expensive warning) and 0/10/20/30/40%
-- (undervaluation milestones).
--
-- `notified_milestones` is a ratchet — same pattern as migration 045's
-- claimed_panic_streak_milestones — a threshold only ever fires once per
-- saved valuation; re-saving (new assumptions) resets it since it's a new
-- baseline.

CREATE TABLE IF NOT EXISTS saved_valuations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker                 TEXT NOT NULL,
  company_name           TEXT,
  methodology            TEXT NOT NULL DEFAULT 'two_stage_fcf',
  growth_pct             NUMERIC NOT NULL,
  discount_rate_pct      NUMERIC NOT NULL,
  terminal_growth_pct    NUMERIC NOT NULL,
  price_at_save          NUMERIC,
  intrinsic_value_at_save NUMERIC,
  notified_milestones    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_saved_valuations_user ON saved_valuations(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_valuations_ticker ON saved_valuations(ticker);

ALTER TABLE saved_valuations ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_valuations_self ON saved_valuations
  FOR ALL USING (user_id = auth.uid());
