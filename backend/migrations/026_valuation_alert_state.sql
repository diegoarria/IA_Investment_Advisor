-- Migration 026: valuation alert state
-- Tracks the last valuation tier (Muy cara / Cara / Precio justo / Buen rango /
-- Barata) notified per user+ticker, so the weekly valuation push only fires
-- when the tier actually changes instead of repeating the same message forever.

CREATE TABLE IF NOT EXISTS valuation_alert_state (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  last_tier  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_valuation_alert_state_user
  ON valuation_alert_state (user_id);

ALTER TABLE valuation_alert_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY valuation_alert_state_self ON valuation_alert_state
  FOR ALL USING (user_id = auth.uid());
