-- Migration 028: thesis drift alert state
-- Tracks the last drift reason notified per user+ticker (AI Portfolio Manager),
-- so the weekly thesis-drift push only fires again when the reason changes —
-- same dedup pattern as valuation_alert_state (migration 026).

CREATE TABLE IF NOT EXISTS thesis_drift_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  reason_key  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_thesis_drift_state_user ON thesis_drift_state (user_id);

ALTER TABLE thesis_drift_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY thesis_drift_state_self ON thesis_drift_state FOR ALL USING (user_id = auth.uid());
